import { Injectable } from '@nestjs/common';
import type { AuthzPlan, OrgUnitRef, UserAction, UserDto } from '@authz-demo/authz-types';
import { AdminRules } from '../authz/admin-rules.service.js';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { planToSql, SqlParams } from '../authz/data-scope.js';
import type { GrantSet } from '../authz/grants.js';
import { ApiError } from '../common/api-error.js';
import { Db } from '../db/db.js';

type UserRow = {
  id: string; email: string; display_name: string; status: UserDto['status'];
  linked: boolean; created_at: Date; membership_status: UserDto['membershipStatus'];
};
type AffRow = {
  principal_id: string;
  c_id: string; c_code: string; c_name: string;
  d_id: string | null; d_code: string | null; d_name: string | null;
};

export type MembershipOp = 'suspend' | 'restore' | 'remove' | 'readd';
const TRANSITION: Record<MembershipOp, { from: string[]; to: string }> = {
  suspend: { from: ['ACTIVE'], to: 'SUSPENDED' },
  restore: { from: ['SUSPENDED'], to: 'ACTIVE' },
  remove: { from: ['ACTIVE', 'SUSPENDED'], to: 'REMOVED' },
  readd: { from: ['REMOVED'], to: 'ACTIVE' },
};

const unitRef = (id: string, code: string, name: string, type: OrgUnitRef['type']): OrgUnitRef => ({ id, code, name, type });

@Injectable()
export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly rules: AdminRules,
  ) {}

  async list(built: BuiltContext, plan: AuthzPlan, filter: { q?: string; limit: number }): Promise<UserDto[]> {
    const params = new SqlParams();
    const where = [`m.tenant_id = ${params.add(built.context.tenantId)}`];
    const scope = planToSql(plan, 'user', params);
    if (scope === 'FALSE') return [];
    where.push(scope);
    if (filter.q) {
      const like = params.add(`%${filter.q.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`(p.email ILIKE ${like} OR p.display_name ILIKE ${like})`);
    }
    const rows = await this.db.query<UserRow>(
      `${SELECT_USER} WHERE ${where.join(' AND ')} ORDER BY p.display_name, p.id LIMIT ${params.add(filter.limit)}`,
      params.values,
    );
    return this.toDtos(built, rows);
  }

  async get(built: BuiltContext, id: string): Promise<UserDto> {
    const rows = await this.db.query<UserRow>(`${SELECT_USER} WHERE m.tenant_id = $1 AND p.id = $2`, [
      built.context.tenantId,
      id,
    ]);
    if (rows.length === 0) throw new Error(`user ${id} vanished after authorization`);
    return (await this.toDtos(built, rows))[0]!;
  }

  // SPEC §10.5: một transaction tạo principal, membership ACTIVE và affiliation. Không cấp role nào.
  async create(
    built: BuiltContext,
    input: { email: string; displayName: string; companyId: string; departmentId?: string | null },
  ): Promise<UserDto> {
    const { tenantId, principalId, correlationId } = built.context;
    this.rules.enforce(built, 'user.create', { type: 'user', id: input.companyId, tenantId, units: [input.companyId] }, [
      await this.rules.emailDomain(tenantId, input.email, input.companyId),
    ]);
    const id = await this.db.withActor({ principalId, correlationId, reason: 'create user' }, async (tx) => {
      const [p] = await tx.query<{ id: string }>(
        `INSERT INTO principals (email, display_name, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [input.email.toLowerCase(), input.displayName, principalId],
      );
      await tx.query(`INSERT INTO tenant_memberships (tenant_id, principal_id, created_by) VALUES ($1, $2, $3)`, [
        tenantId,
        p!.id,
        principalId,
      ]);
      await tx.query(
        `INSERT INTO user_affiliations (tenant_id, principal_id, company_id, department_id, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, p!.id, input.companyId, input.departmentId ?? null, principalId],
      );
      return p!.id;
    });
    return this.get(built, id);
  }

  // ---- §10.6 Affiliation

  // Thêm U vào công ty C: U phải nằm trong phạm vi user.read của actor (TARGET_VISIBLE), không kéo user công ty khác.
  async addAffiliation(
    built: BuiltContext,
    userId: string,
    input: { companyId: string; departmentId?: string | null },
  ): Promise<UserDto> {
    const { tenantId, principalId, correlationId } = built.context;
    const grants = await this.rules.grantsOf(built);
    const target = await this.userAttrs(tenantId, userId);
    this.rules.enforce(built, 'user_affiliation.manage', { type: 'user_affiliation', id: userId, tenantId, units: [input.companyId] }, [
      { id: 'TARGET_VISIBLE', outcome: grants.has('user.read', target) ? 'PASS' : 'FAIL' },
    ]);
    await this.db.withActor({ principalId, correlationId }, (tx) =>
      tx.query(
        `INSERT INTO user_affiliations (tenant_id, principal_id, company_id, department_id, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, userId, input.companyId, input.departmentId ?? null, principalId],
      ),
    );
    return this.get(built, userId);
  }

  async moveAffiliation(built: BuiltContext, userId: string, companyId: string, departmentId: string | null): Promise<UserDto> {
    const { tenantId, principalId, correlationId } = built.context;
    await this.db.withActor({ principalId, correlationId }, async (tx) => {
      const rows = await tx.query(
        `UPDATE user_affiliations SET department_id = $4
          WHERE tenant_id = $1 AND principal_id = $2 AND company_id = $3 RETURNING id`,
        [tenantId, userId, companyId, departmentId],
      );
      if (rows.length === 0) throw new ApiError('not_found');
    });
    return this.get(built, userId);
  }

  // Gỡ U khỏi C: thu hồi được mọi assignment ACTIVE trong cây của C thì mới làm, cùng một transaction.
  async removeAffiliation(built: BuiltContext, userId: string, companyId: string): Promise<void> {
    const { tenantId, principalId, correlationId } = built.context;
    const grants = await this.rules.grantsOf(built);
    const { constraints, assignmentIds } = await this.rules.removeAffiliation(built, grants, userId, companyId);
    this.rules.enforce(built, 'user_affiliation.manage', { type: 'user_affiliation', id: userId, tenantId, units: [companyId] }, constraints);
    await this.db.withActor({ principalId, correlationId, reason: 'AFFILIATION_ENDED' }, async (tx) => {
      if (assignmentIds.length) {
        await tx.query(
          `UPDATE tenant_role_assignments
              SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoke_reason = 'AFFILIATION_ENDED'
            WHERE tenant_id = $1 AND id = ANY($3::uuid[]) AND status = 'ACTIVE'`,
          [tenantId, principalId, assignmentIds],
        );
      }
      const gone = await tx.query(
        `DELETE FROM user_affiliations WHERE tenant_id = $1 AND principal_id = $2 AND company_id = $3 RETURNING id`,
        [tenantId, userId, companyId],
      );
      if (gone.length === 0) throw new ApiError('not_found');
    });
  }

  // ---- §10.4 Membership
  async membership(built: BuiltContext, userId: string, op: MembershipOp): Promise<UserDto> {
    const { tenantId, principalId, correlationId } = built.context;
    const grants = await this.rules.grantsOf(built);
    this.rules.enforce(built, 'tenant_membership.manage', { type: 'tenant_membership', id: userId, tenantId, units: [] },
      await this.rules.membership(built, grants, userId));
    const t = TRANSITION[op];
    await this.db.withActor({ principalId, correlationId, reason: `membership ${op}` }, async (tx) => {
      const rows = await tx.query(
        `UPDATE tenant_memberships SET status = $3
          WHERE tenant_id = $1 AND principal_id = $2 AND status = ANY($4::text[]) RETURNING id`,
        [tenantId, userId, t.to, t.from],
      );
      if (rows.length === 0) throw new ApiError('conflict');
    });
    return this.get(built, userId);
  }

  private async userAttrs(tenantId: string, userId: string) {
    const rows = await this.db.query<{ org_unit_id: string }>(
      `SELECT org_unit_id FROM user_affiliations WHERE tenant_id = $1 AND principal_id = $2`,
      [tenantId, userId],
    );
    return { type: 'user', id: userId, tenantId, units: rows.map((r) => r.org_unit_id), ownerId: userId };
  }

  private async toDtos(built: BuiltContext, rows: UserRow[]): Promise<UserDto[]> {
    if (rows.length === 0) return [];
    const { tenantId } = built.context;
    const ids = rows.map((r) => r.id);
    const [affs, highest, grants] = await Promise.all([
      this.db.query<AffRow & { unit: string }>(
        `SELECT a.principal_id, c.id AS c_id, c.code AS c_code, c.name AS c_name,
                d.id AS d_id, d.code AS d_code, d.name AS d_name, a.org_unit_id AS unit
           FROM user_affiliations a
           JOIN org_units c ON c.id = a.company_id
           LEFT JOIN org_units d ON d.id = a.department_id
          WHERE a.tenant_id = $1 AND a.principal_id = ANY($2::uuid[]) ORDER BY c.code`,
        [tenantId, ids],
      ),
      // Role cao nhất đang có hiệu lực: level nhỏ nhất (SPEC §8.5.1)
      this.db.query<{ principal_id: string; key: string; name: string; level: number; owner_kind: 'SYSTEM' | 'TENANT' | 'COMPANY' }>(
        `SELECT DISTINCT ON (a.principal_id) a.principal_id, r.key, r.name, r.level, r.owner_kind
           FROM tenant_role_assignments a
           JOIN roles r ON r.id = a.role_id
           JOIN tenant_memberships m ON m.tenant_id = a.tenant_id AND m.principal_id = a.principal_id AND m.status = 'ACTIVE'
          WHERE a.tenant_id = $1 AND a.principal_id = ANY($2::uuid[]) AND a.status = 'ACTIVE'
            AND (a.valid_from IS NULL OR a.valid_from <= now()) AND (a.valid_until IS NULL OR now() < a.valid_until)
          ORDER BY a.principal_id, r.level, r.key`,
        [tenantId, ids],
      ),
      this.rules.grantsOf(built),
    ]);
    return rows.map((r) => {
      const mine = affs.filter((a) => a.principal_id === r.id);
      const top = highest.find((h) => h.principal_id === r.id);
      return {
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        status: r.status,
        membershipStatus: r.membership_status,
        linked: r.linked,
        affiliations: mine.map((a) => ({
          company: unitRef(a.c_id, a.c_code, a.c_name, 'COMPANY'),
          department: a.d_id ? unitRef(a.d_id, a.d_code!, a.d_name!, 'DEPARTMENT') : null,
        })),
        highestRole: top ? { key: top.key, name: top.name, level: Number(top.level), ownerKind: top.owner_kind } : null,
        createdAt: r.created_at.toISOString(),
        _actions: this.actions(grants, tenantId, r.id, mine.map((a) => a.unit)),
      };
    });
  }

  // _actions chỉ phục vụ UX; API kiểm tra lại ở mọi request (tài liệu gốc §3.3)
  private actions(grants: GrantSet, tenantId: string, userId: string, units: string[]): UserAction[] {
    const attrs = { type: 'user', id: userId, tenantId, units, ownerId: userId };
    const out: UserAction[] = [];
    if (grants.has('user_role.read', attrs)) out.push('read_assignments');
    if (grants.has('user_role.assign', attrs) && userId !== grants.principalId) out.push('assign');
    if (grants.forPermission('user_affiliation.manage').length > 0) out.push('affiliate');
    if (grants.has('tenant_membership.manage', { type: 'tenant_membership', tenantId, units: [] }) && userId !== grants.principalId) {
      out.push('membership');
    }
    return out;
  }
}

const SELECT_USER = `
  SELECT p.id, p.email, p.display_name, p.status, (p.auth_subject IS NOT NULL) AS linked, p.created_at,
         m.status AS membership_status
    FROM principals p
    JOIN tenant_memberships m ON m.principal_id = p.id`;

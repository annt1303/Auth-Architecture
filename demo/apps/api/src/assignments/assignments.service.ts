import { Injectable } from '@nestjs/common';
import type { AssignmentDto, AssignmentOptionsDto, RoleRef, ScopeDto, ScopeType } from '@authz-demo/authz-types';
import { AdminRules, type ScopeInput } from '../authz/admin-rules.service.js';
import type { BuiltContext } from '../authz/context-builder.service.js';
import type { GrantSet } from '../authz/grants.js';
import { ResourceResolver } from '../authz/resources.js';
import { ApiError } from '../common/api-error.js';
import { SCOPE_LABEL_COLUMN, SCOPE_LABEL_JOINS, toScopeDto } from '../common/scope-label.js';
import { Db } from '../db/db.js';

type Row = {
  id: string; principal_id: string; status: 'ACTIVE' | 'REVOKED';
  role_id: string; role_key: string; role_name: string; role_level: number; owner_kind: RoleRef['ownerKind'];
  scope_type: string; scope_id: string | null; scope_resource_type: string | null; scope_name: string | null;
  scope_unit: string | null;
  valid_from: Date | null; valid_until: Date | null; created_at: Date;
  creator_id: string | null; creator_name: string | null; revoked_at: Date | null; revoke_reason: string | null;
  membership_status: string | null; not_yet_valid: boolean; expired: boolean;
};

const SELECT_ASSIGNMENT = `
  SELECT g.id, g.principal_id, g.status, r.id AS role_id, r.key AS role_key, r.name AS role_name, r.level AS role_level,
         r.owner_kind, g.scope_type, g.scope_id, g.scope_resource_type, ${SCOPE_LABEL_COLUMN},
         coalesce(so.id, sd.org_unit_id) AS scope_unit,
         g.valid_from, g.valid_until, g.created_at, g.created_by AS creator_id, cp.display_name AS creator_name,
         g.revoked_at, g.revoke_reason, m.status AS membership_status,
         coalesce(g.valid_from > now(), false) AS not_yet_valid, coalesce(g.valid_until <= now(), false) AS expired
    FROM tenant_role_assignments g
    JOIN roles r ON r.id = g.role_id
    LEFT JOIN tenant_memberships m ON m.tenant_id = g.tenant_id AND m.principal_id = g.principal_id
    LEFT JOIN principals cp ON cp.id = g.created_by
    ${SCOPE_LABEL_JOINS}`;

export type NewAssignment = {
  userId: string;
  roleId: string;
  scope: ScopeInput;
  validFrom?: string | null;
  validUntil?: string | null;
};

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly db: Db,
    private readonly rules: AdminRules,
    private readonly resources: ResourceResolver,
  ) {}

  // Tất cả assignment của user, kể cả đã hết hạn hoặc đã thu hồi (có nhãn), mới nhất trước.
  async listForUser(built: BuiltContext, userId: string): Promise<AssignmentDto[]> {
    const rows = await this.db.query<Row>(
      `${SELECT_ASSIGNMENT} WHERE g.tenant_id = $1 AND g.principal_id = $2
        ORDER BY (g.status = 'ACTIVE') DESC, r.level, g.created_at DESC`,
      [built.context.tenantId, userId],
    );
    return this.toDtos(built, rows);
  }

  async get(built: BuiltContext, id: string): Promise<AssignmentDto> {
    const rows = await this.db.query<Row>(`${SELECT_ASSIGNMENT} WHERE g.tenant_id = $1 AND g.id = $2`, [
      built.context.tenantId,
      id,
    ]);
    if (rows.length === 0) throw new Error(`assignment ${id} vanished after authorization`);
    return (await this.toDtos(built, rows))[0]!;
  }

  // SPEC §12: các cặp (role, scope) mà actor được gán cho user này, tính bằng chính các quy tắc §10.1.
  async options(built: BuiltContext, userId: string): Promise<AssignmentOptionsDto> {
    const { tenantId } = built.context;
    const [grants, roles, target, units, docs, existing] = await Promise.all([
      this.rules.grantsOf(built),
      this.rules.activeRoles(tenantId),
      this.resources.byRef({ type: 'user', id: userId }, tenantId),
      this.db.query<{ id: string; name: string; unit_type: string }>(
        `SELECT id, name, unit_type FROM org_units WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY code`,
        [tenantId],
      ),
      this.db.query<{ id: string; title: string; org_unit_id: string }>(
        `SELECT id, title, org_unit_id FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY title LIMIT 200`,
        [tenantId],
      ),
      this.db.query<{ role_id: string; scope_type: string; scope_id: string | null }>(
        `SELECT role_id, scope_type, scope_id FROM tenant_role_assignments
          WHERE tenant_id = $1 AND principal_id = $2 AND status = 'ACTIVE'`,
        [tenantId, userId],
      ),
    ]);
    const taken = new Set(existing.map((e) => `${e.role_id}|${e.scope_type}|${e.scope_id ?? ''}`));

    type Candidate = { scope: ScopeInput; units: string[]; dto: ScopeDto };
    const candidates: Candidate[] = [
      { scope: { type: 'TENANT' }, units: [], dto: { type: 'TENANT', id: null, resourceType: null, label: 'Toàn tổ chức' } },
      { scope: { type: 'SELF' }, units: [], dto: { type: 'SELF', id: null, resourceType: null, label: 'Của chính mình' } },
      ...units
        .filter((u) => grants.rank('user_role.assign', { type: 'assignment', tenantId, units: [u.id] }) !== null)
        .map((u) => ({
          scope: { type: u.unit_type, id: u.id },
          units: [u.id],
          dto: { type: u.unit_type as ScopeType, id: u.id, resourceType: null, label: u.name },
        })),
      ...docs
        .filter((d) => grants.rank('user_role.assign', { type: 'assignment', tenantId, units: [d.org_unit_id] }) !== null)
        .map((d) => ({
          scope: { type: 'RESOURCE', id: d.id },
          units: [d.org_unit_id],
          dto: { type: 'RESOURCE' as const, id: d.id, resourceType: 'document', label: d.title },
        })),
    ];

    const options = roles
      .map((role) => ({
        role: { id: role.id, key: role.key, name: role.key, level: role.level, ownerKind: role.ownerKind } as RoleRef,
        scopes: candidates
          .filter((c) => !taken.has(`${role.id}|${c.scope.type}|${c.scope.id ?? ''}`))
          .filter((c) =>
            this.rules
              .assignWith(built, grants, { userId, role, scope: c.scope, units: c.units, targetAttrs: target?.attrs ?? null })
              .every((r) => r.outcome === 'PASS'),
          )
          .map((c) => c.dto),
      }))
      .filter((o) => o.scopes.length > 0);

    // Tên role lấy từ DB (activeRoles không mang tên)
    const names = await this.db.query<{ id: string; name: string }>(`SELECT id, name FROM roles WHERE id = ANY($1::uuid[])`, [
      options.map((o) => o.role.id),
    ]);
    for (const o of options) o.role.name = names.find((n) => n.id === o.role.id)?.name ?? o.role.key;
    return { roles: options };
  }

  async create(built: BuiltContext, input: NewAssignment): Promise<AssignmentDto> {
    const { tenantId, principalId, correlationId } = built.context;
    const role = await this.rules.loadRole(input.roleId, tenantId);
    if (!role) throw new ApiError('not_found');
    const grants = await this.rules.grantsOf(built);
    const results = await this.rules.assign(built, grants, { userId: input.userId, role, scope: input.scope });
    const units = (await this.resources.scopeUnits(input.scope, tenantId)) ?? [];
    this.rules.enforce(built, 'user_role.assign', { type: 'assignment', tenantId, units }, results);

    const hasScopeId = !['TENANT', 'SELF'].includes(input.scope.type);
    const id = await this.db.withActor({ principalId, correlationId, reason: 'assign role' }, async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO tenant_role_assignments
           (tenant_id, principal_id, role_id, scope_type, scope_id, scope_resource_type, valid_from, valid_until, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          tenantId, input.userId, role.id, input.scope.type, hasScopeId ? input.scope.id : null,
          input.scope.type === 'RESOURCE' ? 'document' : null, input.validFrom ?? null, input.validUntil ?? null, principalId,
        ],
      );
      return row!.id;
    });
    return this.get(built, id);
  }

  // Sửa thời hạn phải thỏa cả điều kiện thu hồi và điều kiện gán (SPEC §10.2)
  async updateValidity(
    built: BuiltContext,
    id: string,
    patch: { validFrom?: string | null; validUntil?: string | null },
  ): Promise<AssignmentDto> {
    const { tenantId, principalId, correlationId } = built.context;
    const a = await this.load(built, id);
    if (a.status !== 'ACTIVE') throw new ApiError('conflict');
    const grants = await this.rules.grantsOf(built);
    const attrs = { type: 'assignment', id, tenantId, units: a.scope_unit ? [a.scope_unit] : [] };
    const role = await this.rules.loadRole(a.role_id, tenantId);
    const assign = await this.rules.assign(built, grants, {
      userId: a.principal_id,
      role: role!,
      scope: { type: a.scope_type, id: a.scope_id },
    });
    const revoke = this.rules.revoke(built, grants, { principalId: a.principal_id, roleKey: a.role_key, roleLevel: Number(a.role_level) }, attrs);
    this.rules.enforce(built, 'user_role.assign', attrs, AdminRules.merge(revoke, assign));

    await this.db.withActor({ principalId, correlationId, reason: 'change assignment validity' }, (tx) =>
      tx.query(
        `UPDATE tenant_role_assignments
            SET valid_from  = CASE WHEN $3::boolean THEN $4::timestamptz ELSE valid_from END,
                valid_until = CASE WHEN $5::boolean THEN $6::timestamptz ELSE valid_until END
          WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'`,
        [tenantId, id, patch.validFrom !== undefined, patch.validFrom ?? null, patch.validUntil !== undefined, patch.validUntil ?? null],
      ),
    );
    return this.get(built, id);
  }

  async revoke(built: BuiltContext, id: string, reason: string | null): Promise<AssignmentDto> {
    const { tenantId, principalId, correlationId } = built.context;
    const a = await this.load(built, id);
    if (a.status !== 'ACTIVE') throw new ApiError('conflict');
    const attrs = { type: 'assignment', id, tenantId, units: a.scope_unit ? [a.scope_unit] : [] };
    this.rules.enforce(built, 'user_role.revoke', attrs,
      this.rules.revoke(built, await this.rules.grantsOf(built), { principalId: a.principal_id, roleKey: a.role_key, roleLevel: Number(a.role_level) }, attrs));
    await this.db.withActor({ principalId, correlationId, reason: reason ?? 'revoke assignment' }, (tx) =>
      tx.query(
        `UPDATE tenant_role_assignments SET status = 'REVOKED', revoke_reason = $3
          WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'`,
        [tenantId, id, reason ?? 'REVOKED_BY_ADMIN'],
      ),
    );
    return this.get(built, id);
  }

  private async load(built: BuiltContext, id: string): Promise<Row> {
    const [row] = await this.db.query<Row>(`${SELECT_ASSIGNMENT} WHERE g.tenant_id = $1 AND g.id = $2`, [built.context.tenantId, id]);
    if (!row) throw new ApiError('not_found');
    return row;
  }

  private async toDtos(built: BuiltContext, rows: Row[]): Promise<AssignmentDto[]> {
    const grants = await this.rules.grantsOf(built);
    const { tenantId } = built.context;
    const roles = new Map((await this.rules.activeRoles(tenantId)).map((r) => [r.id, r]));
    const out: AssignmentDto[] = [];
    for (const r of rows) {
      const reason: AssignmentDto['ineffectiveReason'] =
        r.status === 'REVOKED' ? 'REVOKED'
        : r.membership_status !== 'ACTIVE' ? 'MEMBERSHIP_INACTIVE'
        : r.expired ? 'EXPIRED'
        : r.not_yet_valid ? 'NOT_YET_VALID'
        : null;
      out.push({
        id: r.id,
        role: { id: r.role_id, key: r.role_key, name: r.role_name, level: Number(r.role_level), ownerKind: r.owner_kind },
        scope: toScopeDto(r),
        status: r.status,
        validFrom: r.valid_from?.toISOString() ?? null,
        validUntil: r.valid_until?.toISOString() ?? null,
        effective: reason === null,
        ineffectiveReason: reason,
        createdAt: r.created_at.toISOString(),
        createdBy: r.creator_id ? { id: r.creator_id, displayName: r.creator_name ?? '' } : null,
        revokedAt: r.revoked_at?.toISOString() ?? null,
        revokeReason: r.revoke_reason,
        _actions: r.status === 'ACTIVE' ? await this.actions(built, grants, r, roles.get(r.role_id)) : [],
      });
    }
    return out;
  }

  private async actions(
    built: BuiltContext,
    grants: GrantSet,
    r: Row,
    role: Parameters<AdminRules['assignWith']>[2]['role'] | undefined,
  ): Promise<AssignmentDto['_actions']> {
    const { tenantId } = built.context;
    const attrs = { type: 'assignment', id: r.id, tenantId, units: r.scope_unit ? [r.scope_unit] : [] };
    const revoke = this.rules.revoke(built, grants, { principalId: r.principal_id, roleKey: r.role_key, roleLevel: Number(r.role_level) }, attrs);
    const out: AssignmentDto['_actions'] = [];
    const canRevoke = grants.has('user_role.revoke', attrs) && revoke.every((c) => c.outcome === 'PASS');
    if (canRevoke) out.push('revoke');
    if (role && grants.has('user_role.assign', attrs) && canRevoke) {
      const target = await this.resources.byRef({ type: 'user', id: r.principal_id }, tenantId);
      const assign = this.rules.assignWith(built, grants, {
        userId: r.principal_id,
        role,
        scope: { type: r.scope_type, id: r.scope_id },
        units: attrs.units,
        targetAttrs: target?.attrs ?? null,
      });
      if (assign.every((c) => c.outcome === 'PASS')) out.push('update');
    }
    return out;
  }
}

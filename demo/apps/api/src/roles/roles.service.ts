import { Injectable } from '@nestjs/common';
import type { AuthzPlan, PermissionDto, ResourceAttrs, RoleDto, RoleOwnerKind } from '@authz-demo/authz-types';
import { AdminRules, type RoleInfo } from '../authz/admin-rules.service.js';
import { PermissionCatalog } from '../authz/catalog.service.js';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { planToSql, SqlParams } from '../authz/data-scope.js';
import type { GrantSet } from '../authz/grants.js';
import { ApiError } from '../common/api-error.js';
import { Db } from '../db/db.js';

type RoleRow = {
  id: string; key: string; name: string; description: string | null; level: number; owner_kind: RoleOwnerKind;
  status: 'ACTIVE' | 'ARCHIVED'; owner_company_id: string | null; company_code: string | null; company_name: string | null;
  permissions: string[]; assignment_count: string;
};

export type RoleFilter = { ownerKind?: RoleOwnerKind; level?: number; status?: 'ACTIVE' | 'ARCHIVED' };
export type NewRole = {
  ownerKind: 'TENANT' | 'COMPANY';
  ownerCompanyId?: string | null;
  key: string;
  name: string;
  description?: string | null;
  level: number;
  permissions: string[];
};

@Injectable()
export class RolesService {
  constructor(
    private readonly db: Db,
    private readonly rules: AdminRules,
    private readonly catalog: PermissionCatalog,
  ) {}

  async permissions(): Promise<PermissionDto[]> {
    const rows = await this.db.query<{
      key: string; resource_type: string; risk_level: 'LOW' | 'HIGH'; is_visibility: boolean;
      tenant_scope_only: boolean; description: string;
    }>(
      `SELECT key, resource_type, risk_level, is_visibility, tenant_scope_only, description
         FROM permissions WHERE deprecated_at IS NULL ORDER BY key`,
    );
    return rows.map((r) => ({
      key: r.key,
      resourceType: r.resource_type,
      riskLevel: r.risk_level,
      isVisibility: r.is_visibility,
      tenantScopeOnly: r.tenant_scope_only,
      description: r.description,
    }));
  }

  // Role SYSTEM / TENANT: mọi grant role.read đều thấy. Role công ty C: cây của grant giao cây của C (SPEC §8.2)
  async list(built: BuiltContext, plan: AuthzPlan, filter: RoleFilter): Promise<RoleDto[]> {
    const params = new SqlParams();
    const tenant = params.add(built.context.tenantId);
    const where = [`(r.owner_kind = 'SYSTEM' OR r.tenant_id = ${tenant})`];
    where.push(`(r.owner_kind <> 'COMPANY' OR ${planToSql(plan, 'role', params)})`);
    if (filter.ownerKind) where.push(`r.owner_kind = ${params.add(filter.ownerKind)}`);
    if (filter.level) where.push(`r.level = ${params.add(filter.level)}`);
    if (filter.status) where.push(`r.status = ${params.add(filter.status)}`);
    const rows = await this.db.query<RoleRow>(`${SELECT_ROLE(tenant)} WHERE ${where.join(' AND ')} ${GROUP_ORDER}`, params.values);
    return this.toDtos(built, rows);
  }

  async get(built: BuiltContext, id: string): Promise<RoleDto> {
    const rows = await this.db.query<RoleRow>(`${SELECT_ROLE('$1')} WHERE r.id = $2 ${GROUP_ORDER}`, [built.context.tenantId, id]);
    if (rows.length === 0) throw new Error(`role ${id} vanished after authorization`);
    return (await this.toDtos(built, rows))[0]!;
  }

  async create(built: BuiltContext, input: NewRole): Promise<RoleDto> {
    const { tenantId, principalId, correlationId } = built.context;
    const permissions = await this.knownPermissions(input.permissions);
    const attrs = this.ownerAttrs(tenantId, input.ownerKind === 'COMPANY' ? input.ownerCompanyId! : null);
    this.rules.enforce(built, 'role.manage', attrs, this.rules.roleManage(await this.rules.grantsOf(built), attrs, {
      levels: [input.level],
      addedPermissions: permissions,
    }));
    const id = await this.db.withActor({ principalId, correlationId, reason: 'create role' }, async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO roles (owner_kind, tenant_id, owner_company_id, key, name, description, level, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [input.ownerKind, tenantId, input.ownerKind === 'COMPANY' ? input.ownerCompanyId : null, input.key, input.name,
          input.description ?? null, input.level, principalId],
      );
      await tx.query(
        `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = ANY($2::text[])`,
        [row!.id, permissions],
      );
      return row!.id;
    });
    return this.get(built, id);
  }

  // Level cũ và mới đều phải thấp hơn hẳn rank của actor (SPEC §10.3)
  async update(built: BuiltContext, id: string, patch: { name?: string; description?: string | null; level?: number }): Promise<RoleDto> {
    const { tenantId, principalId, correlationId } = built.context;
    const role = await this.manageable(built, id, patch.level !== undefined ? [patch.level] : []);
    await this.db.withActor({ principalId, correlationId, reason: 'update role' }, (tx) =>
      tx.query(
        `UPDATE roles SET name = coalesce($3, name), level = coalesce($4, level),
                description = CASE WHEN $5::boolean THEN $6 ELSE description END
          WHERE id = $1 AND tenant_id = $2`,
        [role.id, tenantId, patch.name ?? null, patch.level ?? null, patch.description !== undefined, patch.description ?? null],
      ),
    );
    return this.get(built, id);
  }

  // Thêm quyền: actor phải đang có quyền đó tại scope chủ sở hữu. Bớt quyền thì không cần.
  async setPermissions(built: BuiltContext, id: string, wanted: string[]): Promise<RoleDto> {
    const { principalId, correlationId } = built.context;
    const permissions = await this.knownPermissions(wanted);
    const current = await this.rules.loadRole(id, built.context.tenantId);
    const added = permissions.filter((p) => !current?.permissions.includes(p));
    const role = await this.manageable(built, id, [], added);
    const removed = role.permissions.filter((p) => !permissions.includes(p));
    await this.db.withActor({ principalId, correlationId, reason: 'update role permissions' }, async (tx) => {
      if (removed.length) {
        await tx.query(
          `DELETE FROM role_permissions WHERE role_id = $1 AND permission_id IN (SELECT id FROM permissions WHERE key = ANY($2::text[]))`,
          [role.id, removed],
        );
      }
      if (added.length) {
        await tx.query(`INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = ANY($2::text[])`, [
          role.id,
          added,
        ]);
      }
    });
    return this.get(built, id);
  }

  // Không xóa cứng: lưu trữ thì không gán mới được, assignment cũ vẫn hiệu lực tới khi thu hồi (SPEC §7.3)
  async archive(built: BuiltContext, id: string): Promise<RoleDto> {
    const { tenantId, principalId, correlationId } = built.context;
    const role = await this.manageable(built, id, []);
    await this.db.withActor({ principalId, correlationId, reason: 'archive role' }, (tx) =>
      tx.query(`UPDATE roles SET status = 'ARCHIVED' WHERE id = $1 AND tenant_id = $2`, [role.id, tenantId]),
    );
    return this.get(built, id);
  }

  // Nạp role, áp RANK / PERMISSION_SUBSET của §10.3 trên đích sở hữu của nó. Role SYSTEM luôn bị từ chối.
  private async manageable(built: BuiltContext, id: string, newLevels: number[], added: string[] = []): Promise<RoleInfo> {
    const role = await this.rules.loadRole(id, built.context.tenantId);
    if (!role) throw new ApiError('not_found');
    const attrs = this.ownerAttrs(built.context.tenantId, role.ownerCompanyId);
    this.rules.enforce(built, 'role.manage', attrs, this.rules.roleManage(await this.rules.grantsOf(built), attrs, {
      levels: [role.level, ...newLevels],
      addedPermissions: added,
      systemRole: role.ownerKind === 'SYSTEM',
    }));
    if (role.status === 'ARCHIVED') throw new ApiError('conflict');
    return role;
  }

  private ownerAttrs(tenantId: string, companyId: string | null): ResourceAttrs {
    return { type: 'role', tenantId, units: companyId ? [companyId] : [] };
  }

  private async knownPermissions(keys: string[]): Promise<string[]> {
    const unique = [...new Set(keys)];
    const unknown = unique.filter((k) => !this.catalog.get(k));
    if (unknown.length) throw new ApiError('invalid_request', unknown.map((k) => ({ field: 'permissions', issue: `Unknown permission ${k}` })));
    return unique;
  }

  private async toDtos(built: BuiltContext, rows: RoleRow[]): Promise<RoleDto[]> {
    const grants = await this.rules.grantsOf(built);
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      level: Number(r.level),
      ownerKind: r.owner_kind,
      description: r.description,
      status: r.status,
      ownerCompany: r.owner_company_id
        ? { id: r.owner_company_id, code: r.company_code!, name: r.company_name!, type: 'COMPANY' }
        : null,
      permissions: r.permissions,
      assignmentCount: Number(r.assignment_count),
      _actions: this.actions(grants, built.context.tenantId, r),
    }));
  }

  private actions(grants: GrantSet, tenantId: string, r: RoleRow): RoleDto['_actions'] {
    if (r.owner_kind === 'SYSTEM' || r.status !== 'ACTIVE') return [];
    const attrs = this.ownerAttrs(tenantId, r.owner_company_id);
    if (!grants.has('role.manage', attrs)) return [];
    const rank = grants.rank('role.manage', attrs);
    return rank !== null && Number(r.level) > rank ? ['update', 'archive'] : [];
  }
}

const SELECT_ROLE = (tenantParam: string) => `
  SELECT r.id, r.key, r.name, r.description, r.level, r.owner_kind, r.status, r.owner_company_id,
         c.code AS company_code, c.name AS company_name,
         coalesce(array_agg(p.key ORDER BY p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS permissions,
         (SELECT count(*) FROM tenant_role_assignments a
           WHERE a.role_id = r.id AND a.tenant_id = ${tenantParam} AND a.status = 'ACTIVE') AS assignment_count
    FROM roles r
    LEFT JOIN org_units c ON c.id = r.owner_company_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id`;

const GROUP_ORDER = `GROUP BY r.id, c.code, c.name ORDER BY r.level, r.key`;

import { Injectable } from '@nestjs/common';
import type { ConstraintId, ResourceAttrs, RoleOwnerKind } from '@authz-demo/authz-types';
import { ApiError } from '../common/api-error.js';
import { Db } from '../db/db.js';
import type { BuiltContext } from './context-builder.service.js';
import { DecisionAudit } from './decision-audit.service.js';
import type { GrantSet } from './grants.js';
import { Pdp } from './pdp.service.js';
import { ResourceResolver } from './resources.js';

// Quy tắc quản trị (SPEC §10): các ràng buộc C2/D5 chạy SAU khi PEP đã xác nhận actor có quyền
// bao phủ đích. Mỗi hàm trả về danh sách kết quả từng ràng buộc (PASS/FAIL), dùng chung cho API thật,
// cho `/assignments/options` và cho Simulator, nên ba nơi không thể lệch nhau.
export type ConstraintResult = { id: ConstraintId; outcome: 'PASS' | 'FAIL'; detail?: unknown };

export type RoleInfo = {
  id: string;
  key: string;
  level: number;
  ownerKind: RoleOwnerKind;
  ownerCompanyId: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  permissions: string[];
};

export type ScopeInput = { type: string; id?: string | null };

const result = (id: ConstraintId, ok: boolean, detail?: unknown): ConstraintResult => ({
  id,
  outcome: ok ? 'PASS' : 'FAIL',
  ...(detail === undefined ? {} : { detail }),
});

@Injectable()
export class AdminRules {
  constructor(
    private readonly db: Db,
    private readonly pdp: Pdp,
    private readonly resources: ResourceResolver,
    private readonly audit: DecisionAudit,
  ) {}

  grantsOf(built: BuiltContext): Promise<GrantSet> {
    return this.pdp.loadGrants(built.context.tenantId, built.context.principalId);
  }

  async loadRole(roleId: string, tenantId: string): Promise<RoleInfo | null> {
    const [row] = await this.db.query<{
      id: string; key: string; level: number; owner_kind: RoleOwnerKind; owner_company_id: string | null;
      status: 'ACTIVE' | 'ARCHIVED'; permissions: string[];
    }>(
      `SELECT r.id, r.key, r.level, r.owner_kind, r.owner_company_id, r.status,
              coalesce(array_agg(p.key ORDER BY p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE r.id = $1 AND (r.owner_kind = 'SYSTEM' OR r.tenant_id = $2)
        GROUP BY r.id`,
      [roleId, tenantId],
    );
    return row
      ? {
          id: row.id, key: row.key, level: Number(row.level), ownerKind: row.owner_kind,
          ownerCompanyId: row.owner_company_id, status: row.status, permissions: row.permissions,
        }
      : null;
  }

  // ---- §10.1 Gán role R cho user U tại scope S. Điều kiện 1 (có quyền bao phủ S) do PEP / PDP lo.
  async assign(
    built: BuiltContext,
    grants: GrantSet,
    input: { userId: string; role: RoleInfo; scope: ScopeInput },
  ): Promise<ConstraintResult[]> {
    const { tenantId } = built.context;
    const [units, target] = await Promise.all([
      this.resources.scopeUnits(input.scope, tenantId),
      this.resources.byRef({ type: 'user', id: input.userId }, tenantId),
    ]);
    return this.assignWith(built, grants, { ...input, units, targetAttrs: target?.attrs ?? null });
  }

  // Phần không truy vấn của §10.1 (units của scope và thuộc tính của user đã nạp sẵn),
  // để `/assignments/options` thử hàng trăm cặp (role, scope) mà không tốn truy vấn.
  assignWith(
    built: BuiltContext,
    grants: GrantSet,
    input: { userId: string; role: RoleInfo; scope: ScopeInput; units: string[] | null; targetAttrs: ResourceAttrs | null },
  ): ConstraintResult[] {
    const { tenantId, principalId } = built.context;
    const scopeAttrs: ResourceAttrs = { type: 'assignment', tenantId, units: input.units ?? [] };
    const out: ConstraintResult[] = [];

    const rank = grants.rank('user_role.assign', scopeAttrs);
    out.push(result('RANK', rank !== null && input.role.level > rank, { actorRank: rank, roleLevel: input.role.level }));

    const missing = input.role.permissions.filter((p) => !grants.has(p, scopeAttrs));
    out.push(result('PERMISSION_SUBSET', missing.length === 0, missing.length ? { missing } : undefined));

    out.push(result('NOT_SELF', input.userId !== principalId));
    out.push(result('TARGET_VISIBLE', !!input.targetAttrs && grants.has('user.read', input.targetAttrs)));
    out.push(result('ROLE_ASSIGNABLE_HERE', this.assignableHere(input.role, input.scope, input.units, grants)));
    out.push(result('SYSTEM_ADMIN_PROTECTED', input.role.key !== 'system_admin'));
    return out;
  }

  async activeRoles(tenantId: string): Promise<RoleInfo[]> {
    const rows = await this.db.query<{
      id: string; key: string; level: number; owner_kind: RoleOwnerKind; owner_company_id: string | null; permissions: string[];
    }>(
      `SELECT r.id, r.key, r.level, r.owner_kind, r.owner_company_id,
              coalesce(array_agg(p.key ORDER BY p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE (r.owner_kind = 'SYSTEM' OR r.tenant_id = $1) AND r.status = 'ACTIVE'
        GROUP BY r.id ORDER BY r.level, r.key`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.id, key: r.key, level: Number(r.level), ownerKind: r.owner_kind, ownerCompanyId: r.owner_company_id,
      status: 'ACTIVE' as const, permissions: r.permissions,
    }));
  }

  // Role phải ACTIVE; role công ty chỉ gán trong cây của công ty đó và không bao giờ ở TENANT / SELF (SPEC §7.3, §8.4).
  private assignableHere(role: RoleInfo, scope: ScopeInput, units: string[] | null, grants: GrantSet): boolean {
    if (role.status !== 'ACTIVE' || units === null) return false;
    if (role.ownerKind !== 'COMPANY') return true;
    if (scope.type === 'TENANT' || scope.type === 'SELF') return false;
    return units.length > 0 && units.every((u) => grants.tree.isInside(u, role.ownerCompanyId!));
  }

  // ---- §10.2 Thu hồi assignment A (cũng là một nửa điều kiện của sửa thời hạn)
  revoke(
    built: BuiltContext,
    grants: GrantSet,
    a: { principalId: string; roleKey: string; roleLevel: number },
    attrs: ResourceAttrs,
  ): ConstraintResult[] {
    const rank = grants.rank('user_role.revoke', attrs);
    return [
      result('RANK', rank !== null && a.roleLevel > rank, { actorRank: rank, roleLevel: a.roleLevel }),
      result('NOT_SELF', a.principalId !== built.context.principalId),
      result('SYSTEM_ADMIN_PROTECTED', a.roleKey !== 'system_admin'),
    ];
  }

  // Gộp: ràng buộc cùng id phải đạt ở mọi nơi nó xuất hiện (sửa thời hạn = thu hồi + gán)
  static merge(...lists: ConstraintResult[][]): ConstraintResult[] {
    const byId = new Map<ConstraintId, ConstraintResult>();
    for (const r of lists.flat()) {
      const prev = byId.get(r.id);
      if (!prev || (prev.outcome === 'PASS' && r.outcome === 'FAIL')) byId.set(r.id, r);
    }
    return [...byId.values()];
  }

  // ---- §10.3 Tạo, sửa role. `attrs` là đích sở hữu (công ty C hoặc cấp tenant).
  roleManage(
    grants: GrantSet,
    attrs: ResourceAttrs,
    input: { levels: number[]; addedPermissions: string[]; systemRole?: boolean },
  ): ConstraintResult[] {
    const rank = grants.rank('role.manage', attrs);
    const rankOk = !input.systemRole && rank !== null && input.levels.every((l) => l > rank);
    const missing = input.addedPermissions.filter((p) => !grants.has(p, attrs));
    return [
      result('RANK', rankOk, { actorRank: rank, levels: input.levels, ...(input.systemRole ? { systemRole: true } : {}) }),
      result('PERMISSION_SUBSET', missing.length === 0, missing.length ? { missing } : undefined),
    ];
  }

  // ---- §10.4 Membership: rank cao hơn hẳn mọi assignment ACTIVE của đích
  async membership(built: BuiltContext, grants: GrantSet, targetId: string): Promise<ConstraintResult[]> {
    const { tenantId, principalId } = built.context;
    const rows = await this.db.query<{ level: number; key: string; owner_kind: string }>(
      `SELECT r.level, r.key, r.owner_kind FROM tenant_role_assignments a JOIN roles r ON r.id = a.role_id
        WHERE a.tenant_id = $1 AND a.principal_id = $2 AND a.status = 'ACTIVE'`,
      [tenantId, targetId],
    );
    const rank = grants.rank('tenant_membership.manage', { type: 'tenant_membership', tenantId, units: [] });
    const topLevel = rows.length ? Math.min(...rows.map((r) => Number(r.level))) : null;
    return [
      result('RANK', rank !== null && (topLevel === null || topLevel > rank), { actorRank: rank, targetTopLevel: topLevel }),
      result('NOT_SELF', targetId !== principalId),
      result('SYSTEM_ADMIN_PROTECTED', !rows.some((r) => r.owner_kind === 'SYSTEM' && r.key === 'system_admin')),
    ];
  }

  // ---- §10.5 Tạo user: domain của email phải ACTIVE ở công ty đích hoặc một công ty tổ tiên
  async emailDomain(tenantId: string, email: string, companyId: string): Promise<ConstraintResult> {
    const domain = email.toLowerCase().split('@')[1] ?? '';
    const [row] = await this.db.query(
      `SELECT 1 FROM company_domains d
         JOIN org_unit_closure c ON c.ancestor_id = d.company_id AND c.descendant_id = $3
        WHERE d.tenant_id = $1 AND d.domain = $2 AND d.status = 'ACTIVE'`,
      [tenantId, domain, companyId],
    );
    return result('EMAIL_DOMAIN', !!row);
  }

  // ---- §10.6 Gỡ affiliation: phải thu hồi được MỌI assignment ACTIVE của U trong cây của C
  async removeAffiliation(
    built: BuiltContext,
    grants: GrantSet,
    userId: string,
    companyId: string,
  ): Promise<{ constraints: ConstraintResult[]; assignmentIds: string[] }> {
    const { tenantId } = built.context;
    const subtree = grants.tree.subtree(companyId);
    const rows = await this.db.query<{
      id: string; principal_id: string; key: string; level: number; scope_type: string; scope_id: string | null; unit: string | null;
    }>(
      `SELECT a.id, a.principal_id, r.key, r.level, a.scope_type, a.scope_id,
              CASE WHEN a.scope_type = 'RESOURCE' THEN d.org_unit_id ELSE a.scope_id END AS unit
         FROM tenant_role_assignments a
         JOIN roles r ON r.id = a.role_id
         LEFT JOIN documents d ON a.scope_type = 'RESOURCE' AND d.id = a.scope_id
        WHERE a.tenant_id = $1 AND a.principal_id = $2 AND a.status = 'ACTIVE'
          AND a.scope_type NOT IN ('TENANT', 'SELF')`,
      [tenantId, userId],
    );
    const inTree = rows.filter((r) => r.unit && subtree.includes(r.unit));
    const merged: ConstraintResult[][] = inTree.map((r) =>
      this.revoke(
        built,
        grants,
        { principalId: r.principal_id, roleKey: r.key, roleLevel: Number(r.level) },
        { type: 'assignment', tenantId, units: [r.unit!] },
      ),
    );
    return {
      constraints: AdminRules.merge(...merged),
      assignmentIds: inTree.map((r) => r.id),
    };
  }

  // ---- Áp kết quả: có ràng buộc trượt thì ghi audit lớp B (kèm constraint) rồi trả 403 forbidden.
  // `constraint` không bao giờ ra khỏi API (SPEC §11).
  enforce(built: BuiltContext, action: string, resource: ResourceAttrs | null, results: ConstraintResult[]): void {
    const failed = results.find((r) => r.outcome === 'FAIL');
    if (!failed) return;
    this.audit.recordConstraintFailed({
      built,
      correlationId: built.context.correlationId,
      action,
      resource,
      constraint: failed.id,
      // Mọi ràng buộc trượt (không chỉ cái đầu tiên), để audit và Simulator giải thích đầy đủ
      detail: { failed: results.filter((r) => r.outcome === 'FAIL').map((r) => r.id), detail: failed.detail ?? null },
    });
    throw new ApiError('forbidden');
  }
}

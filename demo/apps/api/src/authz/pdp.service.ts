import { Injectable } from '@nestjs/common';
import type {
  AuthzPlan,
  EvaluationResult,
  Predicate,
  ReasonCode,
  ResourceAttrs,
} from '@authz-demo/authz-types';
import { Db } from '../db/db.js';
import { PermissionCatalog } from './catalog.service.js';
import type { BuiltContext } from './context-builder.service.js';
import { PLAN_MAX_IN_VALUES } from './data-scope.js';
import { type Grant, GrantSet, UnitTree } from './grants.js';

type GrantRow = {
  assignment_id: string;
  scope_type: string;
  scope_id: string | null;
  scope_resource_type: string | null;
};

export type GrantDetail = {
  assignmentId: string;
  roleKey: string;
  roleLevel: number;
  scopeType: string;
  scopeLabel: string;
  covers: boolean;
};
export type Evaluation = { result: EvaluationResult; grants: GrantDetail[] };

export type DataScopeResult = { result: EvaluationResult; plan?: AuthzPlan };

const result = (
  state: EvaluationResult['state'],
  reasonCode: ReasonCode,
  extra: Partial<EvaluationResult> = {},
): EvaluationResult => ({ state, reasonCode, matchedGrantIds: [], ...extra });

const dbFailure = () =>
  result('INDETERMINATE', 'EVALUATION_FAILURE', { failedDependency: 'database' });

// Policy Decision Point (tài liệu gốc §11.3, rút gọn ở SPEC §9).
// Chỉ ra quyết định; không thực thi hành động, không dựng SQL cho dữ liệu nghiệp vụ.
@Injectable()
export class Pdp {
  constructor(
    private readonly db: Db,
    private readonly catalog: PermissionCatalog,
  ) {}

  // Giai đoạn B1, B2: thất bại ở đây là cuối cùng, không grant nào ghi đè được.
  evaluateSubject(built: BuiltContext): EvaluationResult | null {
    const s = built.subject;
    if (s.principalStatus !== 'ACTIVE') return result('DENY', 'PRINCIPAL_INACTIVE');
    if (s.tenantStatus !== 'ACTIVE') return result('DENY', 'TENANT_SUSPENDED');
    if (s.membershipStatus !== 'ACTIVE') return result('DENY', 'NOT_A_MEMBER');
    return null;
  }

  // Một tài nguyên (hoặc một đích tạo mới). Giai đoạn PA4, B, C1, D3, D4, D6.
  async check(built: BuiltContext, action: string, res: ResourceAttrs): Promise<EvaluationResult> {
    return (await this.evaluate(built, action, res)).result;
  }

  // Như check, nhưng trả thêm các grant đã xét (cho Simulator, SPEC §9 `explain`).
  async evaluate(built: BuiltContext, action: string, res: ResourceAttrs): Promise<Evaluation> {
    const bare = (r: EvaluationResult): Evaluation => ({ result: r, grants: [] });
    if (!this.catalog.get(action)) return bare(result('INDETERMINATE', 'UNKNOWN_PERMISSION'));
    const subjectDenied = this.evaluateSubject(built);
    if (subjectDenied) return bare(subjectDenied);
    if (res.tenantId !== built.context.tenantId) return bare(result('DENY', 'TENANT_MISMATCH'));

    let grants: (GrantRow & { covers: boolean; role_key: string; role_level: number; scope_label: string | null })[];
    try {
      // Bao phủ theo SPEC §8.2. units rỗng = tài nguyên cấp tenant: chỉ TENANT bao phủ.
      grants = await this.db.query(
        `SELECT g.assignment_id, g.scope_type, g.scope_id, g.scope_resource_type, g.role_key, g.role_level,
                coalesce(so.name, sd.title) AS scope_label,
                (  $8::boolean OR g.scope_type = 'TENANT'
                OR (g.scope_type IN ('COMPANY','DEPARTMENT','TEAM') AND EXISTS (
                      SELECT 1 FROM org_unit_closure c
                       WHERE c.ancestor_id = g.scope_id AND c.descendant_id = ANY($4::uuid[])))
                OR (g.scope_type = 'RESOURCE' AND g.scope_resource_type = $5 AND g.scope_id = $6::uuid)
                OR (g.scope_type = 'SELF' AND $7::uuid = $2::uuid)
                ) AS covers
           FROM effective_grants($1::uuid, $2::uuid, $3, now()) g
           LEFT JOIN org_units so ON so.id = g.scope_id AND g.scope_type IN ('COMPANY','DEPARTMENT','TEAM')
           LEFT JOIN documents sd ON sd.id = g.scope_id AND g.scope_type = 'RESOURCE'`,
        [
          built.context.tenantId,
          built.context.principalId,
          action,
          res.units,
          res.type,
          res.id ?? null,
          res.ownerId ?? null,
          res.anyScope ?? false,
        ],
      );
    } catch {
      return bare(dbFailure());
    }

    const details: GrantDetail[] = grants.map((g) => ({
      assignmentId: g.assignment_id,
      roleKey: g.role_key,
      roleLevel: Number(g.role_level),
      scopeType: g.scope_type,
      scopeLabel: g.scope_type === 'TENANT' ? 'Toàn tổ chức' : g.scope_type === 'SELF' ? 'Của chính mình' : (g.scope_label ?? '(không rõ)'),
      covers: g.covers,
    }));
    if (grants.length === 0) return { result: result('NOT_APPLICABLE', 'NO_GRANT'), grants: details };
    const covering = grants.filter((g) => g.covers);
    if (covering.length === 0) return { result: result('DENY', 'OUT_OF_SCOPE'), grants: details };
    return {
      result: result('ALLOW', 'ALLOW_GRANT', { matchedGrantIds: covering.map((g) => g.assignment_id) }),
      grants: details,
    };
  }

  // Toàn bộ grant hiệu lực của một principal (mọi quyền), cho quy tắc quản trị tính trong bộ nhớ.
  async loadGrants(tenantId: string, principalId: string): Promise<GrantSet> {
    const [rows, pairs] = await Promise.all([
      this.db.query<{
        permission: string; assignment_id: string; role_id: string; role_key: string; role_level: number;
        scope_type: Grant['scopeType']; scope_id: string | null; scope_resource_type: string | null;
      }>(
        `SELECT p.key AS permission, g.assignment_id, g.role_id, g.role_key, g.role_level,
                g.scope_type, g.scope_id, g.scope_resource_type
           FROM permissions p
           CROSS JOIN LATERAL effective_grants($1::uuid, $2::uuid, p.key, now()) g`,
        [tenantId, principalId],
      ),
      this.db.query<{ ancestor_id: string; descendant_id: string }>(
        `SELECT c.ancestor_id, c.descendant_id FROM org_unit_closure c
           JOIN org_units o ON o.id = c.descendant_id WHERE o.tenant_id = $1`,
        [tenantId],
      ),
    ]);
    return new GrantSet(
      principalId,
      rows.map((r) => ({
        permission: r.permission,
        assignmentId: r.assignment_id,
        roleId: r.role_id,
        roleKey: r.role_key,
        roleLevel: Number(r.role_level),
        scopeType: r.scope_type,
        scopeId: r.scope_id,
        scopeResourceType: r.scope_resource_type,
      })),
      UnitTree.fromPairs(pairs),
    );
  }

  // Danh sách: hợp các scope của mọi grant hiệu lực thành một FilterPlan (tài liệu gốc §13, SPEC §8.3).
  async resolveDataScope(built: BuiltContext, action: string): Promise<DataScopeResult> {
    const entry = this.catalog.get(action);
    if (!entry) return { result: result('INDETERMINATE', 'UNKNOWN_PERMISSION') };
    const subjectDenied = this.evaluateSubject(built);
    if (subjectDenied) return { result: subjectDenied };

    let grants: GrantRow[];
    let units: string[];
    try {
      grants = await this.db.query(
        `SELECT assignment_id, scope_type, scope_id, scope_resource_type
           FROM effective_grants($1::uuid, $2::uuid, $3, now())`,
        [built.context.tenantId, built.context.principalId, action],
      );
      const unitScopes = grants
        .filter((g) => ['COMPANY', 'DEPARTMENT', 'TEAM'].includes(g.scope_type))
        .map((g) => g.scope_id);
      units = unitScopes.length
        ? (
            await this.db.query<{ id: string }>(
              `SELECT DISTINCT descendant_id AS id FROM org_unit_closure WHERE ancestor_id = ANY($1::uuid[])`,
              [unitScopes],
            )
          ).map((r) => r.id)
        : [];
    } catch {
      return { result: dbFailure() };
    }

    if (grants.length === 0) return { result: result('NOT_APPLICABLE', 'NO_GRANT') };
    const matched = grants.map((g) => g.assignment_id);
    const allow = (plan: AuthzPlan): DataScopeResult => ({
      result: result('ALLOW', 'ALLOW_GRANT', { matchedGrantIds: matched }),
      plan,
    });

    if (grants.some((g) => g.scope_type === 'TENANT')) return allow({ kind: 'TRUE' });

    const predicates: Predicate[] = [];
    if (units.length) predicates.push({ field: 'org_unit_id', op: 'IN', values: units });
    const resourceIds = grants
      .filter((g) => g.scope_type === 'RESOURCE' && g.scope_resource_type === entry.resourceType)
      .map((g) => g.scope_id as string);
    if (resourceIds.length) predicates.push({ field: 'id', op: 'IN', values: resourceIds });
    if (grants.some((g) => g.scope_type === 'SELF')) {
      predicates.push({ field: 'owner_principal_id', op: 'EQ', value: built.context.principalId });
    }

    if (predicates.some((p) => p.op === 'IN' && p.values.length > PLAN_MAX_IN_VALUES)) {
      return { result: result('INDETERMINATE', 'EVALUATION_FAILURE') };
    }
    return allow(predicates.length ? { kind: 'ANY_OF', predicates } : { kind: 'FALSE' });
  }
}

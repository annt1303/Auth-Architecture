import type { AuthzPlan, Predicate } from '@authz-demo/authz-types';

// Registry ánh xạ field của FilterPlan sang SQL cho từng loại tài nguyên (SPEC §8.3).
// Plan là dữ liệu, không bao giờ là mã: chỉ field có trong registry mới thành SQL,
// giá trị luôn đi qua tham số. Predicate có field không đăng ký bị bỏ khỏi phép OR,
// tức là thu hẹp quyền chứ không bao giờ mở rộng.
export type ScopedResourceType = 'document' | 'org_unit' | 'user' | 'role' | 'audit_event';

type FieldSql = (param: string) => string;

// Bí danh cố định của từng loại trong câu SQL của service: d = documents, o = org_units,
// p = principals, r = roles, a = audit_events.
const REGISTRY: Record<ScopedResourceType, Partial<Record<Predicate['field'], FieldSql>>> = {
  document: {
    org_unit_id: (p) => `d.org_unit_id = ANY(${p}::uuid[])`,
    id: (p) => `d.id = ANY(${p}::uuid[])`,
    owner_principal_id: (p) => `d.owner_principal_id = ${p}::uuid`,
  },
  org_unit: {
    org_unit_id: (p) => `o.id = ANY(${p}::uuid[])`,
  },
  // User thuộc phạm vi khi một affiliation của họ nằm trong đơn vị; SELF bao phủ hồ sơ của chính mình (SPEC §8.2).
  user: {
    org_unit_id: (v) =>
      `EXISTS (SELECT 1 FROM user_affiliations ua WHERE ua.principal_id = p.id AND ua.org_unit_id = ANY(${v}::uuid[]))`,
    owner_principal_id: (v) => `p.id = ${v}::uuid`,
  },
  // Role công ty C thấy được khi cây của grant giao cây của C (SPEC §8.2). Role SYSTEM/TENANT do service xử lý.
  role: {
    org_unit_id: (v) =>
      `(r.owner_company_id = ANY(${v}::uuid[]) OR EXISTS (SELECT 1 FROM org_unit_closure rc
          WHERE rc.ancestor_id = r.owner_company_id AND rc.descendant_id = ANY(${v}::uuid[])))`,
  },
  // org_unit_id NULL là sự kiện cấp tenant: chỉ plan TRUE nhìn thấy (SPEC §13.1)
  audit_event: {
    org_unit_id: (p) => `a.org_unit_id = ANY(${p}::uuid[])`,
  },
};

export const PLAN_MAX_IN_VALUES = 1000; // giả định A10

export class SqlParams {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export function planToSql(plan: AuthzPlan, type: ScopedResourceType, params: SqlParams): string {
  if (plan.kind === 'TRUE') return 'TRUE';
  if (plan.kind === 'FALSE') return 'FALSE';
  const fields = REGISTRY[type];
  const parts: string[] = [];
  for (const pred of plan.predicates) {
    const toSql = fields[pred.field];
    if (!toSql) continue;
    parts.push(toSql(params.add(pred.op === 'IN' ? pred.values : pred.value)));
  }
  return parts.length ? `(${parts.join(' OR ')})` : 'FALSE';
}

// Cùng plan, đánh giá trên một phần tử đã nạp. Dùng để tính _actions cho từng phần tử của danh sách.
// units: các đơn vị của phần tử (tài liệu có một, user có thể có nhiều affiliation, cấp tenant thì rỗng).
export type PlanSubject = { id?: string; units: string[]; ownerId?: string };

export function planCovers(plan: AuthzPlan, type: ScopedResourceType, subject: PlanSubject): boolean {
  if (plan.kind !== 'ANY_OF') return plan.kind === 'TRUE';
  const fields = REGISTRY[type];
  return plan.predicates.some((pred) => {
    if (!fields[pred.field]) return false;
    if (pred.field === 'owner_principal_id') return subject.ownerId === pred.value;
    if (pred.field === 'id') return !!subject.id && pred.values.includes(subject.id);
    return subject.units.some((u) => pred.values.includes(u));
  });
}

export function planMatches(
  plan: AuthzPlan,
  type: ScopedResourceType,
  row: { id: string; org_unit_id: string; owner_principal_id?: string },
): boolean {
  return planCovers(plan, type, { id: row.id, units: [row.org_unit_id], ownerId: row.owner_principal_id });
}

import type { ResourceAttrs } from '@authz-demo/authz-types';

// Grant hiệu lực của một principal, nạp một lần cho cả quy tắc quản trị (SPEC §10) để tính rank và
// tập con quyền trong bộ nhớ. Cùng định nghĩa bao phủ với SQL của Pdp.check (SPEC §8.2);
// test/authz-tools.e2e-spec.ts đối chiếu hai đường này.
export type Grant = {
  permission: string;
  assignmentId: string;
  roleId: string;
  roleKey: string;
  roleLevel: number;
  scopeType: 'TENANT' | 'COMPANY' | 'DEPARTMENT' | 'TEAM' | 'RESOURCE' | 'SELF';
  scopeId: string | null;
  scopeResourceType: string | null;
};

// Bao đóng của cây tổ chức: tổ tiên của từng đơn vị (gồm chính nó).
export class UnitTree {
  constructor(private readonly ancestors: Map<string, Set<string>>) {}

  static fromPairs(pairs: { ancestor_id: string; descendant_id: string }[]): UnitTree {
    const map = new Map<string, Set<string>>();
    for (const { ancestor_id, descendant_id } of pairs) {
      const set = map.get(descendant_id) ?? new Set<string>();
      set.add(ancestor_id);
      map.set(descendant_id, set);
    }
    return new UnitTree(map);
  }

  /** Scope đơn vị `scopeId` bao phủ đơn vị `unit` (unit nằm trong cây con của scope). */
  covers(scopeId: string, unit: string): boolean {
    return this.ancestors.get(unit)?.has(scopeId) ?? false;
  }

  /** Đơn vị và mọi đơn vị con của nó. */
  subtree(root: string): string[] {
    const out: string[] = [];
    for (const [unit, set] of this.ancestors) if (set.has(root)) out.push(unit);
    return out;
  }

  isInside(unit: string, root: string): boolean {
    return this.covers(root, unit);
  }
}

export class GrantSet {
  constructor(
    readonly principalId: string,
    readonly grants: Grant[],
    readonly tree: UnitTree,
  ) {}

  covers(grant: Grant, res: ResourceAttrs): boolean {
    if (res.anyScope) return true;
    switch (grant.scopeType) {
      case 'TENANT':
        return true;
      case 'COMPANY':
      case 'DEPARTMENT':
      case 'TEAM':
        return res.units.some((u) => this.tree.covers(grant.scopeId!, u));
      case 'RESOURCE':
        return grant.scopeResourceType === res.type && !!res.id && grant.scopeId === res.id;
      case 'SELF':
        return !!res.ownerId && res.ownerId === this.principalId;
    }
  }

  forPermission(permission: string): Grant[] {
    return this.grants.filter((g) => g.permission === permission);
  }

  covering(permission: string, res: ResourceAttrs): Grant[] {
    return this.forPermission(permission).filter((g) => this.covers(g, res));
  }

  has(permission: string, res: ResourceAttrs): boolean {
    return this.covering(permission, res).length > 0;
  }

  /** rank(actor, p, S): level nhỏ nhất (cao nhất) trong các grant vừa trao p vừa bao phủ S; null nếu không có (SPEC §10). */
  rank(permission: string, res: ResourceAttrs): number | null {
    const levels = this.covering(permission, res).map((g) => g.roleLevel);
    return levels.length ? Math.min(...levels) : null;
  }
}

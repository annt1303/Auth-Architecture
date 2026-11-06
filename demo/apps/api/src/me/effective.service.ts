import { Injectable } from '@nestjs/common';
import type { EffectivePermissionDto } from '@authz-demo/authz-types';
import { SCOPE_LABEL_COLUMN, SCOPE_LABEL_JOINS, toScopeDto } from '../common/scope-label.js';
import { Db } from '../db/db.js';

// Quyền hiệu lực của một principal: mỗi quyền kèm các scope đang trao quyền đó.
// Dùng chung cho /me, tab "Quyền hiệu lực" của user và ma trận quyền (SPEC §14).
@Injectable()
export class EffectiveService {
  constructor(private readonly db: Db) {}

  async permissions(tenantId: string, principalId: string): Promise<EffectivePermissionDto[]> {
    const grants = await this.db.query<{
      key: string; scope_type: string; scope_id: string | null;
      scope_resource_type: string | null; scope_name: string | null;
    }>(
      `SELECT p.key, g.scope_type, g.scope_id, g.scope_resource_type, ${SCOPE_LABEL_COLUMN}
         FROM permissions p
         CROSS JOIN LATERAL effective_grants($1::uuid, $2::uuid, p.key, now()) g
         ${SCOPE_LABEL_JOINS}
        ORDER BY p.key`,
      [tenantId, principalId],
    );
    const byPermission = new Map<string, Map<string, ReturnType<typeof toScopeDto>>>();
    for (const g of grants) {
      const scopes = byPermission.get(g.key) ?? new Map();
      const scope = toScopeDto(g);
      scopes.set(`${scope.type}:${scope.id ?? ''}`, scope);
      byPermission.set(g.key, scopes);
    }
    return [...byPermission].map(([permission, scopes]) => ({ permission, scopes: [...scopes.values()] }));
  }
}

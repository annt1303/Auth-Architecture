import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Db } from '../db/db.js';

export type PermissionEntry = {
  key: string;
  resourceType: string;
  riskLevel: 'LOW' | 'HIGH';
  isVisibility: boolean;
  tenantScopeOnly: boolean;
};

// Permission catalog được nạp một lần lúc khởi động (SPEC §7.1).
// Thay đổi catalog đi kèm migration và khởi động lại app.
@Injectable()
export class PermissionCatalog implements OnModuleInit {
  private entries = new Map<string, PermissionEntry>();

  constructor(private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    const rows = await this.db.query<{
      key: string;
      resource_type: string;
      risk_level: 'LOW' | 'HIGH';
      is_visibility: boolean;
      tenant_scope_only: boolean;
    }>(
      `SELECT key, resource_type, risk_level, is_visibility, tenant_scope_only
         FROM permissions WHERE deprecated_at IS NULL`,
    );
    this.entries = new Map(
      rows.map((r) => [
        r.key,
        {
          key: r.key,
          resourceType: r.resource_type,
          riskLevel: r.risk_level,
          isVisibility: r.is_visibility,
          tenantScopeOnly: r.tenant_scope_only,
        },
      ]),
    );
  }

  get(key: string): PermissionEntry | undefined {
    return this.entries.get(key);
  }

  keys(): string[] {
    return [...this.entries.keys()].sort();
  }
}

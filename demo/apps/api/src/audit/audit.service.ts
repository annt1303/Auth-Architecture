import { Injectable } from '@nestjs/common';
import type { AuditEventDto, AuditPageDto, AuthzPlan } from '@authz-demo/authz-types';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { planToSql, SqlParams } from '../authz/data-scope.js';
import { Db } from '../db/db.js';

export type AuditFilter = {
  eventClass?: 'A' | 'B';
  eventType?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit: number;
};

type Row = {
  event_id: string; event_class: 'A' | 'B'; event_type: string; occurred_at: Date;
  org_unit_id: string | null; unit_code: string | null; unit_name: string | null; unit_type: 'COMPANY' | 'DEPARTMENT' | 'TEAM' | null;
  actor_id: string | null; actor_name: string | null; actor_attributed: boolean; correlation_id: string | null;
  target_type: string | null; target_id: string | null; target_label: string | null; payload: Record<string, unknown>;
};

// Con trỏ: (thời điểm, id) của dòng cuối trang trước, để phân trang ổn định khi có sự kiện mới
const encodeCursor = (r: Row) => Buffer.from(`${r.occurred_at.toISOString()}|${r.event_id}`).toString('base64url');
const decodeCursor = (c: string): [string, string] | null => {
  const [t, id] = Buffer.from(c, 'base64url').toString().split('|');
  return t && id && !Number.isNaN(Date.parse(t)) ? [t, id] : null;
};

@Injectable()
export class AuditService {
  constructor(private readonly db: Db) {}

  // Lọc theo phạm vi giống danh sách tài liệu (SPEC §13.1): plan TRUE thấy cả sự kiện cấp tenant (org_unit_id NULL),
  // plan theo đơn vị chỉ thấy sự kiện của đơn vị trong cây.
  async list(built: BuiltContext, plan: AuthzPlan, f: AuditFilter): Promise<AuditPageDto> {
    const params = new SqlParams();
    // principals không có cột tenant; app chỉ có một tenant nên sự kiện không gắn tenant vẫn thuộc về nó
    const where = [`(a.tenant_id = ${params.add(built.context.tenantId)} OR a.tenant_id IS NULL)`];
    const scope = planToSql(plan, 'audit_event', params);
    if (scope === 'FALSE') return { items: [], nextCursor: null };
    where.push(scope);
    if (f.eventClass) where.push(`a.event_class = ${params.add(f.eventClass)}`);
    if (f.eventType) where.push(`a.event_type = ${params.add(f.eventType)}`);
    if (f.actorId) where.push(`a.actor_id = ${params.add(f.actorId)}`);
    if (f.targetType) where.push(`a.target_type = ${params.add(f.targetType)}`);
    if (f.targetId) where.push(`a.target_id = ${params.add(f.targetId)}`);
    if (f.from) where.push(`a.occurred_at >= ${params.add(f.from)}`);
    if (f.to) where.push(`a.occurred_at < ${params.add(f.to)}`);
    const cursor = f.cursor ? decodeCursor(f.cursor) : null;
    if (cursor) where.push(`(a.occurred_at, a.event_id) < (${params.add(cursor[0])}::timestamptz, ${params.add(cursor[1])}::uuid)`);

    const rows = await this.db.query<Row>(
      `SELECT a.event_id, a.event_class, a.event_type, a.occurred_at, a.org_unit_id,
              o.code AS unit_code, o.name AS unit_name, o.unit_type,
              a.actor_id, ap.display_name AS actor_name, a.actor_attributed, a.correlation_id,
              a.target_type, a.target_id,
              CASE a.target_type
                WHEN 'principals' THEN (SELECT email FROM principals WHERE id = a.target_id)
                WHEN 'org_units' THEN (SELECT name FROM org_units WHERE id = a.target_id)
                WHEN 'roles' THEN (SELECT name FROM roles WHERE id = a.target_id)
                WHEN 'documents' THEN (SELECT title FROM documents WHERE id = a.target_id)
                WHEN 'company_domains' THEN (SELECT domain FROM company_domains WHERE id = a.target_id)
                WHEN 'tenant_memberships' THEN (SELECT p.email FROM tenant_memberships m JOIN principals p ON p.id = m.principal_id WHERE m.id = a.target_id)
                WHEN 'tenant_role_assignments' THEN (SELECT r.name || ' · ' || p.email FROM tenant_role_assignments g
                                                       JOIN roles r ON r.id = g.role_id JOIN principals p ON p.id = g.principal_id WHERE g.id = a.target_id)
                WHEN 'user_affiliations' THEN (SELECT p.email FROM user_affiliations u JOIN principals p ON p.id = u.principal_id WHERE u.id = a.target_id)
              END AS target_label,
              a.payload
         FROM audit_events a
         LEFT JOIN org_units o ON o.id = a.org_unit_id
         LEFT JOIN principals ap ON ap.id = a.actor_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.occurred_at DESC, a.event_id DESC
        LIMIT ${params.add(f.limit + 1)}`,
      params.values,
    );
    const page = rows.slice(0, f.limit);
    return {
      items: page.map(toDto),
      nextCursor: rows.length > f.limit ? encodeCursor(page[page.length - 1]!) : null,
    };
  }
}

function toDto(r: Row): AuditEventDto {
  return {
    id: r.event_id,
    eventClass: r.event_class,
    eventType: r.event_type,
    occurredAt: r.occurred_at.toISOString(),
    orgUnit: r.org_unit_id ? { id: r.org_unit_id, code: r.unit_code!, name: r.unit_name!, type: r.unit_type! } : null,
    actor: r.actor_id ? { id: r.actor_id, displayName: r.actor_name ?? '' } : null,
    actorAttributed: r.actor_attributed,
    correlationId: r.correlation_id,
    targetType: r.target_type,
    targetId: r.target_id,
    targetLabel: r.target_label,
    payload: r.payload,
  };
}

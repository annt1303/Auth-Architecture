import { Injectable } from '@nestjs/common';
import type { AuthzPlan, DocumentAction, DocumentDto } from '@authz-demo/authz-types';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { planMatches, planToSql, SqlParams } from '../authz/data-scope.js';
import { Pdp } from '../authz/pdp.service.js';
import { Db } from '../db/db.js';

type DocumentRow = {
  id: string;
  title: string;
  body: string;
  status: DocumentDto['status'];
  org_unit_id: string;
  owner_principal_id: string;
  created_at: Date;
  updated_at: Date;
  unit_code: string;
  unit_name: string;
  unit_type: DocumentDto['orgUnit']['type'];
  owner_name: string;
};

const SELECT_DOCUMENT = `
  SELECT d.id, d.title, d.body, d.status, d.org_unit_id, d.owner_principal_id, d.created_at, d.updated_at,
         u.code AS unit_code, u.name AS unit_name, u.unit_type, p.display_name AS owner_name
    FROM documents d
    JOIN org_units u ON u.id = d.org_unit_id
    JOIN principals p ON p.id = d.owner_principal_id`;

export type ListFilter = { status?: DocumentDto['status']; limit: number };
export type NewDocument = { title: string; body: string; status: DocumentDto['status']; orgUnitId: string };
export type DocumentPatch = Partial<Pick<NewDocument, 'title' | 'body' | 'status'>>;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: Db,
    private readonly pdp: Pdp,
  ) {}

  // Tầng dữ liệu luôn thêm tenant_id và deleted_at; FilterPlan và bộ lọc của người dùng được AND
  // vào sau, không thể ghi đè hai điều kiện đầu (tài liệu gốc §13.3).
  async list(built: BuiltContext, plan: AuthzPlan, filter: ListFilter): Promise<DocumentDto[]> {
    const params = new SqlParams();
    const where = [`d.tenant_id = ${params.add(built.context.tenantId)}`, 'd.deleted_at IS NULL'];
    const scope = planToSql(plan, 'document', params);
    if (scope === 'FALSE') return [];
    where.push(scope);
    if (filter.status) where.push(`d.status = ${params.add(filter.status)}`);
    const rows = await this.db.query<DocumentRow>(
      `${SELECT_DOCUMENT} WHERE ${where.join(' AND ')}
        ORDER BY d.created_at DESC, d.id DESC LIMIT ${params.add(filter.limit)}`,
      params.values,
    );
    const actions = await this.actionPlans(built);
    return rows.map((r) => toDto(r, actions));
  }

  async get(built: BuiltContext, id: string): Promise<DocumentDto> {
    const [row] = await this.db.query<DocumentRow>(
      `${SELECT_DOCUMENT} WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
      [built.context.tenantId, id],
    );
    if (!row) throw new Error(`document ${id} vanished after authorization`);
    return toDto(row, await this.actionPlans(built));
  }

  async create(built: BuiltContext, input: NewDocument): Promise<DocumentDto> {
    const { tenantId, principalId, correlationId } = built.context;
    const id = await this.db.withActor({ principalId, correlationId }, async (tx) => {
      // Đích đã được PEP nạp và kiểm tra; ở đây chỉ suy ra company/department/team từ loại đơn vị.
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO documents (tenant_id, company_id, department_id, team_id, owner_principal_id, title, body, status)
         SELECT u.tenant_id, u.company_id,
                CASE WHEN u.unit_type = 'DEPARTMENT' THEN u.id END,
                CASE WHEN u.unit_type = 'TEAM' THEN u.id END,
                $3, $4, $5, $6
           FROM org_units u WHERE u.tenant_id = $1 AND u.id = $2
         RETURNING id`,
        [tenantId, input.orgUnitId, principalId, input.title, input.body, input.status],
      );
      return row!.id;
    });
    return this.get(built, id);
  }

  async update(built: BuiltContext, id: string, patch: DocumentPatch): Promise<DocumentDto> {
    const { tenantId, principalId, correlationId } = built.context;
    await this.db.withActor({ principalId, correlationId }, (tx) =>
      tx.query(
        `UPDATE documents SET title = coalesce($3, title), body = coalesce($4, body), status = coalesce($5, status)
          WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id, patch.title ?? null, patch.body ?? null, patch.status ?? null],
      ),
    );
    return this.get(built, id);
  }

  async remove(built: BuiltContext, id: string): Promise<void> {
    const { tenantId, principalId, correlationId } = built.context;
    await this.db.withActor({ principalId, correlationId }, (tx) =>
      tx.query(`UPDATE documents SET deleted_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [
        tenantId,
        id,
      ]),
    );
  }

  // _actions chỉ phục vụ UX (ẩn/hiện nút). Tính bằng chính PDP: một FilterPlan cho mỗi action,
  // rồi so từng dòng với plan. API vẫn kiểm tra lại ở mọi request (tài liệu gốc §3.3).
  private async actionPlans(built: BuiltContext): Promise<Partial<Record<DocumentAction, AuthzPlan>>> {
    const plans: Partial<Record<DocumentAction, AuthzPlan>> = {};
    for (const action of ['update', 'delete'] as const) {
      const scope = await this.pdp.resolveDataScope(built, `document.${action}`);
      if (scope.result.state === 'ALLOW' && scope.plan) plans[action] = scope.plan;
    }
    return plans;
  }
}

function toDto(r: DocumentRow, plans: Partial<Record<DocumentAction, AuthzPlan>>): DocumentDto {
  const actions: DocumentAction[] = ['read'];
  for (const action of ['update', 'delete'] as const) {
    const plan = plans[action];
    if (plan && planMatches(plan, 'document', r)) actions.push(action);
  }
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    status: r.status,
    orgUnit: { id: r.org_unit_id, code: r.unit_code, name: r.unit_name, type: r.unit_type },
    owner: { id: r.owner_principal_id, displayName: r.owner_name },
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    _actions: actions,
  };
}

import { Injectable } from '@nestjs/common';
import type { AuthzPlan, OrgUnitDto, OrgUnitTreeDto } from '@authz-demo/authz-types';
import type { BuiltContext } from '../authz/context-builder.service.js';
import { planCovers, planToSql, SqlParams } from '../authz/data-scope.js';
import { Pdp } from '../authz/pdp.service.js';
import { ApiError } from '../common/api-error.js';
import { Db } from '../db/db.js';

type UnitRow = {
  id: string; code: string; name: string; unit_type: OrgUnitDto['type'];
  parent_id: string | null; company_id: string; status: OrgUnitDto['status'];
};

const toDto = (r: UnitRow): OrgUnitDto => ({
  id: r.id,
  code: r.code,
  name: r.name,
  type: r.unit_type,
  parentId: r.parent_id,
  companyId: r.company_id,
  status: r.status,
});

export type NewOrgUnit = { parentId?: string | null; unitType: OrgUnitDto['type']; code: string; name: string };

@Injectable()
export class OrgUnitsService {
  constructor(
    private readonly db: Db,
    private readonly pdp: Pdp,
  ) {}

  // Đơn vị ACTIVE nằm trong FilterPlan. Plan của action nào thì ra tập đơn vị của action đó:
  // org_unit.read -> đơn vị nhìn thấy; document.create -> đơn vị được tạo tài liệu.
  async list(built: BuiltContext, plan: AuthzPlan): Promise<OrgUnitDto[]> {
    const params = new SqlParams();
    const tenant = params.add(built.context.tenantId);
    const scope = planToSql(plan, 'org_unit', params);
    if (scope === 'FALSE') return [];
    const rows = await this.db.query<UnitRow>(
      `SELECT o.id, o.code, o.name, o.unit_type, o.parent_id, o.company_id, o.status
         FROM org_units o
        WHERE o.tenant_id = ${tenant} AND o.status = 'ACTIVE' AND ${scope}
        ORDER BY o.code`,
      params.values,
    );
    return rows.map(toDto);
  }

  // Danh sách cho màn Tổ chức: kèm _actions (chỉ phục vụ UX, API kiểm tra lại, tài liệu gốc §3.3)
  async listWithActions(built: BuiltContext, plan: AuthzPlan): Promise<OrgUnitTreeDto[]> {
    const units = await this.list(built, plan);
    const manage = await this.pdp.resolveDataScope(built, 'org_unit.manage');
    return units.map((u) => ({
      ...u,
      _actions: manage.plan && planCovers(manage.plan, 'org_unit', { units: [u.id] }) ? ['manage'] : [],
    }));
  }

  async get(built: BuiltContext, id: string): Promise<OrgUnitTreeDto> {
    const [row] = await this.db.query<UnitRow>(
      `SELECT id, code, name, unit_type, parent_id, company_id, status FROM org_units WHERE tenant_id = $1 AND id = $2`,
      [built.context.tenantId, id],
    );
    if (!row) throw new Error(`org unit ${id} vanished after authorization`);
    const manage = await this.pdp.resolveDataScope(built, 'org_unit.manage');
    const canManage = !!manage.plan && planCovers(manage.plan, 'org_unit', { units: [id] });
    return { ...toDto(row), _actions: canManage ? ['manage'] : [] };
  }

  async create(built: BuiltContext, input: NewOrgUnit): Promise<OrgUnitTreeDto> {
    const { tenantId, principalId, correlationId } = built.context;
    const id = await this.db.withActor({ principalId, correlationId }, async (tx) => {
      // Cha, loại và quy tắc lồng nhau do trigger org_units_before kiểm tra
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO org_units (tenant_id, unit_type, parent_id, code, name, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, input.unitType, input.parentId ?? null, input.code, input.name, principalId],
      );
      return row!.id;
    });
    return this.get(built, id);
  }

  async rename(built: BuiltContext, id: string, name: string): Promise<OrgUnitTreeDto> {
    const { tenantId, principalId, correlationId } = built.context;
    await this.db.withActor({ principalId, correlationId }, (tx) =>
      tx.query(`UPDATE org_units SET name = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, name]),
    );
    return this.get(built, id);
  }

  // SPEC §6.2: chỉ lưu trữ khi không còn đơn vị con ACTIVE, assignment ACTIVE hay tài liệu.
  async archive(built: BuiltContext, id: string): Promise<OrgUnitTreeDto> {
    const { tenantId, principalId, correlationId } = built.context;
    await this.db.withActor({ principalId, correlationId, reason: 'archive org unit' }, async (tx) => {
      const [busy] = await tx.query<{ busy: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM org_units WHERE tenant_id = $1 AND parent_id = $2 AND status = 'ACTIVE')
             OR EXISTS (SELECT 1 FROM tenant_role_assignments
                         WHERE tenant_id = $1 AND scope_id = $2 AND status = 'ACTIVE')
             OR EXISTS (SELECT 1 FROM documents WHERE tenant_id = $1 AND org_unit_id = $2 AND deleted_at IS NULL) AS busy`,
        [tenantId, id],
      );
      if (busy?.busy) throw new ApiError('conflict');
      await tx.query(`UPDATE org_units SET status = 'ARCHIVED' WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    });
    return this.get(built, id);
  }
}

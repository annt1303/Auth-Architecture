import { Injectable } from '@nestjs/common';
import type { ResourceAttrs } from '@authz-demo/authz-types';
import type { Request } from 'express';
import { z } from 'zod';
import { ApiError, parseInput } from '../common/api-error.js';
import { Db } from '../db/db.js';

// Resource Resolver (tài liệu gốc §3.3, §12.2): nạp tài nguyên bằng truy vấn có điều kiện
// tenant, trả về thuộc tính có thẩm quyền cho PDP. Không tìm thấy thì trả null (PEP trả 404).
// Một dòng của tenant khác không phân biệt được với việc không có dòng.

export type ResolvedResource = {
  attrs: ResourceAttrs;
  // Quyền "nhìn thấy" dùng để chọn 403 hay 404 khi bị từ chối (tài liệu gốc §12.3).
  visibility: { action: string; attrs: ResourceAttrs };
};

export type ResourceKind =
  | 'document'
  | 'document_destination'
  | 'org_unit' // :id
  | 'org_unit_parent' // body.parentId (không có = tạo công ty gốc, cấp tenant)
  | 'company' // :id, phải là COMPANY
  | 'company_domain' // :id
  | 'user' // :id
  | 'user_query' // ?userId=
  | 'user_create_target' // body.companyId
  | 'user_affiliation' // :id + (:companyId | body.companyId)
  | 'user_membership' // :id, cấp tenant
  | 'role_read' // :id
  | 'role_manage' // :id
  | 'role_create' // body.ownerKind, body.ownerCompanyId
  | 'assignment' // :id
  | 'assignment_create' // body.userId, body.scope
  | 'tenant'; // không tham số, cấp tenant

const IdParam = z.object({ id: z.uuid() });
const Destination = z.object({ orgUnitId: z.uuid() });
const ParentBody = z.object({ parentId: z.uuid().nullish() });
const CompanyBody = z.object({ companyId: z.uuid() });
const AffiliationParams = z.object({ id: z.uuid(), companyId: z.uuid().optional() });
const UserQuery = z.object({ userId: z.uuid() });
const RoleCreateBody = z.object({ ownerKind: z.enum(['TENANT', 'COMPANY']), ownerCompanyId: z.uuid().nullish() });
export const ScopeInput = z.object({
  type: z.enum(['TENANT', 'COMPANY', 'DEPARTMENT', 'TEAM', 'RESOURCE', 'SELF']),
  id: z.uuid().nullish(),
});
const AssignmentCreateBody = z.object({ userId: z.uuid(), scope: ScopeInput });

@Injectable()
export class ResourceResolver {
  constructor(private readonly db: Db) {}

  async resolve(kind: ResourceKind, req: Request, tenantId: string): Promise<ResolvedResource | null> {
    switch (kind) {
      case 'document':
        return this.documentById(parseInput(IdParam, req.params).id, tenantId);
      case 'document_destination':
        return this.documentDestination(req, tenantId);
      case 'org_unit':
        return this.orgUnit(parseInput(IdParam, req.params).id, tenantId);
      case 'org_unit_parent': {
        const { parentId } = parseInput(ParentBody, req.body);
        return parentId ? this.orgUnit(parentId, tenantId) : this.tenantLevel('org_unit', tenantId);
      }
      case 'company':
        return this.company(parseInput(IdParam, req.params).id, tenantId);
      case 'company_domain':
        return this.companyDomain(parseInput(IdParam, req.params).id, tenantId);
      case 'user':
        return this.user(parseInput(IdParam, req.params).id, tenantId);
      case 'user_query':
        return this.user(parseInput(UserQuery, req.query).userId, tenantId);
      case 'user_create_target':
        return this.company(parseInput(CompanyBody, req.body).companyId, tenantId, 'user');
      case 'user_affiliation': {
        const p = parseInput(AffiliationParams, req.params);
        const companyId = p.companyId ?? parseInput(CompanyBody, req.body).companyId;
        return this.userAffiliation(p.id, companyId, tenantId);
      }
      case 'user_membership': {
        const user = await this.user(parseInput(IdParam, req.params).id, tenantId);
        return (
          user && {
            attrs: { type: 'tenant_membership', id: user.attrs.id, tenantId, units: [] },
            visibility: user.visibility,
          }
        );
      }
      case 'role_read':
        return this.role(parseInput(IdParam, req.params).id, tenantId, false);
      case 'role_manage':
        return this.role(parseInput(IdParam, req.params).id, tenantId, true);
      case 'role_create':
        return this.roleCreate(parseInput(RoleCreateBody, req.body), tenantId);
      case 'assignment':
        return this.assignment(parseInput(IdParam, req.params).id, tenantId);
      case 'assignment_create':
        return this.assignmentCreate(parseInput(AssignmentCreateBody, req.body), tenantId);
      case 'tenant':
        return this.tenantLevel('tenant', tenantId);
    }
  }

  // Tra theo (loại, id) cho Simulator và "Ai có quyền", không cần request.
  async byRef(ref: { type: string; id?: string }, tenantId: string, manage = false): Promise<ResolvedResource | null> {
    if (ref.type === 'tenant' || !ref.id) return this.tenantLevel(ref.type || 'tenant', tenantId);
    switch (ref.type) {
      case 'document':
        return this.documentById(ref.id, tenantId);
      case 'org_unit':
        return this.orgUnit(ref.id, tenantId);
      case 'user':
        return this.user(ref.id, tenantId);
      case 'role':
        return this.role(ref.id, tenantId, manage);
      case 'assignment':
        return this.assignment(ref.id, tenantId);
      case 'company_domain':
        return this.companyDomain(ref.id, tenantId);
      default:
        return null;
    }
  }

  /** Đơn vị của một scope assignment (SPEC §8.2). null = scope trỏ tới thứ không tồn tại / sai loại. */
  async scopeUnits(scope: { type: string; id?: string | null }, tenantId: string): Promise<string[] | null> {
    if (scope.type === 'TENANT' || scope.type === 'SELF') return [];
    if (!scope.id) return null;
    if (scope.type === 'RESOURCE') {
      const [doc] = await this.db.query<{ org_unit_id: string }>(
        `SELECT org_unit_id FROM documents WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, scope.id],
      );
      return doc ? [doc.org_unit_id] : null;
    }
    const [unit] = await this.db.query<{ id: string }>(
      `SELECT id FROM org_units WHERE tenant_id = $1 AND id = $2 AND unit_type = $3`,
      [tenantId, scope.id, scope.type],
    );
    return unit ? [unit.id] : null;
  }

  private tenantLevel(type: string, tenantId: string): ResolvedResource {
    const attrs: ResourceAttrs = { type, tenantId, units: [] };
    const seen: ResourceAttrs = { type: 'org_unit', tenantId, units: [], anyScope: true };
    return { attrs, visibility: { action: 'org_unit.read', attrs: seen } };
  }

  private async documentById(id: string, tenantId: string): Promise<ResolvedResource | null> {
    const [row] = await this.db.query<{ org_unit_id: string; owner_principal_id: string }>(
      `SELECT org_unit_id, owner_principal_id FROM documents
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    if (!row) return null;
    const attrs: ResourceAttrs = {
      type: 'document',
      id,
      tenantId,
      units: [row.org_unit_id],
      ownerId: row.owner_principal_id,
    };
    return { attrs, visibility: { action: 'document.read', attrs } };
  }

  // Tạo mới: tài nguyên chưa tồn tại nên kiểm tra quyền trên đơn vị đích (tài liệu gốc §12.1).
  // Không đặt ownerId: grant SELF không bao phủ việc tạo, nếu không thì member@SELF sẽ tạo được
  // tài liệu ở bất kỳ đơn vị nào (SPEC §10.9).
  private async documentDestination(req: Request, tenantId: string): Promise<ResolvedResource | null> {
    const { orgUnitId } = parseInput(Destination, req.body);
    const [row] = await this.db.query<{ id: string }>(
      `SELECT id FROM org_units WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'`,
      [tenantId, orgUnitId],
    );
    if (!row) return null;
    const unit: ResourceAttrs = { type: 'org_unit', id: orgUnitId, tenantId, units: [orgUnitId] };
    return {
      attrs: { type: 'document', tenantId, units: [orgUnitId] },
      visibility: { action: 'org_unit.read', attrs: unit },
    };
  }

  private async orgUnit(id: string, tenantId: string): Promise<ResolvedResource | null> {
    const [row] = await this.db.query<{ id: string }>(`SELECT id FROM org_units WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    if (!row) return null;
    const attrs: ResourceAttrs = { type: 'org_unit', id, tenantId, units: [id] };
    return { attrs, visibility: { action: 'org_unit.read', attrs } };
  }

  // `as`: loại tài nguyên mà đích đại diện (vd. đích của user.create là một công ty)
  private async company(id: string, tenantId: string, as = 'company_domain'): Promise<ResolvedResource | null> {
    const [row] = await this.db.query<{ id: string }>(
      `SELECT id FROM org_units WHERE tenant_id = $1 AND id = $2 AND unit_type = 'COMPANY'`,
      [tenantId, id],
    );
    if (!row) return null;
    const unit: ResourceAttrs = { type: 'org_unit', id, tenantId, units: [id] };
    return { attrs: { type: as, id, tenantId, units: [id] }, visibility: { action: 'org_unit.read', attrs: unit } };
  }

  private async companyDomain(id: string, tenantId: string): Promise<ResolvedResource | null> {
    const [row] = await this.db.query<{ company_id: string }>(
      `SELECT company_id FROM company_domains WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (!row) return null;
    const unit: ResourceAttrs = { type: 'org_unit', id: row.company_id, tenantId, units: [row.company_id] };
    return {
      attrs: { type: 'company_domain', id, tenantId, units: [row.company_id] },
      visibility: { action: 'org_unit.read', attrs: unit },
    };
  }

  private async user(id: string, tenantId: string): Promise<ResolvedResource | null> {
    const [member] = await this.db.query<{ principal_id: string }>(
      `SELECT principal_id FROM tenant_memberships WHERE tenant_id = $1 AND principal_id = $2`,
      [tenantId, id],
    );
    if (!member) return null;
    const rows = await this.db.query<{ org_unit_id: string }>(
      `SELECT org_unit_id FROM user_affiliations WHERE tenant_id = $1 AND principal_id = $2`,
      [tenantId, id],
    );
    const attrs: ResourceAttrs = { type: 'user', id, tenantId, units: rows.map((r) => r.org_unit_id), ownerId: id };
    return { attrs, visibility: { action: 'user.read', attrs } };
  }

  // Đích của quản lý affiliation là công ty; "user nằm trong phạm vi user.read" kiểm riêng ở quy tắc.
  private async userAffiliation(userId: string, companyId: string, tenantId: string): Promise<ResolvedResource | null> {
    const user = await this.user(userId, tenantId);
    const company = await this.company(companyId, tenantId);
    if (!user || !company) return null;
    return {
      attrs: { type: 'user_affiliation', id: userId, tenantId, units: [companyId] },
      visibility: user.visibility,
    };
  }

  // Read: role SYSTEM/TENANT thấy bằng mọi grant role.read; role công ty C thấy khi cây của grant giao cây của C
  // (units = C và các đơn vị con: scope là tổ tiên của C hoặc nằm trong C đều bao phủ). Manage: scope phải bao phủ C.
  private async role(id: string, tenantId: string, manage: boolean): Promise<ResolvedResource | null> {
    const [row] = await this.db.query<{ owner_kind: string; owner_company_id: string | null }>(
      `SELECT owner_kind, owner_company_id FROM roles WHERE id = $1 AND (owner_kind = 'SYSTEM' OR tenant_id = $2)`,
      [id, tenantId],
    );
    if (!row) return null;
    let visibleUnits: string[] = [];
    if (row.owner_company_id) {
      visibleUnits = (
        await this.db.query<{ id: string }>(`SELECT descendant_id AS id FROM org_unit_closure WHERE ancestor_id = $1`, [
          row.owner_company_id,
        ])
      ).map((r) => r.id);
    }
    const readAttrs: ResourceAttrs = { type: 'role', id, tenantId, units: visibleUnits, anyScope: !row.owner_company_id };
    const attrs: ResourceAttrs = manage
      ? { type: 'role', id, tenantId, units: row.owner_company_id ? [row.owner_company_id] : [] }
      : readAttrs;
    return { attrs, visibility: { action: 'role.read', attrs: readAttrs } };
  }

  private async roleCreate(body: z.infer<typeof RoleCreateBody>, tenantId: string): Promise<ResolvedResource | null> {
    if (body.ownerKind === 'TENANT') {
      const seen: ResourceAttrs = { type: 'role', tenantId, units: [], anyScope: true };
      return { attrs: { type: 'role', tenantId, units: [] }, visibility: { action: 'role.read', attrs: seen } };
    }
    if (!body.ownerCompanyId) {
      throw new ApiError('invalid_request', [{ field: 'ownerCompanyId', issue: 'Required for COMPANY roles' }]);
    }
    return this.company(body.ownerCompanyId, tenantId, 'role');
  }

  private async assignment(id: string, tenantId: string): Promise<ResolvedResource | null> {
    const [row] = await this.db.query<{ scope_type: string; scope_id: string | null; principal_id: string }>(
      `SELECT scope_type, scope_id, principal_id FROM tenant_role_assignments WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (!row) return null;
    const units = (await this.scopeUnits({ type: row.scope_type, id: row.scope_id }, tenantId)) ?? [];
    const attrs: ResourceAttrs = { type: 'assignment', id, tenantId, units };
    // Thấy assignment khi thấy user sở hữu nó (user_role.read): dùng thuộc tính của user đó.
    const owner = await this.user(row.principal_id, tenantId);
    return { attrs, visibility: { action: 'user_role.read', attrs: owner ? owner.attrs : attrs } };
  }

  private async assignmentCreate(
    body: z.infer<typeof AssignmentCreateBody>,
    tenantId: string,
  ): Promise<ResolvedResource | null> {
    const user = await this.user(body.userId, tenantId);
    if (!user) return null;
    const units = await this.scopeUnits(body.scope, tenantId);
    if (!units) return null;
    const attrs: ResourceAttrs = { type: 'assignment', tenantId, units };
    // Đích là đơn vị: không nhìn thấy đơn vị thì 404, thấy mà không gán được thì 403 (như tạo tài liệu, SPEC §10.9)
    const visibility = units.length
      ? { action: 'org_unit.read', attrs: { type: 'org_unit', tenantId, units } as ResourceAttrs }
      : { action: 'user.read', attrs: user.attrs };
    return { attrs, visibility };
  }
}

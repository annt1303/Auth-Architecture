import type { ScopeDto, ScopeType } from '@authz-demo/authz-types';

// SQL dùng chung để lấy tên hiển thị của một scope (đơn vị hoặc tài liệu).
// Cần alias: bảng assignment/grant là `g`, join thêm `so` (org_units) và `sd` (documents).
export const SCOPE_LABEL_JOINS = `
  LEFT JOIN org_units so ON so.id = g.scope_id AND g.scope_type IN ('COMPANY','DEPARTMENT','TEAM')
  LEFT JOIN documents sd ON sd.id = g.scope_id AND g.scope_type = 'RESOURCE'`;
export const SCOPE_LABEL_COLUMN = `coalesce(so.name, sd.title) AS scope_name`;

export function toScopeDto(row: {
  scope_type: string;
  scope_id: string | null;
  scope_resource_type: string | null;
  scope_name: string | null;
}): ScopeDto {
  const type = row.scope_type as ScopeType;
  const label =
    type === 'TENANT' ? 'Toàn tổ chức' : type === 'SELF' ? 'Của chính mình' : (row.scope_name ?? '(không rõ)');
  return { type, id: row.scope_id, resourceType: row.scope_resource_type, label };
}

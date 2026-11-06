import type { MeResponse, RoleOwnerKind } from "@authz-demo/authz-types";
import { Badge } from "@/components/common";
import { ApiError } from "@/lib/api";

export const OWNER_KIND_LABEL: Record<RoleOwnerKind, string> = { SYSTEM: "Hệ thống", TENANT: "Tổ chức", COMPANY: "Công ty" };

export const RESOURCE_TYPE_LABEL: Record<string, string> = {
  document: "Tài liệu",
  org_unit: "Cây tổ chức",
  user: "Người dùng",
  user_affiliation: "Đơn vị trực thuộc",
  role: "Vai trò",
  user_role: "Gán vai trò",
  tenant_membership: "Thành viên tổ chức",
  company_domain: "Tên miền công ty",
  authorization_audit: "Nhật ký phân quyền",
  authz_simulation: "Mô phỏng phân quyền",
};
export const resourceTypeLabel = (type: string) => RESOURCE_TYPE_LABEL[type] ?? type;

export const RiskBadge = ({ risk }: { risk: "LOW" | "HIGH" }) =>
  risk === "HIGH" ? <Badge tone="warning">Rủi ro cao</Badge> : <Badge tone="neutral">Rủi ro thấp</Badge>;

// Gợi ý UX suy từ /me; API mới là bên quyết định.
export function actorRank(me: MeResponse | undefined): number | null {
  const levels = me?.assignments.filter((a) => a.effective).map((a) => a.role.level) ?? [];
  return levels.length ? Math.min(...levels) : null;
}

// Quyền P có ở phạm vi chủ sở hữu role không (xấp xỉ): TENANT cần scope TENANT; COMPANY chấp nhận scope TENANT hoặc COMPANY.
export function actorHasPermissionFor(me: MeResponse | undefined, permission: string, ownerKind: RoleOwnerKind | "SYSTEM"): boolean {
  const entry = me?.effectivePermissions.find((p) => p.permission === permission);
  if (!entry) return false;
  if (ownerKind === "COMPANY") return entry.scopes.some((s) => s.type === "TENANT" || s.type === "COMPANY");
  return entry.scopes.some((s) => s.type === "TENANT");
}

// Thông báo cho người dùng, không lộ mã ràng buộc nội bộ.
export function roleErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "invalid_request":
        return error.details?.map((d) => d.issue).join(". ") || "Dữ liệu chưa hợp lệ. Kiểm tra lại các trường.";
      case "forbidden":
        return "Bạn không thể thực hiện thay đổi này. Vai trò của bạn phải cao hơn level của role, và bạn chỉ thêm được những quyền chính mình đang có.";
      case "conflict":
        return "Khóa role này đã được dùng, hoặc role đã được lưu trữ nên không sửa được nữa.";
      case "not_found":
        return "Không tìm thấy role này. Có thể role đã bị thay đổi hoặc bạn không còn nhìn thấy nó.";
      case "tenant_access_denied":
        return "Tư cách thành viên của bạn đang bị tạm ngưng.";
      case "authorization_unavailable":
      case "network":
        return "Chưa kiểm tra được quyền hoặc mất kết nối. Thử lại sau ít phút.";
    }
  }
  return "Có lỗi ở phía hệ thống. Thử lại sau ít phút.";
}

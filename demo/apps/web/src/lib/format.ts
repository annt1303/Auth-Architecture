import type { MeResponse, OrgUnitType, ScopeDto } from "@authz-demo/authz-types";

const pad = (value: number) => String(value).padStart(2, "0");
const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const DAY_MS = 86_400_000;

export const formatDate = (iso: string) => {
  const date = new Date(iso);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
};

// "Hôm nay, 16:40", "Hôm qua, 16:40", "03/11, 10:05" (năm nay bỏ năm), "15/09/2025".
export function formatUpdated(iso: string, now = new Date()) {
  const date = new Date(iso);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const diffDays = Math.round((dayStart(now) - dayStart(date)) / DAY_MS);
  if (diffDays === 0) return `Hôm nay, ${time}`;
  if (diffDays === 1) return `Hôm qua, ${time}`;
  if (date.getFullYear() === now.getFullYear()) return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}, ${time}`;
  return formatDate(iso);
}

type Assignment = MeResponse["assignments"][number];

export function formatValidity({ validFrom, validUntil }: Pick<Assignment, "validFrom" | "validUntil">) {
  if (!validFrom && !validUntil) return "Không thời hạn";
  if (validFrom && !validUntil) return `Từ ${formatDate(validFrom)}`;
  if (!validFrom && validUntil) return `Đến ${formatDate(validUntil)}`;
  const from = new Date(validFrom!);
  const until = new Date(validUntil!);
  const fromLabel = from.getFullYear() === until.getFullYear() ? `${pad(from.getDate())}/${pad(from.getMonth() + 1)}` : formatDate(validFrom!);
  return `${fromLabel} – ${formatDate(validUntil!)}`;
}

export function ineffectiveReasonText(assignment: Assignment, now = new Date()) {
  switch (assignment.ineffectiveReason) {
    case "EXPIRED": {
      if (!assignment.validUntil) return "Đã hết hạn";
      const diffDays = Math.round((dayStart(now) - dayStart(new Date(assignment.validUntil))) / DAY_MS);
      if (diffDays <= 0) return "Đã hết hạn hôm nay";
      if (diffDays === 1) return "Đã hết hạn hôm qua";
      return `Đã hết hạn ngày ${formatDate(assignment.validUntil)}`;
    }
    case "NOT_YET_VALID":
      return "Chưa tới ngày bắt đầu";
    case "MEMBERSHIP_INACTIVE":
      return "Tư cách thành viên đang tạm ngưng";
    default:
      return "";
  }
}

// Vai trò cao nhất đang có hiệu lực: level nhỏ nhất (1 = cao nhất).
// Vai trò hệ thống có tên tiếng Anh trong dữ liệu; hiện tên tiếng Việt. Vai trò riêng giữ tên đã đặt.
const SYSTEM_ROLE_NAME: Record<string, string> = {
  system_admin: "Quản trị hệ thống",
  tenant_admin: "Quản trị tenant",
  company_admin: "Quản trị công ty",
  department_manager: "Trưởng phòng",
  member: "Thành viên",
};

export const roleName = (role: Assignment["role"]) =>
  role.ownerKind === "SYSTEM" ? (SYSTEM_ROLE_NAME[role.key] ?? role.name) : role.name;

export function highestRoleLabel(me: MeResponse) {
  const effective = me.assignments.filter((a) => a.effective).sort((a, b) => a.role.level - b.role.level);
  if (effective[0]) return roleName(effective[0].role);
  return me.assignments.length > 0 ? "Không có vai trò hiệu lực" : "Chưa có vai trò";
}

export const ORG_TYPE_LABEL: Record<OrgUnitType, string> = { COMPANY: "Công ty", DEPARTMENT: "Phòng ban", TEAM: "Team" };

export const SCOPE_TYPE_LABEL: Record<ScopeDto["type"], string> = {
  TENANT: "Tenant",
  COMPANY: "Công ty",
  DEPARTMENT: "Phòng ban",
  TEAM: "Team",
  RESOURCE: "Tài liệu",
  SELF: "Của mình",
};

const PERMISSION_LABEL: Record<string, string> = {
  "document.read": "Xem tài liệu",
  "document.create": "Tạo tài liệu",
  "document.update": "Sửa tài liệu",
  "document.delete": "Xoá tài liệu",
  "org_unit.read": "Xem cây tổ chức",
  "org_unit.manage": "Quản lý cây tổ chức",
  "user.read": "Xem người dùng",
  "user.create": "Tạo người dùng",
  "user_affiliation.manage": "Quản lý đơn vị trực thuộc",
  "role.read": "Xem vai trò",
  "role.manage": "Quản lý vai trò",
  "user_role.read": "Xem vai trò đã gán",
  "user_role.assign": "Gán vai trò",
  "user_role.revoke": "Thu hồi vai trò",
  "tenant_membership.manage": "Quản lý thành viên tenant",
  "company_domain.manage": "Quản lý tên miền công ty",
  "company_domain.approve": "Duyệt tên miền công ty",
  "authorization_audit.read": "Xem nhật ký phân quyền",
  "authz_simulation.run": "Chạy mô phỏng phân quyền",
};

export const permissionLabel = (key: string) => PERMISSION_LABEL[key] ?? key;

export const scopeKey = (scope: Pick<ScopeDto, "type" | "id">) => `${scope.type}:${scope.id ?? ""}`;

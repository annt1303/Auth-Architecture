import type { DomainStatus, OrgUnitType } from "@authz-demo/authz-types";
import { ApiError } from "@/lib/api";

export type OrgOperation = "create" | "rename" | "archive" | "propose" | "approve" | "reject" | "revoke";

const GENERIC_NETWORK = "Chưa kiểm tra được quyền hoặc mất kết nối. Thử lại sau ít phút.";
const GENERIC = "Có lỗi ở phía hệ thống. Thử lại sau ít phút.";

// Thông báo thân thiện theo thao tác + mã lỗi; không lộ mã nội bộ.
export function orgErrorText(op: OrgOperation, error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC;
  if (error.code === "network" || error.code === "authorization_unavailable") return GENERIC_NETWORK;
  if (error.code === "unauthenticated") return "Phiên đăng nhập đã hết. Tải lại trang để đăng nhập lại.";
  if (error.code === "forbidden") {
    if (op === "create") return "Bạn không có quyền tạo đơn vị ở đây. Tạo công ty gốc chỉ dành cho quản trị tenant.";
    if (op === "propose") return "Bạn không có quyền đề xuất domain cho công ty này.";
    if (op === "approve" || op === "reject") return "Bạn không có quyền duyệt domain. Chỉ quản trị tenant được duyệt.";
    return "Bạn không có quyền thực hiện thao tác này.";
  }
  if (error.code === "not_found") return "Đơn vị hoặc domain này không còn tồn tại hoặc bạn không còn thấy nó. Danh sách sẽ được làm mới.";
  if (error.code === "conflict") {
    switch (op) {
      case "archive":
        return "Không lưu trữ được: đơn vị còn đơn vị con, còn người được gán vai trò ở đây hoặc còn tài liệu. Hãy chuyển hoặc lưu trữ chúng trước.";
      case "propose":
        return "Domain này đã có trong hệ thống (ở công ty này hoặc công ty khác).";
      case "create":
        return "Mã đơn vị này đã được dùng. Hãy chọn mã khác.";
      case "rename":
        return "Tên này xung đột với đơn vị khác. Hãy chọn tên khác.";
      default:
        return "Trạng thái domain đã thay đổi (có người khác vừa xử lý). Danh sách đã được làm mới, hãy kiểm tra lại.";
    }
  }
  if (error.code === "invalid_request") {
    if (op === "propose") {
      const issue = error.details?.map((d) => d.issue).join(" ") ?? "";
      if (/public/i.test(issue)) return "Không dùng được domain email công cộng (ví dụ gmail.com). Hãy nhập domain của công ty.";
      return "Domain chưa hợp lệ. Nhập dạng ten-mien.com, không kèm “@” hay “https://”.";
    }
    return "Dữ liệu chưa hợp lệ. Kiểm tra lại mã và tên đơn vị.";
  }
  return GENERIC;
}

export const DOMAIN_STATUS: Record<DomainStatus, { label: string; tone: "success" | "warning" | "neutral" | "error" }> = {
  PENDING: { label: "Chờ duyệt", tone: "warning" },
  ACTIVE: { label: "Đang dùng", tone: "success" },
  REJECTED: { label: "Từ chối", tone: "error" },
  REVOKED: { label: "Đã thu hồi", tone: "neutral" },
};

// SPEC §6.2: công ty chứa công ty hoặc phòng ban; phòng ban chứa phòng ban hoặc team; team không chứa gì.
export const CHILD_TYPES: Record<OrgUnitType, OrgUnitType[]> = {
  COMPANY: ["COMPANY", "DEPARTMENT"],
  DEPARTMENT: ["DEPARTMENT", "TEAM"],
  TEAM: [],
};

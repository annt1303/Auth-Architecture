import type { ConstraintId, ErrorCode, EvaluationState, ReasonCode, TraceStepId } from "@authz-demo/authz-types";
import { roleName } from "@/lib/format";

// Giải thích tiếng Việt cho màn học luồng (Mô phỏng). Màn người dùng thường không hiện các mã này.

export const STEP_ORDER: TraceStepId[] = ["PA4", "B1", "B2", "B4", "C1", "C2", "D3", "D4", "D5", "D6"];

export const STEP_INFO: Record<TraceStepId, { title: string; what: string; onFail: string }> = {
  PA4: { title: "Action có trong danh mục", what: "Quyền được hỏi phải tồn tại trong danh mục quyền.", onFail: "Không rõ quyền: INDETERMINATE / UNKNOWN_PERMISSION (500)." },
  B1: { title: "Tài khoản đang hoạt động", what: "Tài khoản người dùng phải ở trạng thái ACTIVE.", onFail: "DENY / PRINCIPAL_INACTIVE." },
  B2: { title: "Tổ chức và tư cách thành viên", what: "Tổ chức đang hoạt động và membership của người dùng là ACTIVE.", onFail: "DENY / TENANT_SUSPENDED hoặc NOT_A_MEMBER, trả 403 tenant_access_denied." },
  B4: { title: "Nạp tài nguyên", what: "Tài nguyên được nạp theo đúng tenant để lấy đơn vị chứa và chủ sở hữu.", onFail: "Không tìm thấy tài nguyên: 404." },
  C1: { title: "Lấy grant hiệu lực", what: "Gom các assignment ACTIVE, còn trong thời hạn, của người có membership ACTIVE, có trao quyền này.", onFail: "Lỗi hệ thống: INDETERMINATE / EVALUATION_FAILURE (503)." },
  C2: { title: "Ràng buộc quản trị", what: "Với action quản trị (gán, thu hồi vai trò, tạo user...), tính các ràng buộc ở bảng bên dưới.", onFail: "Bỏ qua nếu action không có ràng buộc." },
  D3: { title: "Có grant nào không", what: "Người dùng phải có ít nhất một grant trao quyền này.", onFail: "NOT_APPLICABLE / NO_GRANT." },
  D4: { title: "Grant có bao phủ tài nguyên", what: "Scope của grant phải bao phủ đơn vị chứa tài nguyên (cây công ty, phòng ban, team, đúng tài liệu hoặc của chính mình).", onFail: "DENY / OUT_OF_SCOPE." },
  D5: { title: "Mọi ràng buộc đều đạt", what: "Tất cả ràng buộc đã tính ở C2 phải đạt.", onFail: "DENY / CONSTRAINT_FAILED, kèm mã ràng buộc trượt." },
  D6: { title: "Cho phép", what: "Mọi bước đều qua.", onFail: "" },
};

export const CONSTRAINT_INFO: Record<ConstraintId, { title: string; what: string }> = {
  RANK: { title: "Chỉ gán, thu hồi người thấp cấp hơn hẳn", what: "Level của vai trò đích phải lớn hơn level cao nhất mà người thực hiện có (số nhỏ là cấp cao). Cùng cấp cũng bị chặn." },
  PERMISSION_SUBSET: { title: "Không trao quyền mình không có", what: "Mọi quyền của vai trò đích, người thực hiện phải có tại scope đó. Quyền chỉ cấp TENANT không trao được từ scope thấp hơn." },
  NOT_SELF: { title: "Không tự thao tác trên mình", what: "Người thực hiện và người bị tác động phải khác nhau (tự nâng, tự thu hồi quyền đều bị chặn)." },
  TARGET_VISIBLE: { title: "Người đích nằm trong tầm nhìn", what: "Người bị tác động phải nằm trong phạm vi user.read của người thực hiện." },
  ROLE_ASSIGNABLE_HERE: { title: "Vai trò gán được tại scope này", what: "Vai trò thuộc tổ chức, còn hoạt động, và nếu là vai trò riêng của công ty thì scope phải nằm trong cây công ty đó." },
  SYSTEM_ADMIN_PROTECTED: { title: "Bảo vệ quản trị hệ thống", what: "Không gán, thu hồi hay tạm ngưng system_admin qua giao diện." },
  EMAIL_DOMAIN: { title: "Email thuộc tên miền đã duyệt", what: "Tên miền email phải là tên miền ACTIVE của công ty đích hoặc của một công ty tổ tiên." },
};

export const STATE_LABEL: Record<EvaluationState, string> = {
  ALLOW: "Cho phép",
  DENY: "Từ chối",
  NOT_APPLICABLE: "Không áp dụng",
  INDETERMINATE: "Không xác định",
};

export const REASON_INFO: Record<ReasonCode, string> = {
  ALLOW_GRANT: "Có grant bao phủ tài nguyên và mọi ràng buộc đều đạt.",
  NO_GRANT: "Người dùng không có grant nào trao quyền này.",
  OUT_OF_SCOPE: "Có grant nhưng không grant nào bao phủ tài nguyên.",
  NOT_A_MEMBER: "Người dùng không còn là thành viên đang hoạt động của tổ chức.",
  TENANT_SUSPENDED: "Tổ chức đang bị tạm ngưng.",
  TENANT_MISMATCH: "Tài nguyên thuộc tổ chức khác.",
  PRINCIPAL_INACTIVE: "Tài khoản đã bị vô hiệu hoá.",
  CONSTRAINT_FAILED: "Có grant bao phủ nhưng một ràng buộc quản trị bị trượt.",
  EVALUATION_FAILURE: "Hệ thống phân quyền gặp lỗi khi đánh giá.",
  MISSING_REQUIRED_ATTRIBUTE: "Thiếu thuộc tính bắt buộc để đánh giá.",
  UNKNOWN_PERMISSION: "Quyền không có trong danh mục.",
};

export const ERROR_INFO: Record<ErrorCode, string> = {
  unauthenticated: "Chưa đăng nhập",
  invalid_request: "Yêu cầu không hợp lệ",
  tenant_access_denied: "Không còn quyền truy cập tổ chức",
  forbidden: "Bị từ chối nhưng người dùng thấy được tài nguyên",
  not_found: "Người dùng không thấy được tài nguyên nên nhận 404, không lộ là có tồn tại",
  conflict: "Xung đột dữ liệu",
  authorization_unavailable: "Hệ thống phân quyền tạm thời không dùng được",
  internal_error: "Lỗi hệ thống",
};

export const RESOURCE_TYPE_LABEL: Record<string, string> = {
  document: "Tài liệu",
  org_unit: "Tổ chức",
  company_domain: "Tên miền công ty",
  user: "Người dùng",
  user_affiliation: "Đơn vị trực thuộc",
  tenant_membership: "Thành viên tenant",
  role: "Vai trò",
  user_role: "Gán vai trò",
  authorization_audit: "Nhật ký phân quyền",
  authz_simulation: "Mô phỏng phân quyền",
};

export const resourceTypeLabel = (type: string) => RESOURCE_TYPE_LABEL[type] ?? type;

export const roleKeyLabel = (key: string) =>
  roleName({ key, name: key, level: 0, ownerKind: key.startsWith("custom.") ? "TENANT" : "SYSTEM" });

// ---------------------------------------------------------------- nhật ký

const TABLE_LABEL: Record<string, string> = {
  principals: "Tài khoản",
  tenant_memberships: "Thành viên tenant",
  org_units: "Đơn vị tổ chức",
  company_domains: "Tên miền công ty",
  user_affiliations: "Đơn vị trực thuộc",
  roles: "Vai trò",
  role_permissions: "Quyền của vai trò",
  tenant_role_assignments: "Gán vai trò",
};

const OP_LABEL: Record<string, string> = {
  created: "được tạo",
  modified: "được sửa",
  status_changed: "đổi trạng thái",
  deleted: "bị xoá",
};

const OTHER_EVENT_LABEL: Record<string, string> = {
  "access.denied": "Truy cập bị từ chối",
  "access.evaluation_failed": "Đánh giá quyền bị lỗi",
  "auth.login_denied": "Đăng nhập bị từ chối",
};

// Đặt tên riêng cho các loại phổ biến cho tự nhiên hơn "Gán vai trò được tạo".
const SPECIFIC_LABEL: Record<string, string> = {
  "tenant_role_assignments.created": "Gán vai trò",
  "tenant_role_assignments.status_changed": "Thu hồi hoặc khôi phục vai trò",
  "tenant_role_assignments.modified": "Sửa thời hạn vai trò",
  "tenant_memberships.status_changed": "Đổi trạng thái thành viên",
  "tenant_memberships.created": "Thêm thành viên tenant",
  "org_units.created": "Tạo đơn vị",
  "org_units.modified": "Sửa đơn vị",
  "org_units.status_changed": "Lưu trữ hoặc khôi phục đơn vị",
  "company_domains.created": "Đề xuất tên miền",
  "company_domains.status_changed": "Đổi trạng thái tên miền",
  "principals.created": "Tạo tài khoản",
  "principals.status_changed": "Đổi trạng thái tài khoản",
  "user_affiliations.created": "Thêm vào đơn vị",
  "user_affiliations.deleted": "Gỡ khỏi đơn vị",
  "user_affiliations.modified": "Đổi phòng ban trực thuộc",
  "roles.created": "Tạo vai trò",
  "roles.modified": "Sửa vai trò",
  "roles.status_changed": "Lưu trữ vai trò",
  "role_permissions.created": "Thêm quyền vào vai trò",
  "role_permissions.deleted": "Bớt quyền khỏi vai trò",
};

export function eventTypeLabel(type: string): string {
  if (OTHER_EVENT_LABEL[type]) return OTHER_EVENT_LABEL[type];
  if (SPECIFIC_LABEL[type]) return SPECIFIC_LABEL[type];
  const [table, op] = type.split(".");
  if (table && op && TABLE_LABEL[table]) return `${TABLE_LABEL[table]} ${OP_LABEL[op] ?? op}`;
  return type;
}

export const EVENT_TYPE_GROUPS: { label: string; types: string[] }[] = [
  ...Object.keys(TABLE_LABEL).map((table) => ({
    label: TABLE_LABEL[table]!,
    types: (table === "role_permissions" ? ["created", "deleted"] : ["created", "modified", "status_changed", "deleted"]).map((op) => `${table}.${op}`),
  })),
  { label: "Lớp B", types: Object.keys(OTHER_EVENT_LABEL) },
];

const TARGET_LABEL: Record<string, string> = {
  ...TABLE_LABEL,
  document: "Tài liệu",
  org_unit: "Đơn vị tổ chức",
  user: "Người dùng",
  role: "Vai trò",
  assignment: "Gán vai trò",
  principal: "Tài khoản",
  company_domain: "Tên miền công ty",
  tenant_membership: "Thành viên tenant",
  user_affiliation: "Đơn vị trực thuộc",
  authorization_audit: "Nhật ký phân quyền",
  authz_simulation: "Mô phỏng phân quyền",
};

export const targetTypeLabel = (type: string) => TARGET_LABEL[type] ?? type;

export const TARGET_FILTER_GROUPS: { label: string; types: string[] }[] = [
  { label: "Dữ liệu thay đổi (lớp A)", types: Object.keys(TABLE_LABEL) },
  { label: "Tài nguyên bị từ chối (lớp B)", types: ["document", "org_unit", "user", "role", "assignment", "company_domain", "principal"] },
];

export const LOGIN_DENIED_REASON: Record<string, string> = {
  NOT_PROVISIONED: "Chưa có tài khoản trong hệ thống",
  DOMAIN_NOT_ALLOWED: "Tên miền email không được phép",
  EMAIL_UNVERIFIED: "Email chưa được xác minh",
  DOMAIN_PENDING: "Tên miền đang chờ duyệt",
};

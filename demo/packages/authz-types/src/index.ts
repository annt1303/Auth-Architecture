// Kiểu dùng chung giữa API và web.
// Lấy từ tài liệu gốc §10.1, §11.1, §13.2, bỏ các trường platform và delegation (SPEC §9).

// ---------------------------------------------------------------- ngữ cảnh

export type AssuranceLevel = "BASIC" | "MFA" | "STEP_UP";

// Do server dựng; không trường nào lấy trực tiếp từ client (tài liệu gốc §10.1).
export type TrustedContext = {
  tenantId: string;
  principalId: string;
  principalType: "USER";
  actorId: string;
  authentication: {
    method: string;
    authenticatedAt: string;
    assuranceLevel: AssuranceLevel;
  };
  environment: {
    requestTime: string;
    sourceIp?: string;
  };
  correlationId: string;
};

export type ScopeType = "TENANT" | "COMPANY" | "DEPARTMENT" | "TEAM" | "RESOURCE" | "SELF";

// Thuộc tính có thẩm quyền của tài nguyên, do Resource Resolver nạp (SPEC §8.2).
// units: đơn vị chứa tài nguyên; rỗng = tài nguyên cấp tenant (chỉ scope TENANT bao phủ).
export type ResourceAttrs = {
  type: string;
  id?: string;
  tenantId: string;
  units: string[];
  ownerId?: string;
  // Mọi grant của quyền này đều bao phủ, bất kể scope (vd. đọc role SYSTEM/TENANT, SPEC §8.2).
  anyScope?: boolean;
};

// ---------------------------------------------------------------- quyết định

export type EvaluationState = "ALLOW" | "DENY" | "NOT_APPLICABLE" | "INDETERMINATE";

export type ReasonCode =
  | "ALLOW_GRANT"
  | "NO_GRANT"
  | "OUT_OF_SCOPE"
  | "NOT_A_MEMBER"
  | "TENANT_SUSPENDED"
  | "TENANT_MISMATCH"
  | "PRINCIPAL_INACTIVE"
  | "CONSTRAINT_FAILED"
  | "EVALUATION_FAILURE"
  | "MISSING_REQUIRED_ATTRIBUTE"
  | "UNKNOWN_PERMISSION";

// Nội bộ PDP; không bao giờ trả cho client (tài liệu gốc §11.2).
export type EvaluationResult = {
  state: EvaluationState;
  reasonCode: ReasonCode;
  matchedGrantIds: string[];
  failedDependency?: string;
};

// ---------------------------------------------------------------- FilterPlan (SPEC §8.3)

export type Predicate =
  | { field: "org_unit_id"; op: "IN"; values: string[] }
  | { field: "id"; op: "IN"; values: string[] }
  | { field: "owner_principal_id"; op: "EQ"; value: string };

export type AuthzPlan =
  | { kind: "TRUE" }
  | { kind: "FALSE" }
  | { kind: "ANY_OF"; predicates: Predicate[] };

// ---------------------------------------------------------------- HTTP (SPEC §11)

export type ErrorCode =
  | "unauthenticated"
  | "invalid_request"
  | "tenant_access_denied"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "authorization_unavailable"
  | "internal_error";

export type ErrorBody = {
  error: ErrorCode;
  message: string;
  correlationId: string;
  details?: { field: string; issue: string }[];
};

// ---------------------------------------------------------------- DTO

export type OrgUnitType = "COMPANY" | "DEPARTMENT" | "TEAM";

export type OrgUnitRef = { id: string; code: string; name: string; type: OrgUnitType };

export type OrgUnitDto = OrgUnitRef & {
  parentId: string | null;
  companyId: string;
  status: "ACTIVE" | "ARCHIVED";
};

export type ScopeDto = {
  type: ScopeType;
  id: string | null;
  resourceType: string | null;
  label: string;
};

export type MeResponse = {
  principal: { id: string; email: string; displayName: string; status: "ACTIVE" | "DISABLED" };
  tenant: { key: string; name: string; status: "ACTIVE" | "SUSPENDED" };
  membership: { status: "ACTIVE" | "SUSPENDED" | "REMOVED" | null };
  affiliations: { company: OrgUnitRef; department: OrgUnitRef | null }[];
  assignments: {
    id: string;
    role: { key: string; name: string; level: number; ownerKind: "SYSTEM" | "TENANT" | "COMPANY" };
    scope: ScopeDto;
    validFrom: string | null;
    validUntil: string | null;
    effective: boolean;
    ineffectiveReason: "EXPIRED" | "NOT_YET_VALID" | "MEMBERSHIP_INACTIVE" | null;
  }[];
  effectivePermissions: { permission: string; scopes: ScopeDto[] }[];
};

export type DocumentAction = "read" | "update" | "delete";

export type DocumentDto = {
  id: string;
  title: string;
  body: string;
  status: "DRAFT" | "PUBLISHED";
  orgUnit: OrgUnitRef;
  owner: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
  _actions: DocumentAction[];
};

// ---------------------------------------------------------------- Giai đoạn 2: quản trị (SPEC §10, §12)

export type RoleOwnerKind = "SYSTEM" | "TENANT" | "COMPANY";
export type RoleRef = { id: string; key: string; name: string; level: number; ownerKind: RoleOwnerKind };

export type PermissionDto = {
  key: string;
  resourceType: string;
  riskLevel: "LOW" | "HIGH";
  isVisibility: boolean;
  tenantScopeOnly: boolean;
  description: string;
};

export type OrgUnitAction = "manage";
export type OrgUnitTreeDto = OrgUnitDto & { _actions: OrgUnitAction[] };

export type DomainStatus = "PENDING" | "ACTIVE" | "REJECTED" | "REVOKED";
export type DomainAction = "approve" | "reject" | "revoke";
export type DomainDto = {
  id: string;
  companyId: string;
  domain: string;
  status: DomainStatus;
  requestedBy: { id: string; displayName: string } | null;
  createdAt: string;
  decidedAt: string | null;
  // Số user có email thuộc domain này (cảnh báo trước khi thu hồi, SPEC §6.5)
  affectedUsers: number;
  _actions: DomainAction[];
};

export type UserAction = "assign" | "affiliate" | "membership" | "read_assignments";
export type UserDto = {
  id: string;
  email: string;
  displayName: string;
  status: "ACTIVE" | "DISABLED";
  membershipStatus: "ACTIVE" | "SUSPENDED" | "REMOVED" | null;
  linked: boolean;
  affiliations: { company: OrgUnitRef; department: OrgUnitRef | null }[];
  highestRole: { key: string; name: string; level: number; ownerKind: RoleOwnerKind } | null;
  createdAt: string;
  _actions: UserAction[];
};

export type RoleDto = RoleRef & {
  description: string | null;
  status: "ACTIVE" | "ARCHIVED";
  ownerCompany: OrgUnitRef | null;
  permissions: string[];
  // Số assignment ACTIVE đang giữ role này (UI hiện "ảnh hưởng N assignment", SPEC §10.3)
  assignmentCount: number;
  _actions: ("update" | "archive")[];
};

export type AssignmentDto = {
  id: string;
  role: RoleRef;
  scope: ScopeDto;
  status: "ACTIVE" | "REVOKED";
  validFrom: string | null;
  validUntil: string | null;
  effective: boolean;
  ineffectiveReason: "EXPIRED" | "NOT_YET_VALID" | "MEMBERSHIP_INACTIVE" | "REVOKED" | null;
  createdAt: string;
  createdBy: { id: string; displayName: string } | null;
  revokedAt: string | null;
  revokeReason: string | null;
  _actions: ("update" | "revoke")[];
};

export type AssignmentOptionsDto = {
  roles: { role: RoleRef; scopes: ScopeDto[] }[];
};

export type EffectivePermissionDto = MeResponse["effectivePermissions"][number];

// ---------------------------------------------------------------- Audit (SPEC §13)

export type AuditEventDto = {
  id: string;
  eventClass: "A" | "B";
  eventType: string;
  occurredAt: string;
  orgUnit: OrgUnitRef | null;
  actor: { id: string; displayName: string } | null;
  actorAttributed: boolean;
  correlationId: string | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  payload: Record<string, unknown>;
};

export type AuditPageDto = { items: AuditEventDto[]; nextCursor: string | null };

// ---------------------------------------------------------------- Simulator (SPEC §9, §12)

export type ConstraintId =
  | "RANK"
  | "PERMISSION_SUBSET"
  | "NOT_SELF"
  | "TARGET_VISIBLE"
  | "ROLE_ASSIGNABLE_HERE"
  | "SYSTEM_ADMIN_PROTECTED"
  | "EMAIL_DOMAIN";

export type TraceStepId = "PA4" | "B1" | "B2" | "B4" | "C1" | "C2" | "D3" | "D4" | "D5" | "D6";

export type ResourceRef = { type: string; id?: string };

export type DecisionTrace = {
  request: { principalId: string; action: string; resource: ResourceRef };
  steps: { id: TraceStepId; outcome: "PASS" | "FAIL" | "SKIP"; detail?: unknown }[];
  grants: {
    assignmentId: string;
    roleKey: string;
    roleLevel: number;
    scopeType: string;
    scopeLabel: string;
    coversResource: boolean;
  }[];
  constraints: { id: ConstraintId; outcome: "PASS" | "FAIL"; detail?: unknown }[];
  result: { state: EvaluationState; reasonCode: ReasonCode; httpStatus: number; errorCode: ErrorCode | null };
};

export type SimulateRequest = {
  principalId: string;
  action: string;
  resource: ResourceRef;
  // Tham số cho hành động quản trị có ràng buộc (SPEC §10)
  params?: {
    targetUserId?: string;
    roleId?: string;
    scope?: { type: ScopeType; id?: string };
    companyId?: string;
    email?: string;
  };
};

export type EffectiveMatrixDto = {
  principal: { id: string; displayName: string; email: string };
  rows: {
    permission: string;
    riskLevel: "LOW" | "HIGH";
    tenantScopeOnly: boolean;
    grants: { scope: ScopeDto; roleKey: string; roleName: string; assignmentId: string }[];
  }[];
};

export type WhoCanDto = {
  action: string;
  resource: ResourceRef & { label: string };
  principals: { id: string; displayName: string; email: string; via: { roleKey: string; scopeLabel: string }[] }[];
};

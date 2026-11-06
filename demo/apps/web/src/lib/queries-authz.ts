import type {
  AssignmentDto,
  AuditPageDto,
  DecisionTrace,
  DocumentDto,
  EffectiveMatrixDto,
  OrgUnitTreeDto,
  PermissionDto,
  RoleDto,
  SimulateRequest,
  UserDto,
  WhoCanDto,
} from "@authz-demo/authz-types";
import { infiniteQueryOptions, queryOptions, useMutation } from "@tanstack/react-query";
import { api } from "./api";

// Màn "Mô phỏng" và "Nhật ký". Khoá riêng (tiền tố "authz") để không đụng cache của màn khác.
const SHORT = 60_000;

export const simUsersQuery = queryOptions({
  queryKey: ["authz", "users"],
  queryFn: () => api<UserDto[]>("/users?limit=100"),
  staleTime: SHORT,
});

export const simPermissionsQuery = queryOptions({
  queryKey: ["authz", "permissions"],
  queryFn: () => api<PermissionDto[]>("/permissions"),
  staleTime: 5 * SHORT,
});

export const simDocumentsQuery = queryOptions({
  queryKey: ["authz", "documents"],
  queryFn: () => api<DocumentDto[]>("/documents?limit=100"),
  staleTime: SHORT,
});

export const simUnitsQuery = queryOptions({
  queryKey: ["authz", "org-units"],
  queryFn: () => api<OrgUnitTreeDto[]>("/org-units"),
  staleTime: SHORT,
});

export const simRolesQuery = queryOptions({
  queryKey: ["authz", "roles"],
  queryFn: () => api<RoleDto[]>("/roles"),
  staleTime: SHORT,
});

export const userAssignmentsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["authz", "assignments", userId],
    queryFn: () => api<AssignmentDto[]>(`/users/${encodeURIComponent(userId)}/assignments`),
    enabled: !!userId,
  });

export const effectiveQuery = (principalId: string) =>
  queryOptions({
    queryKey: ["authz", "effective", principalId],
    queryFn: () => api<EffectiveMatrixDto>(`/authz/effective?principalId=${encodeURIComponent(principalId)}`),
    enabled: !!principalId,
  });

export type WhoCanParams = { action: string; resourceType: string; resourceId?: string };

export const whoCanQuery = (params: WhoCanParams | null) =>
  queryOptions({
    queryKey: ["authz", "who-can", params],
    queryFn: () => {
      const search = new URLSearchParams({ action: params!.action, resourceType: params!.resourceType });
      if (params!.resourceId) search.set("resourceId", params!.resourceId);
      return api<WhoCanDto>(`/authz/who-can?${search}`);
    },
    enabled: !!params,
  });

// Mô phỏng không đổi dữ liệu nên dùng mutation chỉ để có trạng thái chờ/lỗi.
export function useSimulate() {
  return useMutation({
    mutationFn: (input: SimulateRequest) => api<DecisionTrace>("/authz/simulate", { method: "POST", body: JSON.stringify(input) }),
  });
}

export type AuditFilters = {
  eventClass?: "A" | "B";
  eventType?: string;
  actorId?: string;
  targetType?: string;
  from?: string;
  to?: string;
};

export const auditQuery = (filters: AuditFilters) =>
  infiniteQueryOptions({
    queryKey: ["authz", "audit", filters],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ limit: "30" });
      for (const [key, value] of Object.entries(filters)) if (value) search.set(key, value);
      if (pageParam) search.set("cursor", pageParam);
      return api<AuditPageDto>(`/audit-events?${search}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

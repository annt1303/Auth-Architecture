import type { AssignmentDto, AssignmentOptionsDto, EffectivePermissionDto, ScopeType, UserDto } from "@authz-demo/authz-types";
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

// Khoá: ["users", ...] gom danh sách, chi tiết, assignment và quyền hiệu lực để invalidate một lần.
const USERS_KEY = ["users"] as const;
const OPTIONS_KEY = ["assignment-options"] as const;

export const usersQuery = (q: string) =>
  queryOptions({
    queryKey: [...USERS_KEY, "list", q],
    queryFn: () => api<UserDto[]>(`/users?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    placeholderData: keepPreviousData,
  });

export const userQuery = (id: string) =>
  queryOptions({ queryKey: [...USERS_KEY, "detail", id], queryFn: () => api<UserDto>(`/users/${encodeURIComponent(id)}`) });

export const userAssignmentsQuery = (id: string, enabled = true) =>
  queryOptions({
    queryKey: [...USERS_KEY, "assignments", id],
    queryFn: () => api<AssignmentDto[]>(`/users/${encodeURIComponent(id)}/assignments`),
    enabled,
  });

export const userPermissionsQuery = (id: string, enabled = true) =>
  queryOptions({
    queryKey: [...USERS_KEY, "permissions", id],
    queryFn: () => api<EffectivePermissionDto[]>(`/users/${encodeURIComponent(id)}/permissions`),
    enabled,
  });

// Lựa chọn hợp lệ do PDP tính; không cache lâu để luôn phản ánh quyền hiện tại.
export const assignmentOptionsQuery = (userId: string, enabled: boolean) =>
  queryOptions({
    queryKey: [...OPTIONS_KEY, userId],
    queryFn: () => api<AssignmentOptionsDto>(`/assignments/options?userId=${encodeURIComponent(userId)}`),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: USERS_KEY }),
      queryClient.invalidateQueries({ queryKey: OPTIONS_KEY }),
      queryClient.invalidateQueries({ queryKey: ["me"] }),
    ]);
}

export type CreateUserInput = { email: string; displayName: string; companyId: string; departmentId?: string | null };

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api<UserDto>("/users", { method: "POST", ...json(input) }),
    onSuccess: invalidate,
  });
}

export function useAddAffiliation(userId: string) {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (input: { companyId: string; departmentId?: string | null }) =>
      api<UserDto>(`/users/${encodeURIComponent(userId)}/affiliations`, { method: "POST", ...json(input) }),
    onSuccess: invalidate,
  });
}

export function useMoveAffiliation(userId: string) {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ companyId, departmentId }: { companyId: string; departmentId: string | null }) =>
      api<UserDto>(`/users/${encodeURIComponent(userId)}/affiliations/${encodeURIComponent(companyId)}`, {
        method: "PATCH",
        ...json({ departmentId }),
      }),
    onSuccess: invalidate,
  });
}

export function useRemoveAffiliation(userId: string) {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (companyId: string) =>
      api<void>(`/users/${encodeURIComponent(userId)}/affiliations/${encodeURIComponent(companyId)}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export type MembershipOp = "suspend" | "restore" | "remove" | "readd";

export function useMembershipOp(userId: string) {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (op: MembershipOp) => api<UserDto>(`/users/${encodeURIComponent(userId)}/membership/${op}`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export type CreateAssignmentInput = {
  userId: string;
  roleId: string;
  scope: { type: ScopeType; id?: string | null };
  validFrom?: string | null;
  validUntil?: string | null;
};

export function useCreateAssignment() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (input: CreateAssignmentInput) => api<AssignmentDto>("/assignments", { method: "POST", ...json(input) }),
    onSuccess: invalidate,
  });
}

export function useUpdateAssignment() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; validFrom?: string | null; validUntil?: string | null }) =>
      api<AssignmentDto>(`/assignments/${encodeURIComponent(id)}`, { method: "PATCH", ...json(body) }),
    onSuccess: invalidate,
  });
}

export function useRevokeAssignment() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api<AssignmentDto>(`/assignments/${encodeURIComponent(id)}/revoke`, { method: "POST", ...json(reason ? { reason } : {}) }),
    onSuccess: invalidate,
  });
}

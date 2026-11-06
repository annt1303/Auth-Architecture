import type { PermissionDto, RoleDto, RoleOwnerKind } from "@authz-demo/authz-types";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export type RoleFilters = { ownerKind?: RoleOwnerKind; level?: number; status?: "ACTIVE" | "ARCHIVED" };

export const permissionsQuery = queryOptions({ queryKey: ["permissions"], queryFn: () => api<PermissionDto[]>("/permissions"), staleTime: 5 * 60_000 });

export const rolesQuery = (filters: RoleFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.ownerKind) params.set("ownerKind", filters.ownerKind);
  if (filters.level) params.set("level", String(filters.level));
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  return queryOptions({ queryKey: ["roles", "list", filters], queryFn: () => api<RoleDto[]>(`/roles${qs ? `?${qs}` : ""}`) });
};

export type CreateRoleInput = {
  ownerKind: "TENANT" | "COMPANY";
  ownerCompanyId?: string;
  key: string;
  name: string;
  description?: string;
  level: number;
  permissions: string[];
};

export type UpdateRoleInput = { name?: string; description?: string | null; level?: number };

// Role đổi thì assignment, quyền hiệu lực và danh sách user (vai trò cao nhất) cũng đổi theo.
function useInvalidate() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["roles"] }),
      queryClient.invalidateQueries({ queryKey: ["me"] }),
    ]);
}

export function useCreateRole() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateRoleInput) => api<RoleDto>("/roles", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

// Sửa thông tin (PATCH) rồi sửa quyền (PUT), tuần tự; chỉ gọi phần có thay đổi.
export function useUpdateRole(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { info?: UpdateRoleInput; permissions?: string[] }) => {
      let role: RoleDto | undefined;
      if (input.info) role = await api<RoleDto>(`/roles/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input.info) });
      if (input.permissions) {
        role = await api<RoleDto>(`/roles/${encodeURIComponent(id)}/permissions`, {
          method: "PUT",
          body: JSON.stringify({ permissions: input.permissions }),
        });
      }
      return role;
    },
    onSettled: invalidate,
  });
}

export function useArchiveRole() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<RoleDto>(`/roles/${encodeURIComponent(id)}/archive`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

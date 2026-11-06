import type { DomainDto, OrgUnitTreeDto, OrgUnitType } from "@authz-demo/authz-types";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

// Màn "Tổ chức": danh sách phẳng (kèm _actions), client tự dựng cây từ parentId.
export const orgTreeQuery = queryOptions({ queryKey: ["org-units", "tree"], queryFn: () => api<OrgUnitTreeDto[]>("/org-units") });

export const companyDomainsQuery = (companyId: string) =>
  queryOptions({
    queryKey: ["org-units", "domains", companyId],
    queryFn: () => api<DomainDto[]>(`/companies/${encodeURIComponent(companyId)}/domains`),
  });

export type NewOrgUnitInput = { parentId: string | null; unitType: OrgUnitType; code: string; name: string };

// Đổi cây tổ chức ảnh hưởng cả danh sách đích tạo tài liệu và cây dùng ở màn khác.
function useInvalidateOrg() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["org-units"] }),
      queryClient.invalidateQueries({ queryKey: ["documents", "destinations"] }),
    ]);
}

export function useCreateOrgUnit() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: NewOrgUnitInput) => api<OrgUnitTreeDto>("/org-units", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useRenameOrgUnit(id: string) {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (name: string) => api<OrgUnitTreeDto>(`/org-units/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: invalidate,
  });
}

export function useArchiveOrgUnit(id: string) {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: () => api<OrgUnitTreeDto>(`/org-units/${encodeURIComponent(id)}/archive`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useProposeDomain(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) =>
      api<DomainDto>(`/companies/${encodeURIComponent(companyId)}/domains`, { method: "POST", body: JSON.stringify({ domain }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: companyDomainsQuery(companyId).queryKey }),
  });
}

export type DomainTransition = "approve" | "reject" | "revoke";

export function useDomainTransition(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: DomainTransition }) =>
      api<DomainDto>(`/domains/${encodeURIComponent(id)}/${action}`, { method: "POST" }),
    // Lỗi 409/404 cũng làm danh sách cũ đi: tải lại để nút hành động khớp trạng thái thật.
    onSettled: () => queryClient.invalidateQueries({ queryKey: companyDomainsQuery(companyId).queryKey }),
  });
}

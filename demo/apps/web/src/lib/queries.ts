import type { DocumentDto, MeResponse, OrgUnitDto } from "@authz-demo/authz-types";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export const meQuery = queryOptions({ queryKey: ["me"], queryFn: () => api<MeResponse>("/me") });

// Lấy cả danh sách một lần rồi lọc trạng thái ở máy, để số đếm trên tab đúng cho mọi trạng thái.
export const documentsQuery = queryOptions({
  queryKey: ["documents", "list"],
  queryFn: () => api<DocumentDto[]>("/documents?limit=100"),
});

export const documentQuery = (id: string) =>
  queryOptions({ queryKey: ["documents", "detail", id], queryFn: () => api<DocumentDto>(`/documents/${encodeURIComponent(id)}`) });

// 403 = không được tạo ở đâu cả: ẩn nút "Tạo tài liệu".
export const destinationsQuery = queryOptions({
  queryKey: ["documents", "destinations"],
  queryFn: () => api<OrgUnitDto[]>("/documents/destinations"),
});

export const orgUnitsQuery = queryOptions({ queryKey: ["org-units"], queryFn: () => api<OrgUnitDto[]>("/org-units") });

export type DocumentInput = { title: string; body: string; status: DocumentDto["status"]; orgUnitId: string };

export function useCreateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DocumentInput) => api<DocumentDto>("/documents", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (document) => {
      queryClient.setQueryData(documentQuery(document.id).queryKey, document);
      return queryClient.invalidateQueries({ queryKey: documentsQuery.queryKey });
    },
  });
}

export function useUpdateDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<DocumentInput, "orgUnitId">) =>
      api<DocumentDto>(`/documents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (document) => {
      queryClient.setQueryData(documentQuery(id).queryKey, document);
      return queryClient.invalidateQueries({ queryKey: documentsQuery.queryKey });
    },
  });
}

export function useDeleteDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: documentQuery(id).queryKey });
      return queryClient.invalidateQueries({ queryKey: documentsQuery.queryKey });
    },
  });
}

// Đăng xuất và đổi danh tính cùng một lệnh POST; sau đó chuyển trang hẳn để xoá mọi dữ liệu đã nạp.
export async function logout(): Promise<void> {
  try {
    await api<void>("/auth/logout", { method: "POST" });
  } catch {
    // Phiên đã hết thì vẫn coi như đã đăng xuất.
  }
}

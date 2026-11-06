import { useQuery } from "@tanstack/react-query";
import type { MeResponse } from "@authz-demo/authz-types";
import { meQuery } from "./queries";

// Chỉ phục vụ UX (ẩn/hiện menu, nút): API vẫn kiểm tra lại ở mọi request (tài liệu gốc §3.3).
export const hasPermission = (me: MeResponse | undefined, permission: string) =>
  !!me?.effectivePermissions.some((p) => p.permission === permission);

export function useCan(permission: string): boolean {
  return hasPermission(useQuery(meQuery).data, permission);
}

import { useState } from "react";
import { logout } from "./queries";

// "Đổi danh tính" = đăng xuất rồi vào lại luồng SSO; "Đăng xuất" = đăng xuất rồi về /login.
// Chuyển trang hẳn (không điều hướng trong app) để không còn dữ liệu của danh tính cũ trong bộ nhớ.
export function useAccountActions() {
  const [pending, setPending] = useState<"switch" | "logout" | null>(null);
  return {
    pending: pending !== null,
    pendingAction: pending,
    switchIdentity: async () => {
      setPending("switch");
      await logout();
      window.location.href = "/api/auth/login";
    },
    signOut: async () => {
      setPending("logout");
      await logout();
      window.location.href = "/login";
    },
  };
}

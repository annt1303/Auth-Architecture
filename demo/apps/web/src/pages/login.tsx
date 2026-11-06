import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { LogIn } from "lucide-react";
import { ProductBrand } from "@/components/common";
import { buttonClasses } from "@/components/ui/button";
import { meQuery } from "@/lib/queries";

// Mọi thất bại đăng nhập dùng chung một câu: lý do thật chỉ nằm trong audit (SPEC §5.3).
const ERROR_TEXT = {
  login_failed: { title: "Đăng nhập chưa thành công", why: "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Hãy thử lại." },
  login_denied: {
    title: "Tài khoản này chưa được phép vào hệ thống",
    why: "Hãy liên hệ quản trị viên của công ty bạn, hoặc đăng nhập bằng một danh tính khác.",
  },
} as const;

export function LoginPage() {
  const { error } = useSearch({ from: "/login" });
  const navigate = useNavigate();
  const me = useQuery({ ...meQuery, retry: false });

  // Đã có phiên thì không cần đăng nhập lại.
  useEffect(() => {
    if (me.data && !error) void navigate({ to: "/toi", replace: true });
  }, [me.data, error, navigate]);

  const text = error ? ERROR_TEXT[error] : null;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 font-sans text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <ProductBrand />
        <h1 className="mt-8 text-xl font-semibold text-balance">Đăng nhập</h1>
        <p className="mt-2 text-sm/6 text-pretty text-muted">Dùng tài khoản công ty qua đăng nhập một lần (SSO).</p>
        {text ? (
          <div role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm">
            <p className="font-medium text-red-700">{text.title}</p>
            <p className="mt-1 text-red-700/80">{text.why}</p>
          </div>
        ) : null}
        <a href="/api/auth/login" className={buttonClasses("primary", "mt-6 min-h-11 w-full md:min-h-10")}>
          <LogIn aria-hidden />
          Đăng nhập bằng SSO
        </a>
      </div>
    </main>
  );
}

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Repeat2, RotateCw } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmailText, Mono } from "@/components/common";
import { useAccountActions } from "@/lib/account";
import { ApiError } from "@/lib/api";
import { meQuery } from "@/lib/queries";

// Lỗi A: khối căn giữa trong khung app (layouts/app.md, Trang lỗi). Sidebar, header giữ nguyên.
type ErrorScreenProps = {
  code?: string;
  title: string;
  description: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  showAccount?: boolean;
  footCode: string;
};

export function ErrorScreen({ code, title, description, primary, secondary, showAccount = true, footCode }: ErrorScreenProps) {
  const me = useQuery(meQuery);
  const { switchIdentity, pending } = useAccountActions();
  return (
    <div className="mx-auto max-w-md pt-16 pb-16 text-center sm:pt-24">
      {code ? <p className="text-sm font-medium text-muted tabular-nums">{code}</p> : null}
      <h2 tabIndex={-1} className={`${code ? "mt-1 " : ""}text-xl font-semibold text-balance text-foreground outline-hidden`}>
        {title}
      </h2>
      <p className="mt-2 text-sm/6 text-pretty text-muted">{description}</p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        {primary}
        {secondary}
      </div>
      {showAccount && me.data ? (
        <div>
          <p className="mt-8 text-sm text-pretty text-muted">
            Bạn đang đăng nhập bằng <EmailText email={me.data.principal.email} suffix="." />
          </p>
          <button
            type="button"
            onClick={switchIdentity}
            disabled={pending}
            className="mx-auto mt-1 flex h-8 w-fit cursor-pointer items-center gap-2 px-1.5 text-sm font-medium text-foreground underline-offset-4 outline-hidden hover:underline focus-visible:underline"
          >
            {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            Đổi danh tính
          </button>
        </div>
      ) : null}
      <p className="mt-6">
        <Mono>{footCode}</Mono>
      </p>
    </div>
  );
}

const primaryFormClasses = "min-h-11 md:min-h-10";

function RetryButton({ onRetry, busy }: { onRetry: () => void; busy?: boolean }) {
  return (
    <Button variant="primary" onClick={onRetry} aria-busy={busy || undefined} className={primaryFormClasses}>
      <RotateCw aria-hidden />
      Thử lại
    </Button>
  );
}

export function TenantBlockedScreen({ tenantName }: { tenantName: string }) {
  const { switchIdentity, pending } = useAccountActions();
  return (
    <ErrorScreen
      title="Tư cách thành viên đang tạm ngưng"
      description={`Bạn chưa dùng được tài liệu trong ${tenantName}. Trang Tôi vẫn mở để bạn xem lý do.`}
      primary={
        <Link to="/toi" className={buttonClasses("primary", primaryFormClasses)}>
          Mở trang Tôi
        </Link>
      }
      secondary={
        <Button onClick={switchIdentity} aria-busy={pending || undefined} className={primaryFormClasses}>
          <Repeat2 aria-hidden />
          Đổi danh tính
        </Button>
      }
      showAccount={false}
      footCode="403 · tenant_access_denied"
    />
  );
}

export function DocumentNotFoundScreen() {
  return (
    <ErrorScreen
      code="404"
      title="Không tìm thấy tài liệu"
      description="Tài liệu không tồn tại, hoặc bạn không có quyền xem."
      primary={
        <Link to="/tai-lieu" search={{}} className={buttonClasses("primary", primaryFormClasses)}>
          Về danh sách tài liệu
        </Link>
      }
      footCode="404 · not_found"
    />
  );
}

export function UnavailableScreen({ error, onRetry, busy }: { error: ApiError; onRetry: () => void; busy?: boolean }) {
  if (error.code === "authorization_unavailable" || error.code === "network") {
    return (
      <ErrorScreen
        title="Tạm thời chưa kiểm tra được quyền"
        description="Dịch vụ phân quyền không phản hồi nên chưa mở được trang này. Dữ liệu của bạn không bị ảnh hưởng."
        primary={<RetryButton onRetry={onRetry} busy={busy} />}
        showAccount={false}
        footCode={error.code === "network" ? "Không kết nối được máy chủ" : "503 · authorization_unavailable"}
      />
    );
  }
  return (
    <ErrorScreen
      title="Đã có lỗi ở phía hệ thống"
      description="Lỗi nằm ở phía hệ thống, không phải do bạn. Thử lại sau ít phút."
      primary={<RetryButton onRetry={onRetry} busy={busy} />}
      showAccount={false}
      footCode={`${error.status || 500} · ${error.correlationId ?? error.code}`}
    />
  );
}

import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Link2 } from "lucide-react";
import { Avatar, Badge, Card, EmailText, LoadError, Skel, Tag } from "@/components/common";
import { TenantBlockedScreen, UnavailableScreen } from "@/components/error-screen";
import { AffiliationTab } from "@/components/users/affiliation-tab";
import { AssignmentTab } from "@/components/users/assignment-tab";
import { MembershipTab } from "@/components/users/membership-tab";
import { PermissionsTab } from "@/components/users/permissions-tab";
import { MembershipBadge } from "@/components/users/shared";
import { UserNotFoundScreen } from "@/components/users/user-not-found";
import { isApiError } from "@/lib/api";
import { roleName } from "@/lib/format";
import { meQuery } from "@/lib/queries";
import { userQuery } from "@/lib/queries-users";
import { cn } from "@/lib/utils";

type Tab = "affiliation" | "assignment" | "membership" | "permissions";

const TABS: { value: Tab; label: string }[] = [
  { value: "affiliation", label: "Đơn vị" },
  { value: "assignment", label: "Role" },
  { value: "membership", label: "Thành viên" },
  { value: "permissions", label: "Quyền hiệu lực" },
];

export function UserDetailPage() {
  const { id } = useParams({ from: "/shell/nguoi-dung/$id" });
  const { tab = "affiliation" } = useSearch({ from: "/shell/nguoi-dung/$id" });
  const navigate = useNavigate();
  const me = useQuery(meQuery);
  const query = useQuery({ ...userQuery(id), retry: false });

  const error = query.error;
  if (isApiError(error, "not_found") || isApiError(error, "forbidden")) return <UserNotFoundScreen />;
  if (isApiError(error, "tenant_access_denied")) return <TenantBlockedScreen tenantName={me.data?.tenant.name ?? "tổ chức này"} />;
  if (isApiError(error)) return <UnavailableScreen error={error} onRetry={() => query.refetch()} busy={query.isFetching} />;
  if (query.isError) return <LoadError title="Không tải được người dùng" why="Kiểm tra kết nối rồi thử lại." onRetry={() => query.refetch()} />;

  const user = query.data;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        to="/nguoi-dung"
        search={{}}
        className="inline-flex h-8 w-fit items-center gap-1.5 text-sm text-muted outline-hidden hover:text-foreground focus-visible:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Danh sách người dùng
      </Link>

      <Card className="p-4 sm:p-6">
        {!user ? (
          <div aria-busy aria-label="Đang tải" className="flex flex-col gap-3">
            <Skel className="h-4 w-1/2" />
            <Skel className="w-1/3" />
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <Avatar seed={user.id} name={user.displayName} className="size-12 text-lg" />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-balance [overflow-wrap:anywhere]">{user.displayName}</h2>
              <p className="mt-0.5 text-sm text-muted">
                <EmailText email={user.email} />
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MembershipBadge status={user.membershipStatus} />
                {user.status === "DISABLED" ? <Badge tone="error">Tài khoản bị vô hiệu hoá</Badge> : null}
                {user.highestRole ? <Tag>{roleName(user.highestRole)}</Tag> : <Tag>Chưa có role</Tag>}
                {user.linked ? (
                  <Tag>
                    <Link2 className="mr-1 size-3" aria-hidden />
                    Đã liên kết SSO
                  </Tag>
                ) : (
                  <Tag>Chưa liên kết SSO</Tag>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      <div role="tablist" aria-label="Thông tin người dùng" className="inline-flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-tab-rail p-1">
        {TABS.map((item) => {
          const active = item.value === tab;
          return (
            <button
              key={item.value}
              role="tab"
              id={`user-tab-${item.value}`}
              type="button"
              aria-selected={active}
              aria-controls="user-tabpanel"
              tabIndex={active ? 0 : -1}
              onClick={() =>
                void navigate({ to: "/nguoi-dung/$id", params: { id }, search: item.value === "affiliation" ? {} : { tab: item.value }, replace: true })
              }
              onKeyDown={(event) => {
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const next = TABS[(TABS.findIndex((t) => t.value === tab) + step + TABS.length) % TABS.length]!;
                void navigate({ to: "/nguoi-dung/$id", params: { id }, search: next.value === "affiliation" ? {} : { tab: next.value }, replace: true });
                requestAnimationFrame(() => document.getElementById(`user-tab-${next.value}`)?.focus());
              }}
              className={cn(
                "h-8 shrink-0 cursor-pointer rounded-lg px-3 text-sm font-medium whitespace-nowrap outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-focus",
                active ? "bg-surface text-foreground shadow-segment-thumb" : "text-foreground/70 hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="user-tabpanel" aria-labelledby={`user-tab-${tab}`} tabIndex={0} className="outline-hidden">
        {!user ? (
          <Card className="p-5">
            <Skel className="w-1/2" />
          </Card>
        ) : tab === "affiliation" ? (
          <AffiliationTab user={user} />
        ) : tab === "assignment" ? (
          <AssignmentTab user={user} />
        ) : tab === "membership" ? (
          <MembershipTab user={user} />
        ) : (
          <PermissionsTab user={user} />
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { UserDto } from "@authz-demo/authz-types";
import { Link2, Plus, Search, Users } from "lucide-react";
import { Avatar, Card, LoadError, Skel, Tag } from "@/components/common";
import { TenantBlockedScreen, UnavailableScreen } from "@/components/error-screen";
import { CreateUserSheet } from "@/components/users/create-user-sheet";
import { MembershipBadge } from "@/components/users/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import { roleName } from "@/lib/format";
import { useCan } from "@/lib/permissions";
import { meQuery } from "@/lib/queries";
import { usersQuery } from "@/lib/queries-users";

const COLUMNS = "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.4fr)_minmax(0,1fr)_8.5rem_7.5rem]";

function Affiliations({ user }: { user: UserDto }) {
  if (user.affiliations.length === 0) return <span className="text-muted">Chưa thuộc công ty nào</span>;
  const shown = user.affiliations.slice(0, 2);
  const rest = user.affiliations.length - shown.length;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {shown.map(({ company, department }) => (
        <span key={company.id} className="min-w-0 truncate" title={department ? `${company.name} › ${department.name}` : company.name}>
          {company.name}
          {department ? <span className="text-muted"> › {department.name}</span> : null}
        </span>
      ))}
      {rest > 0 ? <span className="text-xs text-muted">và {rest} đơn vị khác</span> : null}
    </span>
  );
}

function Row({ user }: { user: UserDto }) {
  return (
    <li>
      <Link
        to="/nguoi-dung/$id"
        params={{ id: user.id }}
        search={{}}
        className={`grid items-center gap-x-4 gap-y-2 px-4 py-3 outline-hidden transition-colors hover:bg-item-hover focus-visible:bg-item-hover sm:px-5 ${COLUMNS}`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Avatar seed={user.id} name={user.displayName} className="size-9 text-sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium" title={user.displayName}>
              {user.displayName}
            </span>
            <span className="block truncate text-xs text-muted" title={user.email}>
              {user.email}
            </span>
          </span>
        </span>
        <span className="min-w-0 text-sm">
          <Affiliations user={user} />
        </span>
        <span className="min-w-0 text-sm">
          {user.highestRole ? <span className="block truncate">{roleName(user.highestRole)}</span> : <span className="text-muted">Chưa có role</span>}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <MembershipBadge status={user.membershipStatus} />
        </span>
        <span>
          {user.linked ? (
            <Tag>
              <Link2 className="mr-1 size-3" aria-hidden />
              Đã liên kết SSO
            </Tag>
          ) : (
            <span className="text-xs text-muted">Chưa liên kết SSO</span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function UsersPage() {
  const { q = "" } = useSearch({ from: "/shell/nguoi-dung" });
  const navigate = useNavigate({ from: "/nguoi-dung" });
  const me = useQuery(meQuery);
  const canCreate = useCan("user.create");
  const [text, setText] = useState(q);
  const [creating, setCreating] = useState(false);
  const users = useQuery(usersQuery(q));

  // Đồng bộ ô tìm kiếm vào search param q sau 300ms ngừng gõ.
  useEffect(() => {
    const normalized = text.trim();
    if (normalized === q) return;
    const timer = setTimeout(() => void navigate({ search: normalized ? { q: normalized } : {}, replace: true }), 300);
    return () => clearTimeout(timer);
  }, [text, q, navigate]);

  if (isApiError(users.error, "tenant_access_denied")) {
    return <TenantBlockedScreen tenantName={me.data?.tenant.name ?? "tổ chức này"} />;
  }
  if (users.isError && isApiError(users.error) && users.error.code !== "forbidden") {
    return <UnavailableScreen error={users.error} onRetry={() => users.refetch()} busy={users.isFetching} />;
  }

  const items = users.data ?? [];
  const noAccess = isApiError(users.error, "forbidden");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            role="searchbox"
            aria-label="Tìm người dùng theo tên hoặc email"
            placeholder="Tìm theo tên hoặc email"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="pl-10"
          />
        </div>
        {canCreate ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            Tạo người dùng
          </Button>
        ) : null}
      </div>

      <Card>
        <div
          aria-hidden
          className={`hidden gap-x-4 border-b border-border-strong px-5 py-2.5 text-xs font-medium text-muted md:grid ${COLUMNS}`}
        >
          <span>Người dùng</span>
          <span>Công ty / phòng ban</span>
          <span>Role cao nhất</span>
          <span>Tư cách thành viên</span>
          <span>SSO</span>
        </div>
        {users.isPending ? (
          <ul aria-busy aria-label="Đang tải" className="divide-y divide-border-strong">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex flex-col gap-2 px-5 py-4">
                <Skel className="w-1/2" />
                <Skel className="w-1/3" />
              </li>
            ))}
          </ul>
        ) : users.isError && !noAccess ? (
          <LoadError title="Không tải được danh sách người dùng" why="Kiểm tra kết nối rồi thử lại." onRetry={() => users.refetch()} />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <Users className="size-8 text-muted" aria-hidden />
            <p className="text-sm font-medium">
              {noAccess ? "Bạn chưa có quyền xem người dùng" : q ? `Không có người dùng khớp “${q}”` : "Chưa có người dùng nào trong phạm vi của bạn"}
            </p>
            <p className="max-w-sm text-sm text-muted">
              {q ? "Thử từ khoá khác, hoặc xoá ô tìm kiếm." : "Chỉ hiện người dùng thuộc công ty, phòng ban mà bạn được phép xem."}
            </p>
          </div>
        ) : (
          <ul aria-label="Danh sách người dùng" className="divide-y divide-border-strong">
            {items.map((user) => (
              <Row key={user.id} user={user} />
            ))}
          </ul>
        )}
      </Card>
      <p aria-live="polite" className="text-xs text-muted">
        {users.data ? `${items.length} người dùng${users.isFetching ? " · đang cập nhật…" : ""}` : ""}
      </p>

      {canCreate ? <CreateUserSheet open={creating} onOpenChange={setCreating} /> : null}
    </div>
  );
}

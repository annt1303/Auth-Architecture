import { useEffect, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { MeResponse } from "@authz-demo/authz-types";
import {
  Building2, CircleUserRound, Ellipsis, FileText, KeyRound, LogOut, Menu, Repeat2, ScrollText, ShieldCheck, Users, Workflow,
  type LucideIcon,
} from "lucide-react";
import { AccountEmail, Avatar, Badge, ProductBrand, Skel } from "@/components/common";
import { UnavailableScreen } from "@/components/error-screen";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAccountActions } from "@/lib/account";
import { ApiError } from "@/lib/api";
import { highestRoleLabel } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

// Khung C: sidebar có chữ (w-60), header mang danh tính: tên + vai trò cao nhất, badge thành viên,
// nút "Đổi danh tính" luôn hiện, menu ⋯ (Đổi danh tính, Đăng xuất).
// perm: quyền cần có để hiện mục (chỉ UX; API vẫn kiểm tra). Mục không có perm thì ai cũng thấy.
const NAV = [
  { to: "/toi", label: "Tôi", icon: CircleUserRound },
  { to: "/tai-lieu", label: "Tài liệu", icon: FileText },
  { to: "/to-chuc", label: "Tổ chức", icon: Building2, perm: "org_unit.read" },
  { to: "/nguoi-dung", label: "Người dùng", icon: Users, perm: "user.read" },
  { to: "/vai-tro", label: "Vai trò", icon: ShieldCheck, perm: "role.read" },
  { to: "/danh-muc-quyen", label: "Catalog quyền", icon: KeyRound, perm: "role.read" },
  { to: "/mo-phong", label: "Mô phỏng", icon: Workflow, perm: "authz_simulation.run" },
  { to: "/nhat-ky", label: "Nhật ký", icon: ScrollText, perm: "authorization_audit.read" },
] as const satisfies readonly { to: string; label: string; icon: LucideIcon; perm?: string }[];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const me = useQuery(meQuery).data;
  return (
    <nav aria-label="Điều hướng chính" className="flex flex-col gap-1 p-3">
      {NAV.filter((item) => !("perm" in item) || hasPermission(me, item.perm)).map(({ to, label, icon: Icon }) => {
        const isActive = pathname === to || pathname.startsWith(`${to}/`);
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm outline-hidden transition-colors",
              isActive ? "bg-secondary font-medium text-foreground" : "text-foreground/70 hover:bg-item-hover hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function MembershipBadge({ status }: { status: MeResponse["membership"]["status"] }) {
  if (status === "ACTIVE") return <Badge tone="success">Thành viên hoạt động</Badge>;
  if (status === "SUSPENDED") return <Badge tone="warning">Thành viên tạm ngưng</Badge>;
  if (status === "REMOVED") return <Badge tone="warning">Thành viên đã bị gỡ</Badge>;
  return null;
}

function Identity({ me }: { me: MeResponse }) {
  const { switchIdentity, signOut, pending } = useAccountActions();
  const name = me.principal.displayName;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar seed={me.principal.email} name={name} />
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-44 truncate text-sm font-medium text-foreground" title={name}>
            {name}
          </span>
          <span className="block max-w-44 truncate text-xs text-muted">{highestRoleLabel(me)}</span>
        </span>
      </div>
      <span className="hidden lg:inline-flex">
        <MembershipBadge status={me.membership.status} />
      </span>
      <button
        type="button"
        onClick={switchIdentity}
        disabled={pending}
        aria-busy={pending || undefined}
        className="hidden h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium text-foreground outline-hidden transition-colors hover:bg-button-hover disabled:cursor-progress md:inline-flex"
      >
        <Repeat2 className="size-4 shrink-0" aria-hidden />
        Đổi danh tính
      </button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label="Menu tài khoản"
          title="Menu tài khoản"
          className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted outline-hidden transition-colors hover:bg-foreground/5 hover:text-foreground aria-expanded:bg-foreground/5"
        >
          <Ellipsis className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 gap-0 px-0 py-1">
          <DropdownMenuLabel className="px-4 font-normal">
            <p className="truncate text-sm font-medium text-foreground">{name}</p>
            <AccountEmail email={me.principal.email} />
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="mx-0 my-1" />
          <div className="flex flex-col gap-1 px-1">
            <DropdownMenuItem onSelect={switchIdentity}>
              <Repeat2 aria-hidden />
              Đổi danh tính
            </DropdownMenuItem>
          </div>
          <DropdownMenuSeparator className="mx-0 my-1" />
          <div className="flex flex-col gap-1 px-1">
            <DropdownMenuItem variant="danger" onSelect={signOut}>
              <LogOut aria-hidden />
              Đăng xuất
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// I18: thanh cuộn hiện đậm hơn khi đang cuộn (class .is-scrolling trên đúng phần tử đang cuộn).
function useScrollbarAutohide() {
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    const onScroll = (event: Event) => {
      const target = event.target instanceof Element ? event.target : document.documentElement;
      target.classList.add("is-scrolling");
      window.clearTimeout(timers.get(target));
      timers.set(target, window.setTimeout(() => target.classList.remove("is-scrolling"), 700));
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);
}

export function AppShell() {
  const me = useQuery(meQuery);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  useScrollbarAutohide();
  const title = NAV.find((n) => pathname === n.to || pathname.startsWith(`${n.to}/`))?.label ?? "Tôi";

  return (
    <div className="flex min-h-dvh bg-background font-sans text-foreground">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-surface lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b border-border px-4">
          <ProductBrand />
        </div>
        <NavLinks />
      </aside>

      <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <SheetContent side="left" className="lg:hidden" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Điều hướng chính</SheetDescription>
          <div className="flex h-16 shrink-0 items-center border-b border-border px-4">
            <ProductBrand />
          </div>
          <NavLinks onNavigate={() => setIsMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-surface px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            aria-label="Mở menu"
            className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted outline-hidden transition-colors hover:bg-foreground/5 hover:text-foreground lg:hidden"
          >
            <Menu className="size-4" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="min-w-0 truncate text-base font-semibold text-foreground">{title}</h1>
          </div>
          {me.data ? (
            <Identity me={me.data} />
          ) : me.isPending ? (
            <div className="flex items-center gap-2.5" aria-hidden>
              <div className="size-8 animate-pulse rounded-full bg-foreground/5 motion-reduce:animate-none" />
              <Skel className="hidden w-28 sm:block" />
            </div>
          ) : null}
        </header>
        <main className="flex-1 p-4 sm:p-6">
          {me.error instanceof ApiError && me.error.status !== 401 ? (
            <UnavailableScreen error={me.error} onRetry={() => me.refetch()} busy={me.isFetching} />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}

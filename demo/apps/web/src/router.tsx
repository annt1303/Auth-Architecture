import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { isApiError } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { DocumentDetailPage } from "@/pages/document-detail";
import { DocumentFormPage } from "@/pages/document-form";
import { DocumentsPage } from "@/pages/documents";
import { LoginPage } from "@/pages/login";
import { MePage } from "@/pages/me";
import { AuditPage } from "@/pages/audit";
import { CatalogPage } from "@/pages/catalog";
import { OrgUnitsPage } from "@/pages/org-units";
import { RolesPage } from "@/pages/roles";
import { SimulatorPage } from "@/pages/simulator";
import { UserDetailPage } from "@/pages/user-detail";
import { UsersPage } from "@/pages/users";

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/toi" });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): { error?: "login_failed" | "login_denied" } =>
    search.error === "login_failed" || search.error === "login_denied" ? { error: search.error } : {},
  component: LoginPage,
});

// Mọi trang trong khung cần phiên: 401 thì về /login. Lỗi khác để khung tự hiện màn lỗi.
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: AppShell,
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (error) {
      if (isApiError(error) && error.status === 401) throw redirect({ to: "/login" });
    }
  },
});

const meRoute = createRoute({ getParentRoute: () => shellRoute, path: "/toi", component: MePage });

const documentsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/tai-lieu",
  validateSearch: (search: Record<string, unknown>): { status?: "DRAFT" | "PUBLISHED" } =>
    search.status === "DRAFT" || search.status === "PUBLISHED" ? { status: search.status } : {},
  component: DocumentsPage,
});
const documentNewRoute = createRoute({ getParentRoute: () => shellRoute, path: "/tai-lieu/moi", component: DocumentFormPage });
const documentRoute = createRoute({ getParentRoute: () => shellRoute, path: "/tai-lieu/$id", component: DocumentDetailPage });

const orgRoute = createRoute({ getParentRoute: () => shellRoute, path: "/to-chuc", component: OrgUnitsPage });
const usersRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/nguoi-dung",
  validateSearch: (search: Record<string, unknown>): { q?: string } => (typeof search.q === "string" && search.q ? { q: search.q } : {}),
  component: UsersPage,
});
const userRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/nguoi-dung/$id",
  validateSearch: (search: Record<string, unknown>): { tab?: "affiliation" | "assignment" | "membership" | "permissions" } =>
    ["affiliation", "assignment", "membership", "permissions"].includes(search.tab as string)
      ? { tab: search.tab as "affiliation" | "assignment" | "membership" | "permissions" }
      : {},
  component: UserDetailPage,
});
const rolesRoute = createRoute({ getParentRoute: () => shellRoute, path: "/vai-tro", component: RolesPage });
const catalogRoute = createRoute({ getParentRoute: () => shellRoute, path: "/danh-muc-quyen", component: CatalogPage });
const simulatorRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/mo-phong",
  validateSearch: (search: Record<string, unknown>): { tab?: "simulate" | "matrix" | "who-can" } =>
    ["simulate", "matrix", "who-can"].includes(search.tab as string) ? { tab: search.tab as "simulate" | "matrix" | "who-can" } : {},
  component: SimulatorPage,
});
const auditRoute = createRoute({ getParentRoute: () => shellRoute, path: "/nhat-ky", component: AuditPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  shellRoute.addChildren([
    meRoute,
    documentsRoute,
    documentNewRoute,
    documentRoute,
    orgRoute,
    usersRoute,
    userRoute,
    rolesRoute,
    catalogRoute,
    simulatorRoute,
    auditRoute,
  ]),
]);

export const router = createRouter({ routeTree, context: { queryClient: undefined! }, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

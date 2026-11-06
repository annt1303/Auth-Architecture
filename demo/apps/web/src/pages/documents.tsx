import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { DocumentDto } from "@authz-demo/authz-types";
import { FileText, Plus } from "lucide-react";
import { Card, DocumentStatusBadge, LoadError, Skel, UnitLabel } from "@/components/common";
import { TenantBlockedScreen, UnavailableScreen } from "@/components/error-screen";
import { buttonClasses } from "@/components/ui/button";
import { isApiError } from "@/lib/api";
import { formatUpdated } from "@/lib/format";
import { destinationsQuery, documentsQuery, meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Filter = "DRAFT" | "PUBLISHED" | undefined;

const TABS: { value: Filter; label: string }[] = [
  { value: undefined, label: "Tất cả" },
  { value: "DRAFT", label: "Nháp" },
  { value: "PUBLISHED", label: "Đã phát hành" },
];

function Row({ document }: { document: DocumentDto }) {
  return (
    <li>
      <Link
        to="/tai-lieu/$id"
        params={{ id: document.id }}
        className="flex flex-col gap-1.5 px-4 py-3 outline-hidden transition-colors hover:bg-item-hover focus-visible:bg-item-hover sm:px-5"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium" title={document.title}>
            {document.title}
          </span>
          <DocumentStatusBadge status={document.status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="min-w-0 text-sm">
            <UnitLabel name={document.orgUnit.name} type={document.orgUnit.type} />
          </span>
          <span className="truncate">{document.owner.displayName}</span>
          <span className="shrink-0">{formatUpdated(document.updatedAt)}</span>
        </div>
      </Link>
    </li>
  );
}

export function DocumentsPage() {
  const { status } = useSearch({ from: "/shell/tai-lieu" });
  const navigate = useNavigate({ from: "/tai-lieu" });
  const me = useQuery(meQuery);
  const documents = useQuery(documentsQuery);
  // 403 ở đây nghĩa là không được tạo ở đơn vị nào: ẩn nút, không phải lỗi.
  const destinations = useQuery({ ...destinationsQuery, retry: false });
  const canCreate = (destinations.data?.length ?? 0) > 0;

  if (isApiError(documents.error, "tenant_access_denied")) {
    return <TenantBlockedScreen tenantName={me.data?.tenant.name ?? "tổ chức này"} />;
  }
  // Đang hoạt động nhưng chưa có quyền xem tài liệu nào (vd. chưa có vai trò): hiện như danh sách trống.
  const noAccess = isApiError(documents.error, "forbidden");
  if (documents.isError && !noAccess && isApiError(documents.error)) {
    return <UnavailableScreen error={documents.error} onRetry={() => documents.refetch()} busy={documents.isFetching} />;
  }

  const all = documents.data ?? [];
  const shown = status ? all.filter((d) => d.status === status) : all;
  const count = (value: Filter) => (value ? all.filter((d) => d.status === value).length : all.length);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Lọc theo trạng thái" className="inline-flex gap-1 rounded-xl bg-tab-rail p-1">
          {TABS.map((tab) => {
            const active = tab.value === status;
            return (
              <button
                key={tab.label}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => navigate({ search: tab.value ? { status: tab.value } : {} })}
                className={cn(
                  "h-8 cursor-pointer rounded-lg px-3 text-sm font-medium outline-hidden transition-colors",
                  active ? "bg-surface text-foreground shadow-segment-thumb" : "text-foreground/70 hover:text-foreground",
                )}
              >
                {tab.label}
                {documents.data ? <span className="ml-1.5 text-xs text-muted tabular-nums">{count(tab.value)}</span> : null}
              </button>
            );
          })}
        </div>
        {canCreate ? (
          <Link to="/tai-lieu/moi" className={buttonClasses("primary")}>
            <Plus aria-hidden />
            Tạo tài liệu
          </Link>
        ) : null}
      </div>

      <Card>
        {documents.isPending ? (
          <ul aria-busy aria-label="Đang tải" className="divide-y divide-border-strong">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex flex-col gap-2 px-5 py-4">
                <Skel className="w-1/2" />
                <Skel className="w-1/3" />
              </li>
            ))}
          </ul>
        ) : documents.isError && !noAccess ? (
          <LoadError title="Không tải được danh sách tài liệu" why="Kiểm tra kết nối rồi thử lại." onRetry={() => documents.refetch()} />
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <FileText className="size-8 text-muted" aria-hidden />
            <p className="text-sm font-medium">
              {noAccess ? "Bạn chưa có quyền xem tài liệu" : status ? "Không có tài liệu ở trạng thái này" : "Chưa có tài liệu nào"}
            </p>
            <p className="max-w-sm text-sm text-muted">
              {status
                ? "Thử chọn trạng thái khác."
                : canCreate
                  ? "Tạo tài liệu đầu tiên để bắt đầu."
                  : "Xem trang Tôi để biết vai trò của bạn, hoặc nhờ quản trị viên cấp quyền."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-strong">
            {shown.map((document) => (
              <Row key={document.id} document={document} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

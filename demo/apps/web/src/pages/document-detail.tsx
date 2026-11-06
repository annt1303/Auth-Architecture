import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Pencil, Trash2 } from "lucide-react";
import { Card, DlRow, DocumentStatusBadge, LoadError, Skel, UnitLabel } from "@/components/common";
import { DocumentNotFoundScreen, TenantBlockedScreen, UnavailableScreen } from "@/components/error-screen";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonClasses } from "@/components/ui/button";
import { isApiError } from "@/lib/api";
import { formatUpdated } from "@/lib/format";
import { documentQuery, meQuery, useDeleteDocument, useUpdateDocument } from "@/lib/queries";
import { DocumentForm, mutationErrorText } from "./document-form";

export function DocumentDetailPage() {
  const { id } = useParams({ from: "/shell/tai-lieu/$id" });
  const navigate = useNavigate();
  const me = useQuery(meQuery);
  const query = useQuery({ ...documentQuery(id), retry: false });
  const update = useUpdateDocument(id);
  const remove = useDeleteDocument(id);
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const error = query.error;
  if (isApiError(error, "not_found") || isApiError(error, "forbidden")) return <DocumentNotFoundScreen />;
  if (isApiError(error, "tenant_access_denied")) return <TenantBlockedScreen tenantName={me.data?.tenant.name ?? "tổ chức này"} />;
  if (isApiError(error)) return <UnavailableScreen error={error} onRetry={() => query.refetch()} busy={query.isFetching} />;
  if (query.isError) return <LoadError title="Không tải được tài liệu" why="Kiểm tra kết nối rồi thử lại." onRetry={() => query.refetch()} />;

  const document = query.data;
  const canUpdate = document?._actions.includes("update");
  const canDelete = document?._actions.includes("delete");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link to="/tai-lieu" search={{}} className="inline-flex h-8 w-fit items-center gap-1.5 text-sm text-muted outline-hidden hover:text-foreground focus-visible:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Danh sách tài liệu
      </Link>

      <Card className="p-4 sm:p-6">
        {!document ? (
          <div aria-busy aria-label="Đang tải" className="flex flex-col gap-3">
            <Skel className="h-4 w-1/2" />
            <Skel className="w-1/3" />
            <Skel className="w-full" />
          </div>
        ) : editing ? (
          <>
            <h2 className="mb-5 text-base font-semibold">Sửa tài liệu</h2>
            <DocumentForm
              defaults={{ title: document.title, body: document.body, status: document.status, orgUnitId: document.orgUnit.id }}
              submitLabel="Lưu thay đổi"
              submitting={update.isPending}
              serverError={update.isError ? mutationErrorText(update.error) : null}
              onSubmit={({ title, body, status }) => update.mutate({ title, body, status }, { onSuccess: () => setEditing(false) })}
              onCancel={() => {
                update.reset();
                setEditing(false);
              }}
            />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-balance [overflow-wrap:anywhere]">{document.title}</h2>
                <div className="mt-2">
                  <DocumentStatusBadge status={document.status} />
                </div>
              </div>
              {canUpdate || canDelete ? (
                <div className="flex shrink-0 gap-2">
                  {canUpdate ? (
                    <Button onClick={() => setEditing(true)}>
                      <Pencil aria-hidden />
                      Sửa
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                      <Trash2 aria-hidden />
                      Xoá
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <dl className="@container mt-5 flex flex-col gap-3 border-t border-border-strong pt-4 text-sm">
              <DlRow label="Đơn vị">
                <UnitLabel name={document.orgUnit.name} type={document.orgUnit.type} />
              </DlRow>
              <DlRow label="Người tạo">{document.owner.displayName}</DlRow>
              <DlRow label="Cập nhật">{formatUpdated(document.updatedAt)}</DlRow>
            </dl>
            <div className="mt-5 border-t border-border-strong pt-4">
              {document.body ? (
                <p className="text-sm/6 whitespace-pre-wrap [overflow-wrap:anywhere]">{document.body}</p>
              ) : (
                <p className="text-sm text-muted">Tài liệu chưa có nội dung.</p>
              )}
            </div>
            {!canUpdate ? <p className="mt-5 text-xs text-muted">Bạn chỉ có quyền xem tài liệu này.</p> : null}
          </>
        )}
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !remove.isPending && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogTitle className="text-base font-semibold">Xoá tài liệu này?</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm text-muted [overflow-wrap:anywhere]">
            “{document?.title}” sẽ biến mất khỏi danh sách.
          </AlertDialogDescription>
          {remove.isError ? (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {mutationErrorText(remove.error)}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel className={buttonClasses("outline")} disabled={remove.isPending}>
              Huỷ
            </AlertDialogCancel>
            <Button
              variant="danger"
              disabled={remove.isPending}
              aria-busy={remove.isPending || undefined}
              onClick={() => remove.mutate(undefined, { onSuccess: () => navigate({ to: "/tai-lieu", search: {} }) })}
            >
              {remove.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              Xoá tài liệu
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

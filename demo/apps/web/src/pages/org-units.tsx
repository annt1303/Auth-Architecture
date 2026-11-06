import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OrgUnitTreeDto } from "@authz-demo/authz-types";
import { Archive, Building2, Loader2, Pencil, Plus } from "lucide-react";
import { Badge, Card, CardHead, DlRow, LoadError, Mono, Skel, Tag } from "@/components/common";
import { TenantBlockedScreen, UnavailableScreen } from "@/components/error-screen";
import { DomainSection } from "@/components/org/domain-section";
import { orgErrorText } from "@/components/org/messages";
import { OrgTree } from "@/components/org/org-tree";
import { CreateUnitSheet, RenameUnitSheet } from "@/components/org/unit-sheet";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonClasses } from "@/components/ui/button";
import { isApiError } from "@/lib/api";
import { ORG_TYPE_LABEL } from "@/lib/format";
import { useCan } from "@/lib/permissions";
import { meQuery } from "@/lib/queries";
import { orgTreeQuery, useArchiveOrgUnit } from "@/lib/queries-org";

// parent === null: tạo công ty gốc.
type CreateTarget = { parent: OrgUnitTreeDto | null } | null;

function ArchiveDialog({ unit, onClose, onArchived }: { unit: OrgUnitTreeDto | null; onClose: () => void; onArchived: (unit: OrgUnitTreeDto) => void }) {
  // Hook cần id cố định; dialog được mount lại theo unit nên key ở nơi gọi.
  return unit ? <ArchiveDialogInner unit={unit} onClose={onClose} onArchived={onArchived} /> : null;
}

function ArchiveDialogInner({ unit, onClose, onArchived }: { unit: OrgUnitTreeDto; onClose: () => void; onArchived: (unit: OrgUnitTreeDto) => void }) {
  const archive = useArchiveOrgUnit(unit.id);
  return (
    <AlertDialog open onOpenChange={(open) => !open && !archive.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle className="text-base font-semibold">Lưu trữ đơn vị này?</AlertDialogTitle>
        <AlertDialogDescription className="mt-2 text-sm text-muted [overflow-wrap:anywhere]">
          “{unit.name}” sẽ biến khỏi cây tổ chức. Chỉ lưu trữ được khi đơn vị không còn đơn vị con, không còn người được gán vai trò và không còn tài liệu.
        </AlertDialogDescription>
        {archive.isError ? (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {orgErrorText("archive", archive.error)}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel className={buttonClasses("outline")} disabled={archive.isPending}>
            Huỷ
          </AlertDialogCancel>
          <Button
            variant="danger"
            disabled={archive.isPending}
            aria-busy={archive.isPending || undefined}
            onClick={() => archive.mutate(undefined, { onSuccess: () => (onClose(), onArchived(unit)) })}
          >
            {archive.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            Lưu trữ đơn vị
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function UnitDetail({
  unit,
  units,
  onCreateChild,
  onRename,
  onArchive,
}: {
  unit: OrgUnitTreeDto;
  units: OrgUnitTreeDto[];
  onCreateChild: (unit: OrgUnitTreeDto) => void;
  onRename: (unit: OrgUnitTreeDto) => void;
  onArchive: (unit: OrgUnitTreeDto) => void;
}) {
  const canManage = unit._actions.includes("manage");
  const owner = unit.companyId === unit.id ? null : units.find((u) => u.id === unit.companyId);
  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-balance [overflow-wrap:anywhere]">{unit.name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Tag>{ORG_TYPE_LABEL[unit.type]}</Tag>
            <Badge tone={unit.status === "ACTIVE" ? "success" : "neutral"}>{unit.status === "ACTIVE" ? "Đang hoạt động" : "Đã lưu trữ"}</Badge>
          </div>
        </div>
        {canManage ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {unit.type !== "TEAM" ? (
              <Button onClick={() => onCreateChild(unit)}>
                <Plus aria-hidden />
                Tạo đơn vị con
              </Button>
            ) : null}
            <Button onClick={() => onRename(unit)}>
              <Pencil aria-hidden />
              Đổi tên
            </Button>
            <Button variant="danger" onClick={() => onArchive(unit)}>
              <Archive aria-hidden />
              Lưu trữ
            </Button>
          </div>
        ) : null}
      </div>
      <dl className="@container mt-5 flex flex-col gap-3 border-t border-border-strong pt-4 text-sm">
        <DlRow label="Mã">
          <Mono className="text-sm text-foreground">{unit.code}</Mono>
        </DlRow>
        <DlRow label="Loại">{ORG_TYPE_LABEL[unit.type]}</DlRow>
        <DlRow label="Trạng thái">{unit.status === "ACTIVE" ? "Đang hoạt động" : "Đã lưu trữ"}</DlRow>
        <DlRow label="Công ty sở hữu">{unit.companyId === unit.id ? "Chính đơn vị này" : (owner?.name ?? "Không hiển thị với bạn")}</DlRow>
      </dl>
      {!canManage ? <p className="mt-5 text-xs text-muted">Bạn chỉ có quyền xem đơn vị này.</p> : null}
    </Card>
  );
}

export function OrgUnitsPage() {
  const me = useQuery(meQuery);
  const query = useQuery({ ...orgTreeQuery, retry: false });
  const canPropose = useCan("company_domain.manage");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Giữ đích sau khi đóng để Sheet không đổi nội dung giữa lúc trượt ra.
  const [createTarget, setCreateTarget] = useState<CreateTarget>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<OrgUnitTreeDto | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const openCreate = (parent: OrgUnitTreeDto | null) => (setCreateTarget({ parent }), setCreateOpen(true));
  const openRename = (unit: OrgUnitTreeDto) => (setRenaming(unit), setRenameOpen(true));
  const [archiving, setArchiving] = useState<OrgUnitTreeDto | null>(null);

  const units = useMemo(() => query.data ?? [], [query.data]);
  const ids = useMemo(() => new Set(units.map((u) => u.id)), [units]);
  const roots = useMemo(() => units.filter((u) => !u.parentId || !ids.has(u.parentId)), [units, ids]);
  // Chỉ quản trị tenant mới tạo được công ty gốc: suy ra từ việc có đơn vị gốc thật sự không có cha. API vẫn kiểm tra lại.
  const canCreateRoot = units.some((u) => !u.parentId && u._actions.includes("manage"));
  const selected = units.find((u) => u.id === selectedId) ?? roots[0] ?? null;

  if (isApiError(query.error, "tenant_access_denied")) {
    return <TenantBlockedScreen tenantName={me.data?.tenant.name ?? "tổ chức này"} />;
  }
  if (query.isError && isApiError(query.error) && !isApiError(query.error, "network") && !isApiError(query.error, "forbidden")) {
    return <UnavailableScreen error={query.error} onRetry={() => query.refetch()} busy={query.isFetching} />;
  }
  const noAccess = isApiError(query.error, "forbidden");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Cây công ty, phòng ban và team mà bạn được xem.</p>
        {canCreateRoot ? (
          <Button variant="primary" onClick={() => openCreate(null)}>
            <Plus aria-hidden />
            Tạo công ty gốc
          </Button>
        ) : null}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <Card>
          <CardHead title="Cây đơn vị" meta={query.data ? `${units.length} đơn vị` : undefined} />
          {query.isPending ? (
            <ul aria-busy aria-label="Đang tải" className="flex flex-col gap-4 px-4 pb-5">
              {["w-3/4", "w-1/2 ml-6", "w-3/5 ml-6", "w-2/5 ml-12"].map((cls) => (
                <li key={cls}>
                  <Skel className={`h-4 ${cls}`} />
                </li>
              ))}
            </ul>
          ) : query.isError && !noAccess ? (
            <LoadError title="Không tải được cây đơn vị" why="Kiểm tra kết nối rồi thử lại." onRetry={() => query.refetch()} />
          ) : units.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 pt-2 pb-10 text-center">
              <Building2 className="size-8 text-muted" aria-hidden />
              <p className="text-sm font-medium">{noAccess ? "Bạn chưa có quyền xem cây tổ chức" : "Chưa có đơn vị nào"}</p>
              <p className="max-w-sm text-sm text-muted">
                {noAccess ? "Nhờ quản trị viên cấp quyền xem cây tổ chức." : "Bạn chưa thấy đơn vị nào trong phạm vi quyền của mình."}
              </p>
            </div>
          ) : (
            <div className="border-t border-border">
              <OrgTree
                units={units}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
                onCreateChild={openCreate}
                onRename={openRename}
                onArchive={setArchiving}
              />
            </div>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {selected ? (
            <>
              <UnitDetail
                unit={selected}
                units={units}
                onCreateChild={openCreate}
                onRename={openRename}
                onArchive={setArchiving}
              />
              {selected.type === "COMPANY" ? <DomainSection key={selected.id} company={selected} canPropose={canPropose} /> : null}
            </>
          ) : query.isPending ? (
            <Card className="p-4 sm:p-6">
              <div aria-busy aria-label="Đang tải" className="flex flex-col gap-3">
                <Skel className="h-4 w-1/2" />
                <Skel className="w-1/3" />
                <Skel className="w-full" />
              </div>
            </Card>
          ) : (
            <Card className="px-6 py-14 text-center">
              <p className="text-sm text-muted">Chọn một đơn vị trong cây để xem chi tiết.</p>
            </Card>
          )}
        </div>
      </div>

      <CreateUnitSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        parent={createTarget?.parent ?? null}
        onCreated={(unit) => setSelectedId(unit.id)}
      />
      {renaming ? (
        <RenameUnitSheet
          open={renameOpen}
          onOpenChange={setRenameOpen}
          unit={units.find((u) => u.id === renaming.id) ?? renaming}
        />
      ) : null}
      <ArchiveDialog
        key={archiving?.id}
        unit={archiving}
        onClose={() => setArchiving(null)}
        onArchived={(unit) => setSelectedId(unit.parentId)}
      />
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { RoleDto, RoleOwnerKind } from "@authz-demo/authz-types";
import { Archive, Eye, Loader2, Lock, Pencil, Plus, ShieldCheck } from "lucide-react";
import { Badge, Card, LoadError, Mono, Skel, Tag, UnitLabel } from "@/components/common";
import { OWNER_KIND_LABEL, roleErrorText } from "@/components/roles/labels";
import { RoleEditor } from "@/components/roles/role-editor";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/input";
import { roleName } from "@/lib/format";
import { useCan } from "@/lib/permissions";
import { rolesQuery, useArchiveRole, type RoleFilters } from "@/lib/queries-roles";

const OWNER_KINDS: RoleOwnerKind[] = ["SYSTEM", "TENANT", "COMPANY"];

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClasses} text-foreground`}>
        {children}
      </select>
    </label>
  );
}

function RoleRow({ role, onOpen, onArchive }: { role: RoleDto; onOpen: () => void; onArchive: () => void }) {
  const display = role.ownerKind === "SYSTEM" ? roleName(role) : role.name;
  const canUpdate = role._actions.includes("update");
  const canArchive = role._actions.includes("archive");
  const archived = role.status === "ARCHIVED";
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{display}</span>
          <Tag>Level {role.level}</Tag>
          <Tag>{OWNER_KIND_LABEL[role.ownerKind]}</Tag>
          {role.ownerKind === "SYSTEM" || !canUpdate ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Lock className="size-3" aria-hidden />
              Chỉ đọc
            </span>
          ) : null}
          {archived ? <Badge tone="neutral">Đã lưu trữ</Badge> : <Badge tone="success">Đang dùng</Badge>}
        </div>
        <Mono className="mt-1 block break-all">{role.key}</Mono>
        {role.description ? <p className="mt-1 text-sm text-muted">{role.description}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {role.ownerCompany ? (
            <span className="min-w-0 text-sm text-foreground">
              <UnitLabel name={role.ownerCompany.name} type="COMPANY" />
            </span>
          ) : null}
          <span>{role.permissions.length} quyền</span>
          <span>{role.assignmentCount} assignment đang dùng</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button onClick={onOpen} aria-label={`${canUpdate ? "Sửa" : "Xem"} role ${display}`}>
          {canUpdate ? <Pencil aria-hidden /> : <Eye aria-hidden />}
          {canUpdate ? "Sửa" : "Xem"}
        </Button>
        {canArchive ? (
          <Button variant="danger" onClick={onArchive} aria-label={`Lưu trữ role ${display}`}>
            <Archive aria-hidden />
            Lưu trữ
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function RolesPage() {
  const canManage = useCan("role.manage");
  const [ownerKind, setOwnerKind] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const filters: RoleFilters = {
    ...(ownerKind ? { ownerKind: ownerKind as RoleOwnerKind } : {}),
    ...(level ? { level: Number(level) } : {}),
    ...(status ? { status: status as "ACTIVE" | "ARCHIVED" } : {}),
  };
  const roles = useQuery(rolesQuery(filters));
  const [editing, setEditing] = useState<{ role?: RoleDto } | null>(null);
  const [archiving, setArchiving] = useState<RoleDto | null>(null);
  const archive = useArchiveRole();

  const data = roles.data ?? [];
  const filtered = !!(ownerKind || level || status !== "ACTIVE");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Vai trò</h2>
          <p className="mt-1 text-sm text-muted">
            Role là tập quyền. Xem từng quyền ở{" "}
            <Link to="/danh-muc-quyen" className="font-medium text-primary underline-offset-2 hover:underline focus-visible:underline">
              danh mục quyền
            </Link>
            .
          </p>
        </div>
        {canManage ? (
          <Button variant="primary" onClick={() => setEditing({})}>
            <Plus aria-hidden />
            Tạo role
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="group" aria-label="Bộ lọc role">
        <FilterSelect label="Chủ sở hữu" value={ownerKind} onChange={setOwnerKind}>
          <option value="">Tất cả</option>
          {OWNER_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {OWNER_KIND_LABEL[kind]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Level" value={level} onChange={setLevel}>
          <option value="">Tất cả</option>
          {[1, 2, 3, 4, 5].map((l) => (
            <option key={l} value={l}>
              Level {l}{l === 1 ? " (cao nhất)" : ""}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Trạng thái" value={status} onChange={setStatus}>
          <option value="">Tất cả</option>
          <option value="ACTIVE">Đang dùng</option>
          <option value="ARCHIVED">Đã lưu trữ</option>
        </FilterSelect>
      </div>

      <Card>
        {roles.isPending ? (
          <ul aria-busy aria-label="Đang tải" className="divide-y divide-border-strong">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex flex-col gap-2 px-5 py-4">
                <Skel className="w-1/2" />
                <Skel className="w-1/3" />
              </li>
            ))}
          </ul>
        ) : roles.isError ? (
          <LoadError title="Không tải được danh sách role" why="Kiểm tra kết nối rồi thử lại." onRetry={() => roles.refetch()} />
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <ShieldCheck className="size-8 text-muted" aria-hidden />
            <p className="text-sm font-medium">{filtered ? "Không có role nào khớp bộ lọc" : "Chưa có role nào"}</p>
            <p className="max-w-sm text-sm text-muted">{filtered ? "Thử đổi hoặc bỏ bớt bộ lọc." : "Tạo role đầu tiên để bắt đầu."}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border-strong">
            {data.map((role) => (
              <RoleRow
                key={role.id}
                role={role}
                onOpen={() => setEditing({ role })}
                onArchive={() => {
                  archive.reset();
                  setArchiving(role);
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      {editing ? <RoleEditor key={editing.role?.id ?? "new"} role={editing.role} onClose={() => setEditing(null)} /> : null}

      <AlertDialog open={!!archiving} onOpenChange={(open) => !open && !archive.isPending && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogTitle className="text-base font-semibold">Lưu trữ role "{archiving?.name}"?</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm text-muted">
            {archiving && archiving.assignmentCount > 0
              ? `Ảnh hưởng ${archiving.assignmentCount} assignment đang dùng role này. `
              : ""}
            Role đã lưu trữ không gán mới và không sửa được nữa.
          </AlertDialogDescription>
          {archive.isError ? (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {roleErrorText(archive.error)}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel asChild>
              <Button disabled={archive.isPending}>Huỷ</Button>
            </AlertDialogCancel>
            <Button
              variant="danger"
              disabled={archive.isPending}
              aria-busy={archive.isPending || undefined}
              onClick={() => archiving && archive.mutate(archiving.id, { onSuccess: () => setArchiving(null) })}
            >
              {archive.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              Lưu trữ
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

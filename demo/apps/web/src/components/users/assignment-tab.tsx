import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AssignmentDto, UserDto } from "@authz-demo/authz-types";
import { CalendarClock, Plus, ShieldOff } from "lucide-react";
import { Badge, Card, CardHead, LoadError, ScopeLabel, Skel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatValidity, ineffectiveReasonText, roleName } from "@/lib/format";
import { userAssignmentsQuery, useRevokeAssignment, useUpdateAssignment } from "@/lib/queries-users";
import { AssignRoleSheet } from "./assign-role-sheet";
import { ConfirmDialog, ErrorNote, friendlyError, PanelSheet, SubmitLabel } from "./shared";
import { fromDateInput, toDateInput, validityError, ValidityFields } from "./validity-fields";

function StateBadge({ assignment }: { assignment: AssignmentDto }) {
  if (assignment.status === "REVOKED" || assignment.ineffectiveReason === "REVOKED") return <Badge tone="neutral">Đã thu hồi</Badge>;
  if (assignment.effective) return <Badge tone="success">Đang hiệu lực</Badge>;
  const text = ineffectiveReasonText({ ...assignment, ineffectiveReason: assignment.ineffectiveReason as Exclude<AssignmentDto["ineffectiveReason"], "REVOKED"> });
  return <Badge tone="warning">{text || "Chưa hiệu lực"}</Badge>;
}

function EditValiditySheet({ assignment, onClose }: { assignment: AssignmentDto | null; onClose: () => void }) {
  const update = useUpdateAssignment();
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");

  useEffect(() => {
    if (assignment) {
      setFrom(toDateInput(assignment.validFrom));
      setUntil(toDateInput(assignment.validUntil));
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.id]);

  const dateError = validityError(from, until);
  const submit = () => {
    if (!assignment || dateError) return;
    // Chỉ gửi đầu nào đã đổi, để không làm lệch mốc giờ gốc của đầu còn lại.
    const body: { validFrom?: string | null; validUntil?: string | null } = {};
    if (from !== toDateInput(assignment.validFrom)) body.validFrom = fromDateInput(from, false);
    if (until !== toDateInput(assignment.validUntil)) body.validUntil = fromDateInput(until, true);
    if (Object.keys(body).length === 0) return onClose();
    update.mutate({ id: assignment.id, ...body }, { onSuccess: onClose });
  };

  return (
    <Sheet open={assignment !== null} onOpenChange={(open) => !open && !update.isPending && onClose()}>
      <PanelSheet
        title="Sửa thời hạn"
        description={assignment ? `${roleName(assignment.role)} · ${assignment.scope.label}` : ""}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={onClose} disabled={update.isPending}>
              Huỷ
            </Button>
            <Button variant="primary" onClick={submit} disabled={update.isPending || !!dateError} aria-busy={update.isPending || undefined}>
              <SubmitLabel pending={update.isPending}>Lưu thời hạn</SubmitLabel>
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <ValidityFields from={from} until={until} onFrom={setFrom} onUntil={setUntil} error={dateError} idPrefix="ev" />
          <ErrorNote
            message={
              update.isError
                ? friendlyError(update.error, {
                    forbidden: "Bạn không còn quyền sửa thời hạn của assignment này (cần cả quyền thu hồi và quyền gán role ở phạm vi đó).",
                  })
                : null
            }
          />
        </div>
      </PanelSheet>
    </Sheet>
  );
}

function AssignmentRow({ assignment, onEdit, onRevoke }: { assignment: AssignmentDto; onEdit: () => void; onRevoke: () => void }) {
  const inactive = !assignment.effective;
  const canUpdate = assignment._actions.includes("update");
  const canRevoke = assignment._actions.includes("revoke");
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className={inactive ? "min-w-0 text-muted" : "min-w-0"}>
          <p className="text-sm font-medium [overflow-wrap:anywhere]">
            {roleName(assignment.role)} <span className="text-xs font-normal text-muted">· Cấp {assignment.role.level}</span>
          </p>
          <div className="mt-1 text-sm">
            <ScopeLabel scope={assignment.scope} />
          </div>
        </div>
        <StateBadge assignment={assignment} />
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="size-3.5" aria-hidden />
          {formatValidity(assignment)}
        </span>
        <span>
          Cấp bởi {assignment.createdBy?.displayName ?? "hệ thống"} · {formatDate(assignment.createdAt)}
        </span>
        {assignment.revokedAt ? (
          <span>
            Thu hồi {formatDate(assignment.revokedAt)}
            {assignment.revokeReason ? ` · ${assignment.revokeReason}` : ""}
          </span>
        ) : null}
      </p>
      {canUpdate || canRevoke ? (
        <div className="flex flex-wrap gap-2">
          {canUpdate ? (
            <Button className="min-h-9" onClick={onEdit} aria-label={`Sửa thời hạn ${roleName(assignment.role)} tại ${assignment.scope.label}`}>
              <CalendarClock aria-hidden />
              Sửa thời hạn
            </Button>
          ) : null}
          {canRevoke ? (
            <Button variant="danger" className="min-h-9" onClick={onRevoke} aria-label={`Thu hồi ${roleName(assignment.role)} tại ${assignment.scope.label}`}>
              <ShieldOff aria-hidden />
              Thu hồi
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function AssignmentTab({ user }: { user: UserDto }) {
  const canRead = user._actions.includes("read_assignments");
  const canAssign = user._actions.includes("assign");
  const query = useQuery(userAssignmentsQuery(user.id, canRead));
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState<AssignmentDto | null>(null);
  const [revoking, setRevoking] = useState<AssignmentDto | null>(null);
  const [reason, setReason] = useState("");
  const revoke = useRevokeAssignment();

  // Hiệu lực trước, sau đó chưa tới hạn / hết hạn, thu hồi cuối cùng; trong nhóm: level nhỏ (cao) trước.
  const items = useMemo(() => {
    const rank = (a: AssignmentDto) => (a.effective ? 0 : a.status === "REVOKED" ? 2 : 1);
    return [...(query.data ?? [])].sort((a, b) => rank(a) - rank(b) || a.role.level - b.role.level);
  }, [query.data]);

  if (!canRead) {
    return (
      <Card>
        <CardHead title="Role đã gán" />
        <p className="px-4 pb-5 text-sm text-muted sm:px-5">Bạn không có quyền xem role của người dùng này.</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHead
        title="Role đã gán"
        meta={
          canAssign ? (
            <Button variant="primary" className="-my-2 min-h-9" onClick={() => setAssigning(true)}>
              <Plus aria-hidden />
              Gán role
            </Button>
          ) : null
        }
      />
      {query.isPending ? (
        <ul aria-busy aria-label="Đang tải" className="divide-y divide-border-strong border-t border-border-strong">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex flex-col gap-2 px-5 py-4">
              <Skel className="w-1/3" />
              <Skel className="w-1/2" />
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        <LoadError title="Không tải được danh sách role" why="Kiểm tra kết nối rồi thử lại." onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <p className="border-t border-border-strong px-4 py-8 text-center text-sm text-muted sm:px-5">Người dùng chưa được gán role nào.</p>
      ) : (
        <ul className="divide-y divide-border-strong border-t border-border-strong">
          {items.map((assignment) => (
            <AssignmentRow
              key={assignment.id}
              assignment={assignment}
              onEdit={() => setEditing(assignment)}
              onRevoke={() => {
                revoke.reset();
                setReason("");
                setRevoking(assignment);
              }}
            />
          ))}
        </ul>
      )}

      {canAssign ? <AssignRoleSheet user={user} open={assigning} onOpenChange={setAssigning} /> : null}
      <EditValiditySheet assignment={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Thu hồi role này?"
        description={
          revoking ? (
            <p>
              {user.displayName} sẽ mất role “{roleName(revoking.role)}” tại {revoking.scope.label} ngay lập tức. Muốn có lại phải gán mới.
            </p>
          ) : null
        }
        confirmLabel="Thu hồi role"
        pending={revoke.isPending}
        error={
          revoke.isError
            ? friendlyError(revoke.error, { forbidden: "Bạn không còn quyền thu hồi role này: chỉ thu hồi được role thấp cấp hơn role của bạn." })
            : null
        }
        onConfirm={() => revoking && revoke.mutate({ id: revoking.id, reason: reason.trim() || undefined }, { onSuccess: () => setRevoking(null) })}
      >
        <label htmlFor="revoke-reason" className="mt-4 mb-1.5 block text-sm font-medium">
          Lý do (không bắt buộc)
        </label>
        <Textarea id="revoke-reason" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </Card>
  );
}

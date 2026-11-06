import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OrgUnitRef, UserDto } from "@authz-demo/authz-types";
import { Pencil, Plus, Unlink } from "lucide-react";
import { Card, CardHead, LoadError, UnitLabel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { orgUnitsQuery } from "@/lib/queries";
import { useAddAffiliation, useMoveAffiliation, useRemoveAffiliation } from "@/lib/queries-users";
import { activeUnits, ConfirmDialog, departmentsOf, ErrorNote, friendlyError, Label, PanelSheet, SubmitLabel, UnitPicker } from "./shared";

type Affiliation = UserDto["affiliations"][number];

// Một Sheet cho hai việc: thêm công ty (companyId chưa có) hoặc đổi phòng ban của công ty đã có.
function AffiliationSheet({
  user,
  target,
  open,
  onOpenChange,
}: {
  user: UserDto;
  target: Affiliation | null; // null = thêm công ty mới
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const units = useQuery({ ...orgUnitsQuery, enabled: open });
  const add = useAddAffiliation(user.id);
  const move = useMoveAffiliation(user.id);
  const mutation = target ? move : add;
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCompanyId(target?.company.id ?? null);
      setDepartmentId(target?.department?.id ?? null);
      setLocalError(null);
      add.reset();
      move.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  const all = useMemo(() => activeUnits(units.data), [units.data]);
  const taken = new Set(user.affiliations.map((a) => a.company.id));
  const companies = useMemo(() => all.filter((u) => u.type === "COMPANY" && !taken.has(u.id)), [all, user.affiliations]); // eslint-disable-line react-hooks/exhaustive-deps
  const departments = useMemo(() => departmentsOf(all, companyId), [all, companyId]);

  const submit = () => {
    if (!companyId) return setLocalError("Chọn công ty");
    setLocalError(null);
    const done = { onSuccess: () => onOpenChange(false) };
    if (target) move.mutate({ companyId, departmentId }, done);
    else add.mutate({ companyId, departmentId }, done);
  };

  const errorText = mutation.isError
    ? friendlyError(mutation.error, {
        forbidden: target
          ? "Bạn không có quyền đổi phòng ban của người này trong công ty đó."
          : "Bạn không thêm được người này vào công ty đó: công ty nằm ngoài phạm vi của bạn, hoặc người này không nằm trong phạm vi bạn được xem.",
        conflict: "Người này đã thuộc công ty đó. Tải lại trang để xem thông tin mới nhất.",
      })
    : localError;

  return (
    <Sheet open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <PanelSheet
        title={target ? "Đổi phòng ban" : "Thêm vào công ty"}
        description={target ? `Công ty ${target.company.name}` : "Một người có thể thuộc nhiều công ty. Việc thêm không trao quyền nào."}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Huỷ
            </Button>
            <Button variant="primary" onClick={submit} disabled={mutation.isPending || units.isPending} aria-busy={mutation.isPending || undefined}>
              <SubmitLabel pending={mutation.isPending}>{target ? "Lưu phòng ban" : "Thêm vào công ty"}</SubmitLabel>
            </Button>
          </div>
        }
      >
        {units.isError ? (
          <LoadError title="Không tải được danh sách đơn vị" why="Kiểm tra kết nối rồi thử lại." onRetry={() => units.refetch()} />
        ) : (
          <div className="flex flex-col gap-5">
            {!target ? (
              <div>
                <Label>Công ty</Label>
                <UnitPicker
                  label="Công ty"
                  units={companies}
                  value={companyId}
                  onChange={(id) => {
                    setCompanyId(id);
                    setDepartmentId(null);
                  }}
                  empty={units.isPending ? "Đang tải…" : "Không còn công ty nào để thêm."}
                />
              </div>
            ) : null}
            {companyId ? (
              <div>
                <Label>Phòng ban (không bắt buộc)</Label>
                <UnitPicker label="Phòng ban" units={departments} value={departmentId} onChange={setDepartmentId} noneLabel="Không thuộc phòng ban nào" />
              </div>
            ) : null}
            <ErrorNote message={errorText} />
          </div>
        )}
      </PanelSheet>
    </Sheet>
  );
}

function Line({ company, department }: { company: OrgUnitRef; department: OrgUnitRef | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <UnitLabel name={company.name} type="COMPANY" />
      {department ? (
        <div className="pl-6">
          <UnitLabel name={department.name} type="DEPARTMENT" />
        </div>
      ) : (
        <p className="pl-6 text-xs text-muted">Chưa thuộc phòng ban nào</p>
      )}
    </div>
  );
}

export function AffiliationTab({ user }: { user: UserDto }) {
  const canManage = user._actions.includes("affiliate");
  const [sheet, setSheet] = useState<{ target: Affiliation | null } | null>(null);
  const [removing, setRemoving] = useState<Affiliation | null>(null);
  const remove = useRemoveAffiliation(user.id);

  return (
    <Card>
      <CardHead
        title="Công ty và phòng ban"
        meta={
          canManage ? (
            <Button className="-my-2 min-h-9" onClick={() => setSheet({ target: null })}>
              <Plus aria-hidden />
              Thêm công ty
            </Button>
          ) : (
            `${user.affiliations.length} đơn vị`
          )
        }
      />
      {user.affiliations.length === 0 ? (
        <p className="px-4 pb-5 text-sm text-muted sm:px-5">Người dùng chưa thuộc công ty nào.</p>
      ) : (
        <ul className="divide-y divide-border-strong border-t border-border-strong">
          {user.affiliations.map((a) => (
            <li key={a.company.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <Line company={a.company} department={a.department} />
              </div>
              {canManage ? (
                <div className="flex shrink-0 gap-2">
                  <Button className="min-h-9" onClick={() => setSheet({ target: a })} aria-label={`Đổi phòng ban tại ${a.company.name}`}>
                    <Pencil aria-hidden />
                    Đổi phòng ban
                  </Button>
                  <Button
                    variant="danger"
                    className="min-h-9"
                    onClick={() => {
                      remove.reset();
                      setRemoving(a);
                    }}
                    aria-label={`Gỡ khỏi ${a.company.name}`}
                  >
                    <Unlink aria-hidden />
                    Gỡ
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!canManage ? <p className="border-t border-border-strong px-4 py-3 text-xs text-muted sm:px-5">Bạn chỉ có quyền xem đơn vị trực thuộc.</p> : null}

      <AffiliationSheet user={user} target={sheet?.target ?? null} open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Gỡ ${user.displayName} khỏi ${removing?.company.name ?? "công ty"}?`}
        description={
          <p>
            Mọi role của người này trong cây của công ty này (công ty, phòng ban và team bên dưới) sẽ bị thu hồi cùng lúc. Việc này không hoàn tác được: muốn
            có lại phải gán role mới.
          </p>
        }
        confirmLabel="Gỡ khỏi công ty"
        pending={remove.isPending}
        error={
          remove.isError
            ? friendlyError(remove.error, {
                forbidden:
                  "Chưa gỡ được. Người này đang giữ role mà bạn không đủ cấp để thu hồi (cùng cấp hoặc cao hơn bạn). Khi một role không thu hồi được thì cả thao tác bị từ chối. Nhờ người có cấp cao hơn thực hiện.",
              })
            : null
        }
        onConfirm={() => removing && remove.mutate(removing.company.id, { onSuccess: () => setRemoving(null) })}
      />
    </Card>
  );
}

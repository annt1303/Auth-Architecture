import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AssignmentOptionsDto, RoleRef, ScopeDto, ScopeType, UserDto } from "@authz-demo/authz-types";
import { Check, ChevronLeft, Search } from "lucide-react";
import { LoadError, ScopeLabel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { isApiError } from "@/lib/api";
import { roleName, SCOPE_TYPE_LABEL, scopeKey } from "@/lib/format";
import { assignmentOptionsQuery, useCreateAssignment } from "@/lib/queries-users";
import { cn } from "@/lib/utils";
import { ErrorNote, friendlyError, Label, PanelSheet, SubmitLabel } from "./shared";
import { fromDateInput, validityError, ValidityFields } from "./validity-fields";

type Option = AssignmentOptionsDto["roles"][number];

const OWNER_LABEL: Record<RoleRef["ownerKind"], string> = { SYSTEM: "Hệ thống", TENANT: "Tenant", COMPANY: "Công ty" };

// ---------------------------------------------------------------- Combobox chọn role (lọc + listbox, bàn phím)

function RoleCombobox({ options, value, onChange }: { options: Option[]; value: string | null; onChange: (roleId: string) => void }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    return options.filter(({ role }) => !needle || roleName(role).toLocaleLowerCase("vi").includes(needle) || role.key.toLowerCase().includes(needle));
  }, [options, query]);
  const index = Math.min(active, Math.max(filtered.length - 1, 0));
  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={filtered.length ? optionId(index) : undefined}
          aria-label="Tìm role"
          placeholder="Tìm role"
          autoComplete="off"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive(Math.min(index + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive(Math.max(index - 1, 0));
            } else if (e.key === "Enter" && filtered[index]) {
              e.preventDefault();
              onChange(filtered[index].role.id);
            }
          }}
          className="pl-10"
        />
      </div>
      <ul id={listId} role="listbox" aria-label="Role có thể gán" className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-border-strong p-1">
        {filtered.length === 0 ? (
          <li role="presentation" className="px-3 py-3 text-sm text-muted">
            Không có role nào khớp.
          </li>
        ) : (
          filtered.map(({ role }, i) => {
            const selected = role.id === value;
            return (
              <li
                key={role.id}
                id={optionId(i)}
                role="option"
                aria-selected={selected}
                onClick={() => onChange(role.id)}
                onMouseMove={() => setActive(i)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm",
                  i === index && "bg-item-hover",
                  selected && "bg-secondary font-medium",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{roleName(role)}</span>
                  <span className="block text-xs text-muted">
                    Cấp {role.level} · {OWNER_LABEL[role.ownerKind]}
                  </span>
                </span>
                {selected ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Chọn scope, nhóm theo loại

const GROUP_ORDER: ScopeType[] = ["TENANT", "COMPANY", "DEPARTMENT", "TEAM", "RESOURCE", "SELF"];

function ScopePicker({ scopes, value, onChange }: { scopes: ScopeDto[]; value: string | null; onChange: (key: string) => void }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase("vi");
  const shown = scopes.filter((s) => !needle || s.label.toLocaleLowerCase("vi").includes(needle));
  const groups = GROUP_ORDER.map((type) => ({ type, items: shown.filter((s) => s.type === type) })).filter((g) => g.items.length > 0);
  return (
    <div className="flex flex-col gap-3">
      {scopes.length > 8 ? (
        <Input aria-label="Lọc phạm vi" placeholder="Lọc theo tên" value={query} onChange={(e) => setQuery(e.target.value)} />
      ) : null}
      <div role="radiogroup" aria-label="Phạm vi áp dụng" className="flex flex-col gap-3">
        {groups.length === 0 ? <p className="text-sm text-muted">Không có phạm vi nào khớp.</p> : null}
        {groups.map(({ type, items }) => (
          <div key={type} role="group" aria-label={SCOPE_TYPE_LABEL[type]}>
            <p className="mb-1 px-1 text-xs font-medium text-muted">{type === "RESOURCE" ? "Một tài liệu cụ thể" : SCOPE_TYPE_LABEL[type]}</p>
            <div className="rounded-xl border border-border-strong p-1">
              {items.map((scope) => {
                const key = scopeKey(scope);
                const checked = key === value;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => onChange(key)}
                    className={cn(
                      "flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-focus",
                      checked ? "bg-secondary font-medium" : "hover:bg-item-hover",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("size-4 shrink-0 rounded-full border-2", checked ? "border-primary bg-primary ring-2 ring-white ring-inset" : "border-border-strong")}
                    />
                    <ScopeLabel scope={scope} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Sheet nhiều bước

const STEPS = ["Role", "Phạm vi", "Thời hạn"] as const;

export function AssignRoleSheet({ user, open, onOpenChange }: { user: UserDto; open: boolean; onOpenChange: (open: boolean) => void }) {
  const options = useQuery(assignmentOptionsQuery(user.id, open));
  const create = useCreateAssignment();
  const [step, setStep] = useState(0);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");

  useEffect(() => {
    if (open) {
      setStep(0);
      setRoleId(null);
      setScopeId(null);
      setFrom("");
      setUntil("");
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const roles = options.data?.roles ?? [];
  const option = roles.find((o) => o.role.id === roleId);
  const scope = option?.scopes.find((s) => scopeKey(s) === scopeId);
  const dateError = validityError(from, until);

  const submit = () => {
    if (!option || !scope || dateError) return;
    create.mutate(
      {
        userId: user.id,
        roleId: option.role.id,
        scope: { type: scope.type, id: scope.id },
        validFrom: fromDateInput(from, false),
        validUntil: fromDateInput(until, true),
      },
      {
        onSuccess: () => onOpenChange(false),
        // Lựa chọn có thể đã đổi (quyền của actor thay đổi): nạp lại để chỉ còn lựa chọn hợp lệ.
        onError: (error) => {
          if (isApiError(error, "forbidden")) void options.refetch();
        },
      },
    );
  };

  const errorText = create.isError
    ? friendlyError(create.error, {
        forbidden: "Bạn không còn quyền gán role này tại đây. Danh sách lựa chọn đã được tải lại, hãy chọn lại.",
        conflict: "Người này đã có đúng role này ở phạm vi này (còn hiệu lực). Không cần gán thêm.",
      })
    : null;

  const body = options.isPending ? (
    <p aria-busy className="py-10 text-center text-sm text-muted">
      Đang tải lựa chọn…
    </p>
  ) : options.isError ? (
    isApiError(options.error, "forbidden") ? (
      <p className="py-10 text-center text-sm text-muted">Bạn không có quyền gán role cho người này.</p>
    ) : (
      <LoadError title="Không tải được các lựa chọn" why="Kiểm tra kết nối rồi thử lại." onRetry={() => options.refetch()} />
    )
  ) : roles.length === 0 ? (
    <div className="py-10 text-center">
      <p className="text-sm font-medium">Không có role nào bạn gán được cho người này</p>
      <p className="mt-1 text-sm text-muted">Bạn chỉ gán được role thấp cấp hơn role của mình, trong phạm vi bạn quản lý.</p>
    </div>
  ) : step === 0 ? (
    <div>
      <Label>Chọn role</Label>
      <RoleCombobox
        options={roles}
        value={roleId}
        onChange={(id) => {
          if (id !== roleId) setScopeId(null);
          setRoleId(id);
        }}
      />
      <p className="mt-2 text-xs text-muted">Chỉ hiện role bạn được phép gán cho người này.</p>
    </div>
  ) : step === 1 && option ? (
    <div>
      <Label>Gán “{roleName(option.role)}” tại</Label>
      <ScopePicker scopes={option.scopes} value={scopeId} onChange={setScopeId} />
    </div>
  ) : option && scope ? (
    <div className="flex flex-col gap-5">
      <dl className="flex flex-col gap-2 rounded-xl bg-secondary/60 p-4 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Người dùng</dt>
          <dd className="min-w-0 truncate font-medium">{user.displayName}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Role</dt>
          <dd className="font-medium">{roleName(option.role)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">Phạm vi</dt>
          <dd className="min-w-0 font-medium">
            <ScopeLabel scope={scope} />
          </dd>
        </div>
      </dl>
      <ValidityFields from={from} until={until} onFrom={setFrom} onUntil={setUntil} error={dateError} idPrefix="ar" />
      <ErrorNote message={errorText} />
    </div>
  ) : null;

  const canNext = step === 0 ? !!option : step === 1 ? !!scope : false;

  return (
    <Sheet open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <PanelSheet
        title="Gán role"
        description={`Cho ${user.displayName}`}
        footer={
          <div className="flex flex-col gap-3">
            <ol aria-label="Các bước" className="flex items-center gap-2 text-xs text-muted">
              {STEPS.map((name, i) => (
                <li key={name} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-1.5", i === step && "font-medium text-foreground")}>
                  <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums", i <= step ? "bg-primary text-primary-foreground" : "bg-zinc-100")}>
                    {i + 1}
                  </span>
                  {name}
                  {i < STEPS.length - 1 ? <span aria-hidden className="mx-1 h-px w-4 bg-border-strong" /> : null}
                </li>
              ))}
            </ol>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {step > 0 ? (
                <Button onClick={() => setStep(step - 1)} disabled={create.isPending}>
                  <ChevronLeft aria-hidden />
                  Quay lại
                </Button>
              ) : (
                <Button onClick={() => onOpenChange(false)}>Huỷ</Button>
              )}
              {step < 2 ? (
                <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
                  Tiếp tục
                </Button>
              ) : (
                <Button variant="primary" onClick={submit} disabled={create.isPending || !!dateError || !scope} aria-busy={create.isPending || undefined}>
                  <SubmitLabel pending={create.isPending}>Gán role</SubmitLabel>
                </Button>
              )}
            </div>
          </div>
        }
      >
        {body}
      </PanelSheet>
    </Sheet>
  );
}


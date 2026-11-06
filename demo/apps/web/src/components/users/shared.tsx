import { useMemo, type ReactNode } from "react";
import type { OrgUnitDto, UserDto } from "@authz-demo/authz-types";
import { Loader2, X } from "lucide-react";
import { Badge, UnitLabel } from "@/components/common";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonClasses } from "@/components/ui/button";
import { SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- lỗi thân thiện (SPEC §11: không lộ reasonCode / constraint)

export type ErrorTexts = { forbidden?: string; conflict?: string; not_found?: string };

export function friendlyError(error: unknown, texts: ErrorTexts = {}): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "invalid_request":
        return error.details?.map((d) => d.issue).join(". ") || "Dữ liệu chưa hợp lệ. Kiểm tra lại các trường.";
      case "forbidden":
        return texts.forbidden ?? "Bạn không có quyền thực hiện thao tác này.";
      case "conflict":
        return texts.conflict ?? "Thao tác bị trùng hoặc không còn hợp lệ với trạng thái hiện tại. Tải lại trang rồi thử lại.";
      case "not_found":
        return texts.not_found ?? "Không tìm thấy dữ liệu. Có thể nó đã bị xoá hoặc bạn không còn quyền xem.";
      case "tenant_access_denied":
        return "Tư cách thành viên của bạn đang không hoạt động nên chưa thực hiện được thao tác này.";
      case "authorization_unavailable":
      case "network":
        return "Chưa kiểm tra được quyền hoặc mất kết nối. Thử lại sau ít phút.";
      default:
        break;
    }
  }
  return "Có lỗi ở phía hệ thống. Thử lại sau ít phút.";
}

export function ErrorNote({ message, className }: { message: string | null; className?: string }) {
  return message ? (
    <p role="alert" className={cn("rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700", className)}>
      {message}
    </p>
  ) : null;
}

// ---------------------------------------------------------------- form

export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} role="alert" className="mt-1.5 text-sm text-red-600">
      {message}
    </p>
  ) : null;
}

export const Label = ({ htmlFor, id, children }: { htmlFor?: string; id?: string; children: ReactNode }) => (
  <label htmlFor={htmlFor} id={id} className="mb-1.5 block text-sm font-medium">
    {children}
  </label>
);

export function SubmitLabel({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <>
      {pending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {children}
    </>
  );
}

// ---------------------------------------------------------------- Badge trạng thái

export function MembershipBadge({ status }: { status: UserDto["membershipStatus"] }) {
  if (status === "ACTIVE") return <Badge tone="success">Đang hoạt động</Badge>;
  if (status === "SUSPENDED") return <Badge tone="warning">Tạm ngưng</Badge>;
  if (status === "REMOVED") return <Badge tone="error">Đã loại bỏ</Badge>;
  return <Badge tone="neutral">Chưa có</Badge>;
}

// ---------------------------------------------------------------- chọn đơn vị (radio, thụt theo cây)

type Node = { unit: OrgUnitDto; children: Node[] };

function buildTree(units: OrgUnitDto[]): Node[] {
  const nodes = new Map(units.map((unit) => [unit.id, { unit, children: [] as Node[] }]));
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    const parent = node.unit.parentId ? nodes.get(node.unit.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

function RadioRow({ checked, depth, onSelect, children }: { checked: boolean; depth: number; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
      className={cn(
        "flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg pr-3 text-left text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-focus",
        checked ? "bg-secondary font-medium" : "hover:bg-item-hover",
      )}
    >
      <span
        aria-hidden
        className={cn("size-4 shrink-0 rounded-full border-2", checked ? "border-primary bg-primary ring-2 ring-white ring-inset" : "border-border-strong")}
      >
      </span>
      {children}
    </button>
  );
}

function Options({ nodes, depth, value, onChange }: { nodes: Node[]; depth: number; value: string | null; onChange: (id: string) => void }) {
  return nodes.map(({ unit, children }) => (
    <div key={unit.id}>
      <RadioRow checked={value === unit.id} depth={depth} onSelect={() => onChange(unit.id)}>
        <UnitLabel name={unit.name} type={unit.type} />
      </RadioRow>
      <Options nodes={children} depth={depth + 1} value={value} onChange={onChange} />
    </div>
  ));
}

export function UnitPicker({
  label,
  units,
  value,
  onChange,
  noneLabel,
  empty = "Không có đơn vị nào để chọn.",
}: {
  label: string;
  units: OrgUnitDto[];
  value: string | null;
  onChange: (id: string | null) => void;
  noneLabel?: string;
  empty?: string;
}) {
  const tree = useMemo(() => buildTree(units), [units]);
  if (units.length === 0 && !noneLabel) return <p className="rounded-xl border border-border-strong px-4 py-3 text-sm text-muted">{empty}</p>;
  return (
    <div role="radiogroup" aria-label={label} className="max-h-72 overflow-y-auto rounded-xl border border-border-strong p-1">
      {noneLabel ? (
        <RadioRow checked={value === null} depth={0} onSelect={() => onChange(null)}>
          <span className="text-muted">{noneLabel}</span>
        </RadioRow>
      ) : null}
      <Options nodes={tree} depth={0} value={value} onChange={onChange} />
    </div>
  );
}

// ---------------------------------------------------------------- Sheet và hộp xác nhận

export function PanelSheet({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <SheetContent aria-describedby="panel-desc">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
          <SheetDescription id="panel-desc" className="mt-0.5 text-sm text-muted">
            {description}
          </SheetDescription>
        </div>
        <SheetClose
          aria-label="Đóng"
          className="-mt-1 -mr-2 flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted outline-hidden hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
        >
          <X className="size-5" aria-hidden />
        </SheetClose>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      {footer ? <div className="border-t border-border px-5 py-4">{footer}</div> : null}
    </SheetContent>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger = true,
  pending,
  error,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogTitle className="text-base font-semibold">{title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="mt-2 text-sm/6 text-muted [overflow-wrap:anywhere]">{description}</div>
        </AlertDialogDescription>
        {children}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel className={buttonClasses("outline")} disabled={pending}>
            Huỷ
          </AlertDialogCancel>
          <Button variant={danger ? "danger" : "primary"} disabled={pending} aria-busy={pending || undefined} onClick={onConfirm}>
            <SubmitLabel pending={pending}>{confirmLabel}</SubmitLabel>
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Công ty / phòng ban đang hoạt động, dùng cho các form chọn đơn vị.
export const activeUnits = (units: OrgUnitDto[] | undefined) => (units ?? []).filter((u) => u.status === "ACTIVE");
export const departmentsOf = (units: OrgUnitDto[], companyId: string | null) =>
  companyId ? units.filter((u) => u.companyId === companyId && u.type === "DEPARTMENT") : [];

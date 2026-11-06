import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { OrgUnitTreeDto, OrgUnitType } from "@authz-demo/authz-types";
import { Controller, useForm } from "react-hook-form";
import { Loader2, X } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ORG_TYPE_LABEL } from "@/lib/format";
import { useCreateOrgUnit, useRenameOrgUnit } from "@/lib/queries-org";
import { cn } from "@/lib/utils";
import { CHILD_TYPES, orgErrorText } from "./messages";

const nameField = z.string().trim().min(1, "Nhập tên đơn vị").max(200, "Tên tối đa 200 ký tự");

const createSchema = z.object({
  unitType: z.enum(["COMPANY", "DEPARTMENT", "TEAM"]),
  code: z
    .string()
    .trim()
    .min(1, "Nhập mã đơn vị")
    .max(64, "Mã tối đa 64 ký tự")
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Chỉ dùng chữ hoa A-Z, số, “_” và “-”; ký tự đầu là chữ hoặc số"),
  name: nameField,
});
type CreateValues = z.infer<typeof createSchema>;

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} role="alert" className="mt-1.5 text-sm text-red-600">
      {message}
    </p>
  ) : null;
}

const Label = ({ htmlFor, children }: { htmlFor?: string; children: string }) => (
  <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
    {children}
  </label>
);

function SheetShell({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
            <SheetDescription className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">{description}</SheetDescription>
          </div>
          <SheetClose
            aria-label="Đóng"
            className="-mr-2 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted outline-hidden hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
          >
            <X className="size-4" aria-hidden />
          </SheetClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

function Actions({ submitting, submitLabel, onCancel }: { submitting: boolean; submitLabel: string; onCancel: () => void }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button onClick={onCancel} disabled={submitting}>
        Huỷ
      </Button>
      <Button type="submit" variant="primary" disabled={submitting} aria-busy={submitting || undefined}>
        {submitting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        {submitLabel}
      </Button>
    </div>
  );
}

function ServerError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </p>
  ) : null;
}

// parent = null: tạo công ty gốc (chỉ quản trị tenant, API trả 403 nếu không đủ quyền).
export function CreateUnitSheet({
  open,
  onOpenChange,
  parent,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parent: OrgUnitTreeDto | null;
  onCreated: (unit: OrgUnitTreeDto) => void;
}) {
  const create = useCreateOrgUnit();
  const types: OrgUnitType[] = parent ? CHILD_TYPES[parent.type] : ["COMPANY"];
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateValues>({ resolver: zodResolver(createSchema), defaultValues: { unitType: types[0] ?? "COMPANY", code: "", name: "" } });

  // Mở lại cho cha khác thì làm sạch form và lỗi cũ.
  useEffect(() => {
    if (open) {
      reset({ unitType: types[0] ?? "COMPANY", code: "", name: "" });
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parent?.id]);

  const close = () => !create.isPending && onOpenChange(false);

  return (
    <SheetShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={parent ? "Tạo đơn vị con" : "Tạo công ty gốc"}
      description={parent ? `Đơn vị mới sẽ nằm trong “${parent.name}”.` : "Công ty gốc không thuộc đơn vị nào. Chỉ quản trị tenant tạo được."}
    >
      {types.length === 0 ? (
        <p className="text-sm text-muted">Team không chứa đơn vị con nào.</p>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={handleSubmit((values) =>
            create.mutate({ ...values, parentId: parent?.id ?? null }, { onSuccess: (unit) => (onOpenChange(false), onCreated(unit)) }),
          )}
        >
          <div>
            <Label>Loại đơn vị</Label>
            <Controller
              control={control}
              name="unitType"
              render={({ field }) => (
                <div role="radiogroup" aria-label="Loại đơn vị" className="grid gap-2 sm:grid-cols-2">
                  {types.map((type) => (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={field.value === type}
                      onClick={() => field.onChange(type)}
                      className={cn(
                        "min-h-10 cursor-pointer rounded-xl border px-4 py-2.5 text-left text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-focus",
                        field.value === type ? "border-primary bg-primary-light" : "border-border-strong hover:bg-item-hover",
                      )}
                    >
                      {ORG_TYPE_LABEL[type]}
                    </button>
                  ))}
                </div>
              )}
            />
            {parent ? (
              <p className="mt-1.5 text-xs text-muted">
                {ORG_TYPE_LABEL[parent.type]} chỉ chứa {types.map((type) => ORG_TYPE_LABEL[type].toLocaleLowerCase("vi")).join(" hoặc ")}.
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="unit-code">Mã đơn vị</Label>
            <Input
              id="unit-code"
              autoFocus
              maxLength={64}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="font-mono uppercase placeholder:normal-case"
              aria-invalid={!!errors.code}
              aria-describedby="unit-code-hint unit-code-error"
              {...register("code", { setValueAs: (v: string) => v.toUpperCase() })}
            />
            <FieldError id="unit-code-error" message={errors.code?.message} />
            <p id="unit-code-hint" className="mt-1.5 text-xs text-muted">
              Ví dụ: ACME-HR. Mã tự chuyển sang chữ hoa.
            </p>
          </div>
          <div>
            <Label htmlFor="unit-name">Tên đơn vị</Label>
            <Input id="unit-name" maxLength={200} aria-invalid={!!errors.name} aria-describedby="unit-name-error" {...register("name")} />
            <FieldError id="unit-name-error" message={errors.name?.message} />
          </div>
          <ServerError message={create.isError ? orgErrorText("create", create.error) : null} />
          <Actions submitting={create.isPending} submitLabel="Tạo đơn vị" onCancel={close} />
        </form>
      )}
    </SheetShell>
  );
}

export function RenameUnitSheet({ open, onOpenChange, unit }: { open: boolean; onOpenChange: (open: boolean) => void; unit: OrgUnitTreeDto }) {
  const rename = useRenameOrgUnit(unit.id);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<{ name: string }>({ resolver: zodResolver(z.object({ name: nameField })), defaultValues: { name: unit.name } });

  useEffect(() => {
    if (open) {
      reset({ name: unit.name });
      rename.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unit.id]);

  const close = () => !rename.isPending && onOpenChange(false);

  return (
    <SheetShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Đổi tên đơn vị"
      description={`Mã ${unit.code} và vị trí trong cây giữ nguyên.`}
    >
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={handleSubmit(({ name }) => rename.mutate(name, { onSuccess: () => onOpenChange(false) }))}
      >
        <div>
          <Label htmlFor="rename-name">Tên đơn vị</Label>
          <Input id="rename-name" autoFocus maxLength={200} aria-invalid={!!errors.name} aria-describedby="rename-name-error" {...register("name")} />
          <FieldError id="rename-name-error" message={errors.name?.message} />
        </div>
        <ServerError message={rename.isError ? orgErrorText("rename", rename.error) : null} />
        <Actions submitting={rename.isPending} submitLabel="Lưu tên" onCancel={close} />
      </form>
    </SheetShell>
  );
}

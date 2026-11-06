import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RoleDto } from "@authz-demo/authz-types";
import { Controller, useForm } from "react-hook-form";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { z } from "zod";
import { LoadError, Skel } from "@/components/common";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input, inputClasses } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { meQuery, orgUnitsQuery } from "@/lib/queries";
import { permissionsQuery, useCreateRole, useUpdateRole } from "@/lib/queries-roles";
import { cn } from "@/lib/utils";
import { OWNER_KIND_LABEL, actorHasPermissionFor, actorRank, roleErrorText } from "./labels";
import { PermissionChecklist } from "./permission-checklist";

const schema = z.object({
  ownerKind: z.enum(["TENANT", "COMPANY"]),
  ownerCompanyId: z.string(),
  keySuffix: z.string(),
  name: z.string().trim().min(1, "Nhập tên role").max(200, "Tên tối đa 200 ký tự"),
  description: z.string().trim().max(500, "Mô tả tối đa 500 ký tự"),
  level: z.number().int().min(2).max(5),
});
type FormValues = z.infer<typeof schema>;

const KEY_SUFFIX = /^[a-z][a-z0-9_]*$/;
const LEVELS = [2, 3, 4, 5];

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

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

type Props = {
  // undefined = tạo mới
  role?: RoleDto;
  onClose: () => void;
};

// Sheet tạo/sửa role. Mở bằng cách mount; đóng bằng onClose.
export function RoleEditor({ role, onClose }: Props) {
  const creating = !role;
  const me = useQuery(meQuery).data;
  const catalog = useQuery(permissionsQuery);
  const orgUnits = useQuery({ ...orgUnitsQuery, enabled: creating });
  const create = useCreateRole();
  const update = useUpdateRole(role?.id ?? "");

  const readOnly = !!role && !role._actions.includes("update");
  const rank = actorRank(me);
  const canTenantOwner = me?.effectivePermissions.find((p) => p.permission === "role.manage")?.scopes.some((s) => s.type === "TENANT") ?? false;
  const companies = useMemo(() => (orgUnits.data ?? []).filter((u) => u.type === "COMPANY" && u.status === "ACTIVE"), [orgUnits.data]);

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(role?.permissions ?? []));
  const [confirm, setConfirm] = useState<FormValues | null>(null);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      ownerKind: role ? (role.ownerKind === "COMPANY" ? "COMPANY" : "TENANT") : "COMPANY",
      ownerCompanyId: role?.ownerCompany?.id ?? "",
      keySuffix: "",
      name: role?.name ?? "",
      description: role?.description ?? "",
      level: role?.level ?? 5,
    },
  });
  const ownerKind = watch("ownerKind");

  // Tạo mới: mặc định TENANT nếu actor có role.manage ở phạm vi tenant, và chọn sẵn công ty nếu chỉ có một.
  useEffect(() => {
    if (creating && me && canTenantOwner) setValue("ownerKind", "TENANT");
  }, [creating, me, canTenantOwner, setValue]);
  useEffect(() => {
    if (creating && companies.length === 1) setValue("ownerCompanyId", companies[0]!.id);
  }, [creating, companies, setValue]);

  const effectiveOwner = role ? role.ownerKind : ownerKind;
  const canGrant = (permission: string) => !me || actorHasPermissionFor(me, permission, effectiveOwner);
  const levelDisabled = (level: number) => rank !== null && level <= rank;

  const mutation = creating ? create : update;
  const serverError = mutation.isError ? roleErrorText(mutation.error) : null;
  const busy = mutation.isPending;

  const save = (values: FormValues) => {
    setConfirm(null);
    if (creating) {
      create.mutate(
        {
          ownerKind: values.ownerKind,
          ...(values.ownerKind === "COMPANY" ? { ownerCompanyId: values.ownerCompanyId } : {}),
          key: `custom.${values.keySuffix}`,
          name: values.name,
          ...(values.description ? { description: values.description } : {}),
          level: values.level,
          permissions: [...selected],
        },
        { onSuccess: onClose },
      );
      return;
    }
    const info: { name?: string; description?: string | null; level?: number } = {};
    if (values.name !== role.name) info.name = values.name;
    if (values.description !== (role.description ?? "")) info.description = values.description || null;
    if (values.level !== role.level) info.level = values.level;
    const permissions = sameSet(selected, new Set(role.permissions)) ? undefined : [...selected];
    if (Object.keys(info).length === 0 && !permissions) return onClose();
    update.mutate({ info: Object.keys(info).length ? info : undefined, permissions }, { onSuccess: onClose });
  };

  const onValid = (values: FormValues) => {
    if (creating) {
      if (!KEY_SUFFIX.test(values.keySuffix)) {
        return setError("keySuffix", { message: "Chỉ dùng chữ thường, số và gạch dưới; bắt đầu bằng chữ cái" });
      }
      if (values.keySuffix.length > 57) return setError("keySuffix", { message: "Khóa tối đa 64 ký tự" });
      if (values.ownerKind === "COMPANY" && !values.ownerCompanyId) return setError("ownerCompanyId", { message: "Chọn công ty chủ sở hữu" });
    } else {
      // Role đang được dùng: đổi quyền hoặc level ảnh hưởng ngay tới mọi người giữ role.
      const impactful = values.level !== role.level || !sameSet(selected, new Set(role.permissions));
      if (impactful && role.assignmentCount > 0) return setConfirm(values);
    }
    save(values);
  };

  const title = creating ? "Tạo role" : readOnly ? "Chi tiết role" : "Sửa role";

  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent className="sm:w-[40rem]" aria-describedby="role-editor-desc">
        <div className="flex items-start justify-between gap-3 border-b border-border-strong px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
            <SheetDescription id="role-editor-desc" className="mt-1 text-sm text-muted">
              {creating
                ? "Role riêng có khóa dạng custom.<tên>, level từ 2 đến 5."
                : readOnly
                  ? role.ownerKind === "SYSTEM"
                    ? "Role hệ thống chỉ đọc, không sửa được qua giao diện."
                    : "Bạn chỉ xem được role này."
                  : `Khóa ${role.key} không đổi được.`}
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" aria-label="Đóng" className="-mt-1 -mr-2 size-10 min-h-10 px-0" disabled={busy}>
              <X aria-hidden />
            </Button>
          </SheetClose>
        </div>

        <form id="role-form" noValidate onSubmit={handleSubmit(onValid)} className="flex-1 overflow-y-auto px-5 py-5">
          <fieldset disabled={readOnly || busy} className="flex min-w-0 flex-col gap-5">
            {creating ? (
              <div>
                <Label>Chủ sở hữu</Label>
                <Controller
                  control={control}
                  name="ownerKind"
                  render={({ field }) => (
                    <div role="radiogroup" aria-label="Chủ sở hữu" className="grid gap-2 sm:grid-cols-2">
                      {(
                        [
                          { value: "TENANT", hint: "Dùng được ở mọi công ty. Cần quyền quản lý role ở phạm vi toàn tổ chức.", disabled: !canTenantOwner },
                          { value: "COMPANY", hint: "Chỉ dùng trong một công ty và các đơn vị bên dưới.", disabled: false },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={field.value === option.value}
                          disabled={option.disabled}
                          onClick={() => field.onChange(option.value)}
                          className={cn(
                            "cursor-pointer rounded-xl border px-4 py-3 text-left outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50",
                            field.value === option.value ? "border-primary bg-primary-light" : "border-border-strong hover:bg-item-hover",
                          )}
                        >
                          <span className="block text-sm font-medium">{OWNER_KIND_LABEL[option.value]}</span>
                          <span className="mt-0.5 block text-xs text-muted">{option.hint}</span>
                        </button>
                      ))}
                    </div>
                  )}
                />
              </div>
            ) : null}

            {creating && ownerKind === "COMPANY" ? (
              <div>
                <Label htmlFor="role-company">Công ty chủ sở hữu</Label>
                {orgUnits.isPending ? (
                  <Skel className="h-10 w-full" />
                ) : orgUnits.isError ? (
                  <LoadError title="Không tải được danh sách công ty" why="Kiểm tra kết nối rồi thử lại." onRetry={() => orgUnits.refetch()} />
                ) : (
                  <select
                    id="role-company"
                    aria-invalid={!!errors.ownerCompanyId}
                    aria-describedby="role-company-error"
                    className={inputClasses}
                    {...register("ownerCompanyId")}
                  >
                    <option value="">Chọn công ty…</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                )}
                <FieldError id="role-company-error" message={errors.ownerCompanyId?.message} />
              </div>
            ) : null}

            {creating ? (
              <div>
                <Label htmlFor="role-key">Khóa</Label>
                <div className="flex">
                  <span className="inline-flex h-11 shrink-0 items-center rounded-l-xl border border-r-0 border-border-strong bg-item-hover px-3 font-mono text-sm text-muted md:h-10">
                    custom.
                  </span>
                  <Input
                    id="role-key"
                    autoFocus
                    maxLength={57}
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="finance_reviewer"
                    aria-invalid={!!errors.keySuffix}
                    aria-describedby="role-key-hint role-key-error"
                    className="rounded-l-none font-mono"
                    {...register("keySuffix")}
                  />
                </div>
                <p id="role-key-hint" className="mt-1.5 text-xs text-muted">
                  Chữ thường, số và gạch dưới. Không đổi được sau khi tạo.
                </p>
                <FieldError id="role-key-error" message={errors.keySuffix?.message} />
              </div>
            ) : null}

            <div>
              <Label htmlFor="role-name">Tên</Label>
              <Input id="role-name" maxLength={200} autoFocus={!creating} aria-invalid={!!errors.name} aria-describedby="role-name-error" {...register("name")} />
              <FieldError id="role-name-error" message={errors.name?.message} />
            </div>

            <div>
              <Label htmlFor="role-desc">Mô tả (không bắt buộc)</Label>
              <Textarea id="role-desc" rows={3} maxLength={500} aria-invalid={!!errors.description} aria-describedby="role-desc-error" {...register("description")} />
              <FieldError id="role-desc-error" message={errors.description?.message} />
            </div>

            <div>
              <Label>Level</Label>
              <Controller
                control={control}
                name="level"
                render={({ field }) => (
                  <div role="radiogroup" aria-label="Level" aria-describedby="role-level-hint" className="grid grid-cols-4 gap-2">
                    {LEVELS.map((level) => {
                      const disabled = levelDisabled(level) && level !== role?.level;
                      return (
                        <button
                          key={level}
                          type="button"
                          role="radio"
                          aria-checked={field.value === level}
                          disabled={disabled}
                          title={disabled ? "Level phải lớn hơn level cao nhất bạn đang có" : undefined}
                          onClick={() => field.onChange(level)}
                          className={cn(
                            "min-h-10 cursor-pointer rounded-xl border px-3 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40",
                            field.value === level ? "border-primary bg-primary-light" : "border-border-strong hover:bg-item-hover",
                          )}
                        >
                          {level}
                        </button>
                      );
                    })}
                  </div>
                )}
              />
              <p id="role-level-hint" className="mt-1.5 text-xs text-muted">
                Số nhỏ là cấp cao hơn. Bạn chỉ tạo hoặc sửa được role có level lớn hơn level cao nhất của chính bạn
                {rank !== null ? ` (hiện là ${rank})` : ""}.
              </p>
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">Quyền</span>
                <span className="text-xs text-muted tabular-nums">Đã chọn {selected.size}</span>
              </div>
              {!readOnly ? (
                <p className="mb-2 text-xs text-muted">Quyền chưa có ở phạm vi của role bị khóa: bạn không thêm được quyền mà chính bạn không có.</p>
              ) : null}
              <div className="rounded-xl border border-border-strong p-1">
                {catalog.isPending ? (
                  <div className="flex flex-col gap-4 p-3" aria-busy>
                    {[0, 1, 2, 3].map((i) => (
                      <Skel key={i} className="h-4 w-2/3" />
                    ))}
                  </div>
                ) : catalog.isError ? (
                  <LoadError title="Không tải được danh mục quyền" why="Kiểm tra kết nối rồi thử lại." onRetry={() => catalog.refetch()} />
                ) : (
                  <PermissionChecklist
                    catalog={catalog.data}
                    selected={selected}
                    canGrant={canGrant}
                    readOnly={readOnly}
                    onToggle={(permission, checked) => {
                                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(permission);
                        else next.delete(permission);
                        return next;
                      });
                    }}
                  />
                )}
              </div>
            </div>
          </fieldset>

          {role && role.assignmentCount > 0 && !readOnly ? (
            <p className="mt-5 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Role này đang được dùng ở {role.assignmentCount} assignment. Đổi quyền hoặc level có hiệu lực ngay với những người đang giữ role.
              </span>
            </p>
          ) : null}

          {serverError ? (
            <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {serverError}
            </p>
          ) : null}
        </form>

        <div className="flex flex-col-reverse gap-2 border-t border-border-strong px-5 py-4 sm:flex-row sm:justify-end">
          <Button onClick={onClose} disabled={busy}>
            {readOnly ? "Đóng" : "Huỷ"}
          </Button>
          {!readOnly ? (
            <Button type="submit" form="role-form" variant="primary" disabled={busy || catalog.isPending} aria-busy={busy || undefined}>
              {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              {creating ? "Tạo role" : "Lưu thay đổi"}
            </Button>
          ) : null}
        </div>

        <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogTitle className="text-base font-semibold">Ảnh hưởng {role?.assignmentCount} assignment</AlertDialogTitle>
            <AlertDialogDescription className="mt-2 text-sm text-muted">
              Role "{role?.name}" đang được {role?.assignmentCount} assignment sử dụng. Thay đổi quyền hoặc level sẽ có hiệu lực ngay với tất cả người đang giữ role này.
            </AlertDialogDescription>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialogCancel asChild>
                <Button>Xem lại</Button>
              </AlertDialogCancel>
              <Button variant="primary" onClick={() => confirm && save(confirm)}>
                Vẫn lưu
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

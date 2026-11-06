import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { LoadError } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { isApiError } from "@/lib/api";
import { orgUnitsQuery } from "@/lib/queries";
import { useCreateUser } from "@/lib/queries-users";
import { activeUnits, departmentsOf, ErrorNote, FieldError, friendlyError, Label, PanelSheet, SubmitLabel, UnitPicker } from "./shared";

const schema = z.object({
  email: z.string().trim().min(1, "Nhập email").max(254, "Email tối đa 254 ký tự").email("Email chưa đúng định dạng"),
  displayName: z.string().trim().min(1, "Nhập tên hiển thị").max(200, "Tên tối đa 200 ký tự"),
  companyId: z.string().min(1, "Chọn công ty"),
  departmentId: z.string().nullable(),
});
type Values = z.infer<typeof schema>;

const EMPTY: Values = { email: "", displayName: "", companyId: "", departmentId: null };

export function CreateUserSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const units = useQuery({ ...orgUnitsQuery, enabled: open });
  const create = useCreateUser();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      reset(EMPTY);
      create.reset();
      setServerError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const all = useMemo(() => activeUnits(units.data), [units.data]);
  const companies = useMemo(() => all.filter((u) => u.type === "COMPANY"), [all]);
  const companyId = watch("companyId");
  const departments = useMemo(() => departmentsOf(all, companyId || null), [all, companyId]);

  const submit = handleSubmit((values) => {
    setServerError(null);
    create.mutate(
      { email: values.email, displayName: values.displayName, companyId: values.companyId, departmentId: values.departmentId },
      {
        onSuccess: (user) => {
          onOpenChange(false);
          void navigate({ to: "/nguoi-dung/$id", params: { id: user.id }, search: {} });
        },
        onError: (error) => {
          // 403 ở đây là ràng buộc tên miền: chỉ nói điều người dùng sửa được, không lộ mã ràng buộc.
          if (isApiError(error, "forbidden")) setError("email", { message: "Email không thuộc tên miền của công ty này" });
          else if (isApiError(error, "conflict")) setError("email", { message: "Email này đã được dùng cho một người dùng khác" });
          else setServerError(friendlyError(error));
        },
      },
    );
  });

  return (
    <Sheet open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <PanelSheet
        title="Tạo người dùng"
        description="Người dùng mới thuộc một công ty, chưa có role nào. Gán role ở bước sau."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => onOpenChange(false)} disabled={create.isPending}>
              Huỷ
            </Button>
            <Button type="submit" form="create-user-form" variant="primary" disabled={create.isPending || units.isPending} aria-busy={create.isPending || undefined}>
              <SubmitLabel pending={create.isPending}>Tạo người dùng</SubmitLabel>
            </Button>
          </div>
        }
      >
        {units.isError ? (
          <LoadError title="Không tải được danh sách đơn vị" why="Kiểm tra kết nối rồi thử lại." onRetry={() => units.refetch()} />
        ) : (
          <form id="create-user-form" noValidate onSubmit={submit} className="flex flex-col gap-5">
            <div>
              <Label htmlFor="cu-email">Email</Label>
              <Input
                id="cu-email"
                type="email"
                autoComplete="off"
                autoFocus
                maxLength={254}
                aria-invalid={!!errors.email}
                aria-describedby="cu-email-error cu-email-hint"
                {...register("email")}
              />
              <FieldError id="cu-email-error" message={errors.email?.message} />
              <p id="cu-email-hint" className="mt-1.5 text-xs text-muted">
                Tên miền email phải là tên miền đã được duyệt của công ty (hoặc công ty cấp trên).
              </p>
            </div>
            <div>
              <Label htmlFor="cu-name">Tên hiển thị</Label>
              <Input id="cu-name" autoComplete="off" maxLength={200} aria-invalid={!!errors.displayName} aria-describedby="cu-name-error" {...register("displayName")} />
              <FieldError id="cu-name-error" message={errors.displayName?.message} />
            </div>
            <div>
              <Label id="cu-company-label">Công ty</Label>
              {units.isPending ? (
                <p aria-busy className="rounded-xl border border-border-strong px-4 py-3 text-sm text-muted">
                  Đang tải…
                </p>
              ) : (
                <Controller
                  control={control}
                  name="companyId"
                  render={({ field }) => (
                    <UnitPicker
                      label="Công ty"
                      units={companies}
                      value={field.value || null}
                      onChange={(id) => {
                        field.onChange(id ?? "");
                        setValue("departmentId", null);
                      }}
                      empty="Bạn chưa có công ty nào để tạo người dùng."
                    />
                  )}
                />
              )}
              <FieldError id="cu-company-error" message={errors.companyId?.message} />
            </div>
            {companyId ? (
              <div>
                <Label id="cu-dept-label">Phòng ban (không bắt buộc)</Label>
                <Controller
                  control={control}
                  name="departmentId"
                  render={({ field }) => (
                    <UnitPicker label="Phòng ban" units={departments} value={field.value} onChange={field.onChange} noneLabel="Chưa chọn phòng ban" />
                  )}
                />
              </div>
            ) : null}
            <ErrorNote message={serverError} />
          </form>
        )}
      </PanelSheet>
    </Sheet>
  );
}

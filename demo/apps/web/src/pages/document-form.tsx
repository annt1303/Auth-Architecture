import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import type { OrgUnitDto } from "@authz-demo/authz-types";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Card, LoadError, UnitLabel } from "@/components/common";
import { ErrorScreen } from "@/components/error-screen";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, isApiError } from "@/lib/api";
import { destinationsQuery, useCreateDocument, type DocumentInput } from "@/lib/queries";
import { cn } from "@/lib/utils";

const schema = z.object({
  title: z.string().trim().min(1, "Nhập tiêu đề").max(200, "Tiêu đề tối đa 200 ký tự"),
  body: z.string().max(20_000, "Nội dung tối đa 20.000 ký tự"),
  status: z.enum(["DRAFT", "PUBLISHED"]),
  orgUnitId: z.string(),
});
export type FormValues = z.infer<typeof schema>;

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

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Nháp", hint: "Chỉ những người có quyền xem tài liệu của đơn vị mới thấy." },
  { value: "PUBLISHED", label: "Đã phát hành", hint: "Đánh dấu tài liệu là bản chính thức." },
] as const;

type Node = { unit: OrgUnitDto; children: Node[] };

// Đơn vị có cha nằm ngoài danh sách (cha không được tạo ở đó) trở thành gốc.
function buildTree(units: OrgUnitDto[]): Node[] {
  const nodes = new Map(units.map((unit) => [unit.id, { unit, children: [] as Node[] }]));
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    const parent = node.unit.parentId ? nodes.get(node.unit.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

function TreeOptions({ nodes, depth, value, onChange }: { nodes: Node[]; depth: number; value: string; onChange: (id: string) => void }) {
  return nodes.map(({ unit, children }) => (
    <div key={unit.id}>
      <button
        type="button"
        role="radio"
        aria-checked={value === unit.id}
        onClick={() => onChange(unit.id)}
        style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
        className={cn(
          "flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg pr-3 text-left text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-focus",
          value === unit.id ? "bg-secondary font-medium" : "hover:bg-item-hover",
        )}
      >
        <span
          aria-hidden
          className={cn("size-4 shrink-0 rounded-full border-2", value === unit.id ? "border-primary bg-primary ring-2 ring-white ring-inset" : "border-border-strong")}
        />
        <UnitLabel name={unit.name} type={unit.type} />
      </button>
      <TreeOptions nodes={children} depth={depth + 1} value={value} onChange={onChange} />
    </div>
  ));
}

type DocumentFormProps = {
  defaults: FormValues;
  destinations?: OrgUnitDto[]; // chỉ khi tạo mới; sửa thì không đổi đơn vị
  submitLabel: string;
  submitting: boolean;
  serverError: string | null;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
};

export function DocumentForm({ defaults, destinations, submitLabel, submitting, serverError, onSubmit, onCancel }: DocumentFormProps) {
  const tree = useMemo(() => buildTree(destinations ?? []), [destinations]);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) => {
        if (destinations && !values.orgUnitId) return setError("orgUnitId", { message: "Chọn đơn vị chứa tài liệu" });
        onSubmit(values);
      })}
      className="flex flex-col gap-5"
    >
      <div>
        <Label htmlFor="title">Tiêu đề</Label>
        <Input id="title" autoFocus maxLength={200} aria-invalid={!!errors.title} aria-describedby="title-error" {...register("title")} />
        <FieldError id="title-error" message={errors.title?.message} />
      </div>

      {destinations ? (
        <div>
          <Label>Đơn vị chứa tài liệu</Label>
          <Controller
            control={control}
            name="orgUnitId"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Đơn vị chứa tài liệu" className="rounded-xl border border-border-strong p-1">
                <TreeOptions nodes={tree} depth={0} value={field.value} onChange={field.onChange} />
              </div>
            )}
          />
          <FieldError id="unit-error" message={errors.orgUnitId?.message} />
          <p className="mt-1.5 text-xs text-muted">Chỉ hiện các đơn vị bạn được phép tạo tài liệu. Không đổi được sau khi tạo.</p>
        </div>
      ) : null}

      <div>
        <Label>Trạng thái</Label>
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <div role="radiogroup" aria-label="Trạng thái" className="grid gap-2 sm:grid-cols-2">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={field.value === option.value}
                  onClick={() => field.onChange(option.value)}
                  className={cn(
                    "cursor-pointer rounded-xl border px-4 py-3 text-left outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-focus",
                    field.value === option.value ? "border-primary bg-primary-light" : "border-border-strong hover:bg-item-hover",
                  )}
                >
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{option.hint}</span>
                </button>
              ))}
            </div>
          )}
        />
      </div>

      <div>
        <Label htmlFor="body">Nội dung</Label>
        <Textarea id="body" rows={8} aria-invalid={!!errors.body} aria-describedby="body-error" {...register("body")} />
        <FieldError id="body-error" message={errors.body?.message} />
      </div>

      {serverError ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {serverError}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={onCancel} disabled={submitting}>
          Huỷ
        </Button>
        <Button type="submit" variant="primary" disabled={submitting} aria-busy={submitting || undefined}>
          {submitting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

// Thông báo lỗi cho người dùng, không lộ mã nội bộ (403 vs 404 theo khả năng nhìn thấy).
export function mutationErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "invalid_request") return error.details?.map((d) => d.issue).join(". ") || "Dữ liệu chưa hợp lệ. Kiểm tra lại các trường.";
    if (error.code === "forbidden" || error.code === "not_found") return "Bạn không còn quyền thực hiện thao tác này.";
    if (error.code === "authorization_unavailable" || error.code === "network") return "Chưa kiểm tra được quyền hoặc mất kết nối. Thử lại sau ít phút.";
  }
  return "Có lỗi ở phía hệ thống. Thử lại sau ít phút.";
}

export function DocumentFormPage() {
  const navigate = useNavigate();
  const destinations = useQuery({ ...destinationsQuery, retry: false });
  const create = useCreateDocument();

  if (isApiError(destinations.error, "forbidden")) {
    return (
      <ErrorScreen
        code="403"
        title="Bạn chưa được tạo tài liệu"
        description="Vai trò hiện tại của bạn không cho phép tạo tài liệu ở đơn vị nào."
        primary={
          <Link to="/tai-lieu" search={{}} className={buttonClasses("primary")}>
            Về danh sách tài liệu
          </Link>
        }
        footCode="403 · forbidden"
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card className="p-4 sm:p-6">
        <h2 className="mb-5 text-base font-semibold">Tạo tài liệu</h2>
        {destinations.isPending ? (
          <p className="py-10 text-center text-sm text-muted" aria-busy>
            Đang tải…
          </p>
        ) : destinations.isError ? (
          <LoadError title="Không tải được danh sách đơn vị" why="Kiểm tra kết nối rồi thử lại." onRetry={() => destinations.refetch()} />
        ) : (
          <DocumentForm
            defaults={{ title: "", body: "", status: "DRAFT", orgUnitId: destinations.data.length === 1 ? destinations.data[0]!.id : "" }}
            destinations={destinations.data}
            submitLabel="Tạo tài liệu"
            submitting={create.isPending}
            serverError={create.isError ? mutationErrorText(create.error) : null}
            onSubmit={(values: DocumentInput) =>
              create.mutate(values, { onSuccess: (document) => navigate({ to: "/tai-lieu/$id", params: { id: document.id } }) })
            }
            onCancel={() => navigate({ to: "/tai-lieu", search: {} })}
          />
        )}
      </Card>
    </div>
  );
}

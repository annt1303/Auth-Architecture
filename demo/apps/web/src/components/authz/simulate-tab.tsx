import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DocumentDto, OrgUnitTreeDto, RoleDto, UserDto } from "@authz-demo/authz-types";
import { Loader2, Play, Sparkles } from "lucide-react";
import { Card, CardHead, Skel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api";
import { permissionLabel } from "@/lib/format";
import { simDocumentsQuery, simPermissionsQuery, simRolesQuery, simUnitsQuery, simUsersQuery, useSimulate, userAssignmentsQuery } from "@/lib/queries-authz";
import { SelectField, type OptionGroup } from "./fields";
import { resourceTypeLabel } from "./labels";
import { buildTarget, EMPTY_TARGET, TargetFields, targetKindFor, UserSelect, type TargetState } from "./target";
import { TraceView } from "./trace-view";

type Data = { users: UserDto[]; units: OrgUnitTreeDto[]; docs: DocumentDto[]; roles: RoleDto[] };
type Preset = { principalId: string; action: string; target: Partial<TargetState>; autoRevokeRole?: string };
type Scenario = { id: string; label: string; expect: string; build: (d: Data) => Preset | null };

const byEmail = (d: Data, email: string) => d.users.find((u) => u.email === email)?.id;
const byCode = (d: Data, code: string) => d.units.find((u) => u.code === code)?.id;
const byRole = (d: Data, key: string) => d.roles.find((r) => r.key === key)?.id;
const byTitle = (d: Data, part: string) => d.docs.find((x) => x.title.includes(part))?.id;

// Kịch bản SPEC §10.1 và §15, điền sẵn form. Thiếu dữ liệu (đã bị đổi/xoá) thì nút bị tắt.
const SCENARIOS: Scenario[] = [
  {
    id: "dung-doc",
    label: "Dũng mở Quy chế tài chính",
    expect: "Dũng chỉ thấy tài liệu của team mình: nhận 404, không lộ là tài liệu có tồn tại.",
    build: (d) => {
      const principalId = byEmail(d, "dung.ap@alpha.test");
      const targetId = byTitle(d, "Quy chế tài chính");
      return principalId && targetId ? { principalId, action: "document.read", target: { targetId } } : null;
    },
  },
  {
    id: "binh-assign-ca",
    label: "Bình gán company_admin cho Chi",
    expect: "Trượt RANK: company_admin cùng cấp với Bình.",
    build: (d) => {
      const principalId = byEmail(d, "binh.alpha@alpha.test");
      const targetUserId = byEmail(d, "chi.fin@alpha.test");
      const roleId = byRole(d, "company_admin");
      const scopeId = byCode(d, "ALPHA_FIN");
      return principalId && targetUserId && roleId && scopeId
        ? { principalId, action: "user_role.assign", target: { targetUserId, roleId, scopeType: "DEPARTMENT", scopeId } }
        : null;
    },
  },
  {
    id: "binh-assign-dm",
    label: "Bình gán department_manager cho Chi",
    expect: "Được: cấp 4 thấp hơn Bình (cấp 3), scope ALPHA_FIN nằm trong Alpha.",
    build: (d) => {
      const principalId = byEmail(d, "binh.alpha@alpha.test");
      const targetUserId = byEmail(d, "chi.fin@alpha.test");
      const roleId = byRole(d, "department_manager");
      const scopeId = byCode(d, "ALPHA_FIN");
      return principalId && targetUserId && roleId && scopeId
        ? { principalId, action: "user_role.assign", target: { targetUserId, roleId, scopeType: "DEPARTMENT", scopeId } }
        : null;
    },
  },
  {
    id: "binh-assign-beta",
    label: "Bình gán member tại Beta",
    expect: "Bình không có grant bao phủ Beta: OUT_OF_SCOPE.",
    build: (d) => {
      const principalId = byEmail(d, "binh.alpha@alpha.test");
      const targetUserId = byEmail(d, "chi.fin@alpha.test");
      const roleId = byRole(d, "member");
      const scopeId = byCode(d, "BETA");
      return principalId && targetUserId && roleId && scopeId
        ? { principalId, action: "user_role.assign", target: { targetUserId, roleId, scopeType: "COMPANY", scopeId } }
        : null;
    },
  },
  {
    id: "binh-revoke-self",
    label: "Bình thu hồi company_admin của chính mình",
    expect: "Trượt NOT_SELF: phải là người cấp cao hơn thực hiện.",
    build: (d) => {
      const principalId = byEmail(d, "binh.alpha@alpha.test");
      return principalId ? { principalId, action: "user_role.revoke", target: { targetUserId: principalId }, autoRevokeRole: "company_admin" } : null;
    },
  },
  {
    id: "binh-suspend-hoa",
    label: "Bình tạm ngưng Hoa",
    expect: "Quyền quản lý thành viên chỉ cấp tenant, Bình không có grant: NO_GRANT.",
    build: (d) => {
      const principalId = byEmail(d, "binh.alpha@alpha.test");
      const targetId = byEmail(d, "hoa.log@alpha-log.test");
      return principalId && targetId ? { principalId, action: "tenant_membership.manage", target: { targetId } } : null;
    },
  },
  {
    id: "an-suspend-hoa",
    label: "An tạm ngưng Hoa",
    expect: "An là tenant admin (cấp 2), Hoa chỉ là member: được.",
    build: (d) => {
      const principalId = byEmail(d, "an.tenant@holding.test");
      const targetId = byEmail(d, "hoa.log@alpha-log.test");
      return principalId && targetId ? { principalId, action: "tenant_membership.manage", target: { targetId } } : null;
    },
  },
  {
    id: "binh-create-ok",
    label: "Bình tạo new.hire@alpha.test",
    expect: "Được: tên miền alpha.test là tên miền ACTIVE của Alpha.",
    build: (d) => {
      const principalId = byEmail(d, "binh.alpha@alpha.test");
      const targetId = byCode(d, "ALPHA");
      return principalId && targetId ? { principalId, action: "user.create", target: { targetId, email: "new.hire@alpha.test" } } : null;
    },
  },
  {
    id: "binh-create-bad",
    label: "Bình tạo user email gmail.com",
    expect: "Trượt EMAIL_DOMAIN: gmail.com không phải tên miền của công ty.",
    build: (d) => {
      const principalId = byEmail(d, "binh.alpha@alpha.test");
      const targetId = byCode(d, "ALPHA");
      return principalId && targetId ? { principalId, action: "user.create", target: { targetId, email: "new.hire@gmail.com" } } : null;
    },
  },
];

type Form = { principalId: string; action: string; target: TargetState };
const EMPTY_FORM: Form = { principalId: "", action: "", target: EMPTY_TARGET };

function Placeholder() {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <Sparkles className="size-8 text-muted" aria-hidden />
      <p className="text-sm font-medium">Chọn người dùng và quyền rồi bấm “Chạy mô phỏng”</p>
      <p className="max-w-sm text-sm text-muted">Hoặc bấm một kịch bản mẫu ở trên để điền sẵn. Các bước đánh giá, grant và ràng buộc sẽ hiện ở đây.</p>
    </Card>
  );
}

export function SimulateTab() {
  const users = useQuery(simUsersQuery);
  const units = useQuery(simUnitsQuery);
  const docs = useQuery(simDocumentsQuery);
  const roles = useQuery(simRolesQuery);
  const permissions = useQuery(simPermissionsQuery);
  const simulate = useSimulate();
  const resultRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [autoRevokeRole, setAutoRevokeRole] = useState<string | null>(null);
  const [lastPrincipal, setLastPrincipal] = useState("");

  const data: Data | null = users.data && units.data && docs.data && roles.data ? { users: users.data, units: units.data, docs: docs.data, roles: roles.data } : null;
  const scenarios = useMemo(() => SCENARIOS.map((s) => ({ ...s, preset: data ? s.build(data) : null })), [data]);

  const permission = permissions.data?.find((p) => p.key === form.action);
  const kind = targetKindFor(form.action);
  const built = form.action ? buildTarget(kind, form.target, permission?.resourceType ?? "", false) : null;
  const ready = !!form.principalId && !!form.action && !!built;

  // Kịch bản "thu hồi": chọn sẵn assignment khi danh sách của người đó về tới.
  const assignments = useQuery(userAssignmentsQuery(kind === "assignment" ? form.target.targetUserId : ""));
  useEffect(() => {
    if (!autoRevokeRole || !assignments.data) return;
    const match = assignments.data.find((a) => a.role.key === autoRevokeRole && a.status === "ACTIVE");
    if (match) setForm((f) => ({ ...f, target: { ...f.target, assignmentId: match.id } }));
    setAutoRevokeRole(null);
  }, [autoRevokeRole, assignments.data]);

  const groups: OptionGroup[] = useMemo(() => {
    const map = new Map<string, OptionGroup>();
    for (const p of permissions.data ?? []) {
      const g = map.get(p.resourceType) ?? { label: resourceTypeLabel(p.resourceType), options: [] };
      g.options.push({ value: p.key, label: `${permissionLabel(p.key)} · ${p.key}` });
      map.set(p.resourceType, g);
    }
    return [...map.values()];
  }, [permissions.data]);

  const apply = (preset: Preset) => {
    setForm({ principalId: preset.principalId, action: preset.action, target: { ...EMPTY_TARGET, ...preset.target } });
    setAutoRevokeRole(preset.autoRevokeRole ?? null);
    simulate.reset();
  };

  const run = () => {
    if (!built) return;
    setLastPrincipal(form.principalId);
    simulate.mutate(
      { principalId: form.principalId, action: form.action, resource: built.resource, ...(built.params ? { params: built.params } : {}) },
      { onSuccess: () => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }) },
    );
  };

  const principalName = users.data?.find((u) => u.id === lastPrincipal)?.displayName ?? "Người dùng";
  const error = simulate.error;
  const errorText = !error
    ? null
    : isApiError(error, "not_found")
      ? "Không tìm thấy người dùng hoặc tài nguyên đã chọn trong tổ chức (bước B4). Thử chọn lại."
      : isApiError(error, "invalid_request")
        ? "Yêu cầu chưa hợp lệ: kiểm tra các trường đã chọn."
        : isApiError(error, "forbidden") || isApiError(error, "tenant_access_denied")
          ? "Bạn không có quyền chạy mô phỏng."
          : "Không chạy được mô phỏng. Kiểm tra kết nối rồi thử lại.";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHead title="Kịch bản mẫu" meta="Điền sẵn form, bạn vẫn chỉnh được" />
        <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-5">
          {scenarios.map((s) => (
            <Button
              key={s.id}
              disabled={!s.preset}
              onClick={() => s.preset && apply(s.preset)}
              title={s.expect}
              aria-describedby={`scn-${s.id}`}
              className="min-h-9 px-3 py-1.5"
            >
              {s.label}
              <span id={`scn-${s.id}`} className="sr-only">
                {s.expect}
              </span>
            </Button>
          ))}
          {!data && !users.isError ? <Skel className="my-3 w-40" /> : null}
        </div>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card>
          <CardHead title="Câu hỏi cần mô phỏng" />
          <form
            className="flex flex-col gap-4 px-4 pb-4 sm:px-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) run();
            }}
          >
            <UserSelect label="Người dùng (đóng vai)" value={form.principalId} onChange={(principalId) => setForm({ ...form, principalId })} />
            <SelectField
              label="Hành động (action)"
              value={form.action}
              onChange={(action) => setForm({ ...form, action, target: EMPTY_TARGET })}
              groups={groups}
              loading={permissions.isPending}
              placeholder={permissions.isError ? "Không tải được danh mục quyền" : "Chọn quyền"}
              hint={permission ? permission.description : undefined}
            />
            {form.action ? <TargetFields kind={kind} value={form.target} onChange={(target) => setForm({ ...form, target })} /> : null}
            <Button type="submit" variant="primary" disabled={!ready || simulate.isPending} aria-busy={simulate.isPending || undefined}>
              {simulate.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Play aria-hidden />}
              Chạy mô phỏng
            </Button>
          </form>
        </Card>

        <div ref={resultRef} className="min-w-0 scroll-mt-4">
          {simulate.isPending ? (
            <Card aria-busy aria-label="Đang chạy mô phỏng" className="flex flex-col gap-3 p-5">
              <Skel className="w-32" />
              <Skel className="w-full" />
              <Skel className="w-2/3" />
            </Card>
          ) : errorText ? (
            <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorText}
            </p>
          ) : simulate.data ? (
            <TraceView trace={simulate.data} principalName={principalName} />
          ) : (
            <Placeholder />
          )}
        </div>
      </div>
    </div>
  );
}

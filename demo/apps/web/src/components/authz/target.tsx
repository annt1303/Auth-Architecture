import { useId, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OrgUnitTreeDto, ResourceRef, ScopeType, SimulateRequest } from "@authz-demo/authz-types";
import { Input } from "@/components/ui/input";
import { ORG_TYPE_LABEL, roleName, SCOPE_TYPE_LABEL } from "@/lib/format";
import { simDocumentsQuery, simRolesQuery, simUnitsQuery, simUsersQuery, userAssignmentsQuery } from "@/lib/queries-authz";
import { Field, SelectField, type Option } from "./fields";

// Tài nguyên cần chọn phụ thuộc action (SPEC §10, §12). Mỗi "kind" là một cách chọn đích.
export type TargetKind = "document" | "org_unit" | "org_unit_dest" | "user" | "role" | "assignment" | "assign" | "user_create" | "tenant";

export function targetKindFor(action: string): TargetKind {
  switch (action) {
    case "user.create":
      return "user_create";
    case "user_role.assign":
      return "assign";
    case "user_role.revoke":
      return "assignment";
    case "tenant_membership.manage":
    case "user_role.read":
    case "user.read":
      return "user";
    case "user_affiliation.manage":
    case "company_domain.manage":
    case "company_domain.approve":
      return "org_unit";
    case "role.manage":
    case "role.read":
      return "role";
  }
  if (action.endsWith(".create")) return "org_unit_dest";
  const type = action.split(".")[0];
  if (type === "document") return "document";
  if (type === "org_unit") return "org_unit";
  return "tenant";
}

export type TargetState = {
  targetId: string;
  targetUserId: string;
  roleId: string;
  scopeType: ScopeType | "";
  scopeId: string;
  email: string;
  assignmentId: string;
};

export const EMPTY_TARGET: TargetState = { targetId: "", targetUserId: "", roleId: "", scopeType: "", scopeId: "", email: "", assignmentId: "" };

export const SCOPE_TYPES: ScopeType[] = ["TENANT", "COMPANY", "DEPARTMENT", "TEAM", "RESOURCE", "SELF"];

// null = còn thiếu thông tin. forWhoCan: endpoint "ai có quyền" chỉ nhận action, loại và id tài nguyên.
export function buildTarget(
  kind: TargetKind,
  t: TargetState,
  resourceType: string,
  forWhoCan = false,
): { resource: ResourceRef; params?: SimulateRequest["params"] } | null {
  switch (kind) {
    case "document":
      return t.targetId ? { resource: { type: "document", id: t.targetId } } : null;
    case "org_unit":
    case "org_unit_dest":
      return t.targetId ? { resource: { type: "org_unit", id: t.targetId } } : null;
    case "user":
      return t.targetId ? { resource: { type: "user", id: t.targetId } } : null;
    case "role":
      return t.targetId ? { resource: { type: "role", id: t.targetId } } : null;
    case "assignment":
      return t.assignmentId ? { resource: { type: "assignment", id: t.assignmentId } } : null;
    case "tenant":
      return { resource: { type: resourceType || "tenant" } };
    case "user_create": {
      if (!t.targetId) return null;
      if (forWhoCan) return { resource: { type: "org_unit", id: t.targetId } };
      const email = t.email.trim();
      return email ? { resource: { type: "org_unit", id: t.targetId }, params: { companyId: t.targetId, email } } : null;
    }
    case "assign": {
      if (forWhoCan || !t.targetUserId || !t.roleId || !t.scopeType) return null;
      const needsId = t.scopeType !== "TENANT" && t.scopeType !== "SELF";
      if (needsId && !t.scopeId) return null;
      return {
        resource: { type: "user", id: t.targetUserId },
        params: { targetUserId: t.targetUserId, roleId: t.roleId, scope: { type: t.scopeType, ...(needsId ? { id: t.scopeId } : {}) } },
      };
    }
  }
}

// Danh sách đơn vị theo thứ tự cây, thụt lề bằng khoảng trắng không ngắt.
function unitOptions(units: OrgUnitTreeDto[], only?: OrgUnitTreeDto["type"]): Option[] {
  const byParent = new Map<string | null, OrgUnitTreeDto[]>();
  const ids = new Set(units.map((u) => u.id));
  for (const u of units) {
    const key = u.parentId && ids.has(u.parentId) ? u.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), u]);
  }
  const out: Option[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const u of byParent.get(parent) ?? []) {
      if (!only || u.type === only) out.push({ value: u.id, label: `${"  ".repeat(only ? 0 : depth)}${u.name} (${ORG_TYPE_LABEL[u.type]})` });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function UserSelect({ label, value, onChange, hint }: { label: string; value: string; onChange: (id: string) => void; hint?: string }) {
  const users = useQuery(simUsersQuery);
  const options = useMemo(() => (users.data ?? []).map((u) => ({ value: u.id, label: `${u.displayName} (${u.email})` })), [users.data]);
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      loading={users.isPending}
      placeholder={users.isError ? "Không tải được danh sách" : "Chọn người dùng"}
      hint={hint}
    />
  );
}

export function UnitSelect({ label, value, onChange, only, hint }: { label: string; value: string; onChange: (id: string) => void; only?: OrgUnitTreeDto["type"]; hint?: string }) {
  const units = useQuery(simUnitsQuery);
  const options = useMemo(() => unitOptions(units.data ?? [], only), [units.data, only]);
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      loading={units.isPending}
      placeholder={units.isError ? "Không tải được danh sách" : "Chọn đơn vị"}
      hint={hint}
    />
  );
}

function DocumentSelect({ label, value, onChange }: { label: string; value: string; onChange: (id: string) => void }) {
  const documents = useQuery(simDocumentsQuery);
  const options = useMemo(() => (documents.data ?? []).map((d) => ({ value: d.id, label: `${d.title} · ${d.orgUnit.name}` })), [documents.data]);
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      loading={documents.isPending}
      placeholder={documents.isError ? "Không tải được danh sách" : "Chọn tài liệu"}
    />
  );
}

export function RoleSelect({ label, value, onChange, hint }: { label: string; value: string; onChange: (id: string) => void; hint?: string }) {
  const roles = useQuery(simRolesQuery);
  const options = useMemo(
    () =>
      (roles.data ?? []).map((r) => ({
        value: r.id,
        label: `${roleName(r)} · cấp ${r.level}${r.ownerKind === "SYSTEM" ? "" : r.ownerKind === "COMPANY" ? " · vai trò công ty" : " · vai trò tổ chức"}${r.status === "ARCHIVED" ? " · đã lưu trữ" : ""}`,
      })),
    [roles.data],
  );
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      loading={roles.isPending}
      placeholder={roles.isError ? "Không tải được danh sách" : "Chọn vai trò"}
      hint={hint}
    />
  );
}

function AssignmentSelect({ userId, value, onChange }: { userId: string; value: string; onChange: (id: string) => void }) {
  const assignments = useQuery(userAssignmentsQuery(userId));
  const options = useMemo(
    () =>
      (assignments.data ?? []).map((a) => ({
        value: a.id,
        label: `${roleName(a.role)} · ${a.scope.label}${a.status === "REVOKED" ? " · đã thu hồi" : a.effective ? "" : " · chưa hiệu lực"}`,
      })),
    [assignments.data],
  );
  return (
    <SelectField
      label="Vai trò đã gán cần thu hồi"
      value={value}
      onChange={onChange}
      options={options}
      disabled={!userId}
      loading={!!userId && assignments.isPending}
      placeholder={!userId ? "Chọn người dùng trước" : assignments.isError ? "Không tải được danh sách" : options.length === 0 ? "Người này chưa có vai trò" : "Chọn vai trò đã gán"}
    />
  );
}

export function TargetFields({
  kind,
  value,
  onChange,
  forWhoCan = false,
}: {
  kind: TargetKind;
  value: TargetState;
  onChange: (next: TargetState) => void;
  forWhoCan?: boolean;
}) {
  const emailId = useId();
  const set = (patch: Partial<TargetState>) => onChange({ ...value, ...patch });

  switch (kind) {
    case "tenant":
      return <p className="rounded-xl bg-surface-hover px-4 py-3 text-sm text-muted">Quyền này áp dụng cho toàn tổ chức, không cần chọn tài nguyên cụ thể.</p>;
    case "document":
      return <DocumentSelect label="Tài liệu" value={value.targetId} onChange={(targetId) => set({ targetId })} />;
    case "org_unit":
      return <UnitSelect label="Đơn vị" value={value.targetId} onChange={(targetId) => set({ targetId })} />;
    case "org_unit_dest":
      return <UnitSelect label="Đơn vị đích" hint="Hành động tạo mới được kiểm trên đơn vị nơi tài nguyên sẽ nằm." value={value.targetId} onChange={(targetId) => set({ targetId })} />;
    case "user":
      return <UserSelect label="Người dùng đích" value={value.targetId} onChange={(targetId) => set({ targetId })} />;
    case "role":
      return <RoleSelect label="Vai trò" value={value.targetId} onChange={(targetId) => set({ targetId })} />;
    case "assignment":
      return (
        <div className="flex flex-col gap-4">
          <UserSelect label="Người đang giữ vai trò" value={value.targetUserId} onChange={(targetUserId) => set({ targetUserId, assignmentId: "" })} />
          <AssignmentSelect userId={value.targetUserId} value={value.assignmentId} onChange={(assignmentId) => set({ assignmentId })} />
        </div>
      );
    case "user_create":
      return (
        <div className="flex flex-col gap-4">
          <UnitSelect label="Công ty đích" only="COMPANY" value={value.targetId} onChange={(targetId) => set({ targetId })} />
          {forWhoCan ? null : (
            <Field id={emailId} label="Email người mới" hint="Tên miền phải là tên miền đang hoạt động của công ty này hoặc công ty tổ tiên.">
              <Input id={emailId} type="email" autoComplete="off" value={value.email} onChange={(e) => set({ email: e.target.value })} placeholder="ten@alpha.test" aria-describedby={`${emailId}-hint`} />
            </Field>
          )}
        </div>
      );
    case "assign": {
      if (forWhoCan) return null;
      const type = value.scopeType;
      const needsUnit = type === "COMPANY" || type === "DEPARTMENT" || type === "TEAM";
      return (
        <div className="flex flex-col gap-4">
          <UserSelect label="Người được gán" value={value.targetUserId} onChange={(targetUserId) => set({ targetUserId })} />
          <RoleSelect label="Vai trò sẽ gán" value={value.roleId} onChange={(roleId) => set({ roleId })} />
          <SelectField
            label="Loại phạm vi (scope)"
            value={type}
            onChange={(next) => set({ scopeType: next as ScopeType, scopeId: "" })}
            options={SCOPE_TYPES.map((s) => ({ value: s, label: SCOPE_TYPE_LABEL[s] }))}
            placeholder="Chọn loại phạm vi"
          />
          {needsUnit ? (
            <UnitSelect label={`${SCOPE_TYPE_LABEL[type as ScopeType]} áp dụng`} only={type as OrgUnitTreeDto["type"]} value={value.scopeId} onChange={(scopeId) => set({ scopeId })} />
          ) : null}
          {type === "RESOURCE" ? <DocumentSelect label="Tài liệu áp dụng" value={value.scopeId} onChange={(scopeId) => set({ scopeId })} /> : null}
        </div>
      );
    }
  }
}

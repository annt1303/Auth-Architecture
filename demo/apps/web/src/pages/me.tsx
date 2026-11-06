import { useQuery } from "@tanstack/react-query";
import type { MeResponse } from "@authz-demo/authz-types";
import { Avatar, Badge, Card, CardHead, DlRow, EmailText, LoadError, Mono, ScopeLabel, Skel, Tag, UnitLabel } from "@/components/common";
import { formatValidity, ineffectiveReasonText, permissionLabel, roleName } from "@/lib/format";
import { meQuery } from "@/lib/queries";

function Empty({ children }: { children: string }) {
  return <p className="px-4 pb-5 text-sm text-muted sm:px-5">{children}</p>;
}

function MeSkeleton() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" aria-busy aria-label="Đang tải">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="flex flex-col gap-3 p-5">
          <Skel className="w-32" />
          <Skel className="w-full" />
          <Skel className="w-2/3" />
        </Card>
      ))}
    </div>
  );
}

function AssignmentRow({ assignment }: { assignment: MeResponse["assignments"][number] }) {
  return (
    <li className={assignment.effective ? "px-4 py-3 sm:px-5" : "bg-surface-hover px-4 py-3 sm:px-5"}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{roleName(assignment.role)}</p>
        {assignment.effective ? <Badge tone="success">Đang hiệu lực</Badge> : <Badge tone="warning">{ineffectiveReasonText(assignment)}</Badge>}
      </div>
      <div className="mt-1 text-sm text-muted">
        <ScopeLabel scope={assignment.scope} />
      </div>
      <p className="mt-1 text-xs text-muted">{formatValidity(assignment)}</p>
    </li>
  );
}

export function MePage() {
  const query = useQuery(meQuery);
  if (query.isPending) return <MeSkeleton />;
  if (query.isError) {
    return <LoadError title="Không tải được thông tin của bạn" why="Kiểm tra kết nối rồi thử lại." onRetry={() => query.refetch()} />;
  }
  const me = query.data;
  const inactive = me.membership.status !== "ACTIVE";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card className="p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <Avatar seed={me.principal.email} name={me.principal.displayName} className="size-12 text-base" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold [overflow-wrap:anywhere]">{me.principal.displayName}</h2>
            <p className="text-sm text-muted">
              <EmailText email={me.principal.email} />
            </p>
          </div>
        </div>
        <dl className="@container mt-5 flex flex-col gap-3 border-t border-border-strong pt-4 text-sm">
          <DlRow label="Tổ chức">{me.tenant.name}</DlRow>
          <DlRow label="Tư cách thành viên">
            {me.membership.status === "ACTIVE" ? (
              <Badge tone="success">Hoạt động</Badge>
            ) : me.membership.status === "SUSPENDED" ? (
              <Badge tone="warning">Tạm ngưng</Badge>
            ) : (
              <Badge tone="warning">{me.membership.status === "REMOVED" ? "Đã bị gỡ" : "Chưa có"}</Badge>
            )}
          </DlRow>
        </dl>
        {inactive ? (
          <p role="status" className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Tư cách thành viên không hoạt động nên mọi vai trò bên dưới đều tạm thời không có hiệu lực.
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHead title="Đơn vị trực thuộc" meta={`${me.affiliations.length} công ty`} />
        {me.affiliations.length === 0 ? (
          <Empty>Bạn chưa thuộc công ty nào. Quản trị viên sẽ thêm bạn vào đơn vị phù hợp.</Empty>
        ) : (
          <ul className="divide-y divide-border-strong border-t border-border-strong">
            {me.affiliations.map(({ company, department }) => (
              <li key={company.id} className="flex flex-col gap-1.5 px-4 py-3 text-sm sm:px-5">
                <UnitLabel name={company.name} type="COMPANY" />
                {department ? (
                  <div className="pl-6">
                    <UnitLabel name={department.name} type="DEPARTMENT" />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead title="Vai trò được gán" meta={`${me.assignments.filter((a) => a.effective).length}/${me.assignments.length} đang hiệu lực`} />
        {me.assignments.length === 0 ? (
          <Empty>Bạn chưa có vai trò nào nên chưa dùng được chức năng nào. Hãy nhờ quản trị viên cấp vai trò.</Empty>
        ) : (
          <ul className="divide-y divide-border-strong border-t border-border-strong">
            {me.assignments.map((a) => (
              <AssignmentRow key={a.id} assignment={a} />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead title="Quyền hiệu lực" meta={`${me.effectivePermissions.length} quyền`} />
        {me.effectivePermissions.length === 0 ? (
          <Empty>Hiện chưa có quyền nào đang hiệu lực.</Empty>
        ) : (
          <ul className="divide-y divide-border-strong border-t border-border-strong">
            {me.effectivePermissions.map(({ permission, scopes }) => (
              <li key={permission} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-sm font-medium">{permissionLabel(permission)}</p>
                  <Mono>{permission}</Mono>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {scopes.map((scope) => (
                    <Tag key={`${scope.type}:${scope.id ?? ""}`}>{scope.label}</Tag>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import type { UserDto } from "@authz-demo/authz-types";
import { Card, CardHead, LoadError, Mono, Skel, Tag } from "@/components/common";
import { permissionLabel, SCOPE_TYPE_LABEL } from "@/lib/format";
import { userPermissionsQuery } from "@/lib/queries-users";

export function PermissionsTab({ user }: { user: UserDto }) {
  const canRead = user._actions.includes("read_assignments");
  const query = useQuery(userPermissionsQuery(user.id, canRead));

  if (!canRead) {
    return (
      <Card>
        <CardHead title="Quyền hiệu lực" />
        <p className="px-4 pb-5 text-sm text-muted sm:px-5">Bạn không có quyền xem quyền của người dùng này.</p>
      </Card>
    );
  }

  const items = [...(query.data ?? [])].sort((a, b) => permissionLabel(a.permission).localeCompare(permissionLabel(b.permission), "vi"));

  return (
    <Card>
      <CardHead title="Quyền hiệu lực" meta={query.data ? `${items.length} quyền` : undefined} />
      {query.isPending ? (
        <ul aria-busy aria-label="Đang tải" className="divide-y divide-border-strong border-t border-border-strong">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex flex-col gap-2 px-5 py-4">
              <Skel className="w-1/3" />
              <Skel className="w-1/2" />
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        <LoadError title="Không tải được quyền hiệu lực" why="Kiểm tra kết nối rồi thử lại." onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <p className="border-t border-border-strong px-4 py-8 text-center text-sm text-muted sm:px-5">
          Người dùng chưa có quyền nào đang hiệu lực (chưa có role, đã hết hạn hoặc đang tạm ngưng).
        </p>
      ) : (
        <ul className="divide-y divide-border-strong border-t border-border-strong">
          {items.map(({ permission, scopes }) => (
            <li key={permission} className="flex flex-col gap-2 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-sm font-medium">{permissionLabel(permission)}</span>
                <Mono>{permission}</Mono>
              </div>
              <ul aria-label={`Phạm vi của ${permissionLabel(permission)}`} className="flex flex-wrap gap-1.5">
                {scopes.map((scope) => (
                  <li key={`${scope.type}:${scope.id ?? ""}`} className="max-w-full">
                    <Tag>
                      <span className="mr-1 text-zinc-400">{SCOPE_TYPE_LABEL[scope.type]}:</span>
                      <span className="truncate">{scope.label}</span>
                    </Tag>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

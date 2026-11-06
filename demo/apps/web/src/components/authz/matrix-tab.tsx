import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EffectiveMatrixDto } from "@authz-demo/authz-types";
import { Grid3x3 } from "lucide-react";
import { Badge, Card, LoadError, Mono, ScopeLabel, Skel, Tag } from "@/components/common";
import { isApiError } from "@/lib/api";
import { permissionLabel } from "@/lib/format";
import { effectiveQuery } from "@/lib/queries-authz";
import { resourceTypeLabel, roleKeyLabel } from "./labels";
import { UserSelect } from "./target";

type Row = EffectiveMatrixDto["rows"][number];

function PermissionRow({ row }: { row: Row }) {
  return (
    <li className="grid gap-2 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{permissionLabel(row.permission)}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <Mono>{row.permission}</Mono>
          {row.riskLevel === "HIGH" ? <Badge tone="warning">Rủi ro cao</Badge> : <Tag>Rủi ro thấp</Tag>}
          {row.tenantScopeOnly ? <Tag>Chỉ cấp tổ chức</Tag> : null}
        </p>
      </div>
      {row.grants.length === 0 ? (
        <p className="text-sm text-muted italic">Không có grant nào</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {row.grants.map((g) => (
            <li key={`${g.assignmentId}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="min-w-0 flex-1 basis-48">
                <ScopeLabel scope={g.scope} />
              </span>
              <span className="shrink-0 text-xs text-muted">qua {roleKeyLabel(g.roleKey)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function MatrixTab() {
  const [principalId, setPrincipalId] = useState("");
  const [onlyGranted, setOnlyGranted] = useState(false);
  const matrix = useQuery(effectiveQuery(principalId));

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of matrix.data?.rows ?? []) {
      if (onlyGranted && row.grants.length === 0) continue;
      const type = row.permission.split(".")[0]!;
      map.set(type, [...(map.get(type) ?? []), row]);
    }
    return [...map.entries()];
  }, [matrix.data, onlyGranted]);

  const granted = matrix.data?.rows.filter((r) => r.grants.length > 0).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <UserSelect label="Người dùng" value={principalId} onChange={setPrincipalId} hint="Xem mỗi quyền của người này đang có ở những phạm vi nào, nhờ vai trò nào." />
        </div>
      </Card>

      {!principalId ? (
        <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <Grid3x3 className="size-8 text-muted" aria-hidden />
          <p className="text-sm font-medium">Chọn một người dùng để xem ma trận quyền</p>
        </Card>
      ) : matrix.isPending ? (
        <Card aria-busy aria-label="Đang tải" className="flex flex-col gap-3 p-5">
          {[0, 1, 2, 3].map((i) => (
            <Skel key={i} className="w-full" />
          ))}
        </Card>
      ) : matrix.isError ? (
        <Card>
          <LoadError
            title={isApiError(matrix.error, "not_found") ? "Không tìm thấy người dùng này" : "Không tải được ma trận quyền"}
            why={isApiError(matrix.error, "forbidden") ? "Bạn không có quyền xem công cụ này." : "Kiểm tra kết nối rồi thử lại."}
            onRetry={() => matrix.refetch()}
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              <span className="font-medium text-foreground">{matrix.data.principal.displayName}</span> có grant cho{" "}
              <span className="font-medium text-foreground tabular-nums">
                {granted}/{matrix.data.rows.length}
              </span>{" "}
              quyền
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyGranted} onChange={(e) => setOnlyGranted(e.target.checked)} className="size-4 cursor-pointer accent-primary" />
              Chỉ hiện quyền có grant
            </label>
          </div>
          {groups.length === 0 ? (
            <Card className="px-6 py-10 text-center text-sm text-muted">Người này chưa có quyền nào còn hiệu lực.</Card>
          ) : (
            groups.map(([type, rows]) => (
              <Card key={type}>
                <h3 className="px-4 pt-4 pb-3 text-sm font-semibold sm:px-5">{resourceTypeLabel(type)}</h3>
                <ul className="divide-y divide-border-strong border-t border-border-strong">
                  {rows.map((row) => (
                    <PermissionRow key={row.permission} row={row} />
                  ))}
                </ul>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { Avatar, Card, CardHead, LoadError, Mono, Skel, Tag } from "@/components/common";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api";
import { permissionLabel } from "@/lib/format";
import { simPermissionsQuery, whoCanQuery, type WhoCanParams } from "@/lib/queries-authz";
import { SelectField, type OptionGroup } from "./fields";
import { resourceTypeLabel, roleKeyLabel } from "./labels";
import { buildTarget, EMPTY_TARGET, TargetFields, targetKindFor, type TargetState } from "./target";

export function WhoCanTab() {
  const permissions = useQuery(simPermissionsQuery);
  const [action, setAction] = useState("");
  const [target, setTarget] = useState<TargetState>(EMPTY_TARGET);
  const [submitted, setSubmitted] = useState<WhoCanParams | null>(null);

  const kind = targetKindFor(action);
  const permission = permissions.data?.find((p) => p.key === action);
  // Endpoint không nhận tham số scope nên không trả lời được cho "gán vai trò".
  const unsupported = kind === "assign";
  const built = action && !unsupported ? buildTarget(kind, target, permission?.resourceType ?? "", true) : null;
  const result = useQuery(whoCanQuery(submitted));

  const groups: OptionGroup[] = useMemo(() => {
    const map = new Map<string, OptionGroup>();
    for (const p of permissions.data ?? []) {
      const g = map.get(p.resourceType) ?? { label: resourceTypeLabel(p.resourceType), options: [] };
      g.options.push({ value: p.key, label: `${permissionLabel(p.key)} · ${p.key}` });
      map.set(p.resourceType, g);
    }
    return [...map.values()];
  }, [permissions.data]);

  const submit = () => {
    if (!built) return;
    setSubmitted({ action, resourceType: built.resource.type, resourceId: built.resource.id });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHead title="Ai có quyền này, trên tài nguyên này?" />
        <form
          className="flex max-w-xl flex-col gap-4 px-4 pb-4 sm:px-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <SelectField
            label="Hành động (action)"
            value={action}
            onChange={(next) => {
              setAction(next);
              setTarget(EMPTY_TARGET);
              setSubmitted(null);
            }}
            groups={groups}
            loading={permissions.isPending}
            placeholder={permissions.isError ? "Không tải được danh mục quyền" : "Chọn quyền"}
            hint={permission?.description}
          />
          {action ? (
            unsupported ? (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                Quyền gán vai trò cần biết scope và vai trò cụ thể nên không tra theo kiểu “ai có quyền”. Dùng tab Mô phỏng để hỏi từng người.
              </p>
            ) : (
              <TargetFields kind={kind} value={target} onChange={setTarget} forWhoCan />
            )
          ) : null}
          <div>
            <Button type="submit" variant="primary" disabled={!built}>
              <Search aria-hidden />
              Tìm người có quyền
            </Button>
          </div>
        </form>
      </Card>

      {!submitted ? null : result.isPending ? (
        <Card aria-busy aria-label="Đang tải" className="flex flex-col gap-3 p-5">
          {[0, 1, 2].map((i) => (
            <Skel key={i} className="w-2/3" />
          ))}
        </Card>
      ) : result.isError ? (
        <Card>
          <LoadError
            title={isApiError(result.error, "not_found") ? "Không tìm thấy tài nguyên" : "Không tải được kết quả"}
            why={isApiError(result.error, "invalid_request") ? "Thiếu thông tin cho hành động này." : "Kiểm tra kết nối rồi thử lại."}
            onRetry={() => result.refetch()}
          />
        </Card>
      ) : (
        <Card aria-live="polite">
          <CardHead title={`${result.data.principals.length} người có quyền`} meta={result.data.resource.label} />
          <p className="px-4 pb-3 text-xs text-muted sm:px-5">
            {permissionLabel(result.data.action)} <Mono>{result.data.action}</Mono> trên {resourceTypeLabel(result.data.resource.type).toLowerCase()}. Chỉ tính người đang hoạt động và có grant bao phủ; chưa tính ràng buộc quản trị.
          </p>
          {result.data.principals.length === 0 ? (
            <div className="flex flex-col items-center gap-2 border-t border-border-strong px-6 py-10 text-center">
              <Users className="size-8 text-muted" aria-hidden />
              <p className="text-sm font-medium">Không ai có quyền này</p>
            </div>
          ) : (
            <ul className="divide-y divide-border-strong border-t border-border-strong">
              {result.data.principals.map((p) => (
                <li key={p.id} className="flex gap-3 px-4 py-3 sm:px-5">
                  <Avatar seed={p.id} name={p.displayName} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium [overflow-wrap:anywhere]">{p.displayName}</p>
                    <p className="text-xs text-muted [overflow-wrap:anywhere]">{p.email}</p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Có quyền qua">
                      {p.via.map((v, i) => (
                        <li key={`${v.roleKey}-${v.scopeLabel}-${i}`}>
                          <Tag>
                            {roleKeyLabel(v.roleKey)} · {v.scopeLabel}
                          </Tag>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

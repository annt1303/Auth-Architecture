import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { Card, LoadError, Mono, Skel, Tag } from "@/components/common";
import { RiskBadge, resourceTypeLabel } from "@/components/roles/labels";
import { Input } from "@/components/ui/input";
import { permissionLabel } from "@/lib/format";
import { permissionsQuery } from "@/lib/queries-roles";
import { cn } from "@/lib/utils";

type Risk = "LOW" | "HIGH" | undefined;
const TABS: { value: Risk; label: string }[] = [
  { value: undefined, label: "Tất cả" },
  { value: "HIGH", label: "Rủi ro cao" },
  { value: "LOW", label: "Rủi ro thấp" },
];

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/g, "d").toLowerCase();

export function CatalogPage() {
  const permissions = useQuery(permissionsQuery);
  const [risk, setRisk] = useState<Risk>(undefined);
  const [search, setSearch] = useState("");

  const all = permissions.data ?? [];
  const shown = useMemo(() => {
    const needle = normalize(search.trim());
    return all.filter(
      (p) =>
        (!risk || p.riskLevel === risk) &&
        (!needle || normalize(`${p.key} ${permissionLabel(p.key)} ${p.description} ${resourceTypeLabel(p.resourceType)}`).includes(needle)),
    );
  }, [all, risk, search]);
  const count = (value: Risk) => (value ? all.filter((p) => p.riskLevel === value).length : all.length);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">Danh mục quyền</h2>
        <p className="mt-1 text-sm text-muted">
          Toàn bộ quyền có trong hệ thống. Role chỉ chọn quyền từ danh mục này.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Lọc theo mức rủi ro" className="inline-flex gap-1 rounded-xl bg-tab-rail p-1">
          {TABS.map((tab) => {
            const active = tab.value === risk;
            return (
              <button
                key={tab.label}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setRisk(tab.value)}
                className={cn(
                  "min-h-8 cursor-pointer rounded-lg px-3 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-focus",
                  active ? "bg-surface text-foreground shadow-segment-thumb" : "text-muted hover:text-foreground",
                )}
              >
                {tab.label}
                {permissions.data ? <span className="ml-1.5 text-xs text-muted">{count(tab.value)}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm theo khóa, tên, mô tả"
            aria-label="Tìm quyền"
            className="pl-10"
          />
        </div>
      </div>

      <Card>
        {permissions.isPending ? (
          <div className="flex flex-col gap-5 p-5" aria-busy>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skel key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : permissions.isError ? (
          <LoadError title="Không tải được danh mục quyền" why="Kiểm tra kết nối rồi thử lại." onRetry={() => permissions.refetch()} />
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Không có quyền nào khớp bộ lọc.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <caption className="sr-only">Danh mục quyền</caption>
              <thead>
                <tr className="border-b border-border-strong text-xs text-muted">
                  <th scope="col" className="px-5 py-3 font-medium">Quyền</th>
                  <th scope="col" className="px-3 py-3 font-medium">Mô tả</th>
                  <th scope="col" className="px-3 py-3 font-medium">Rủi ro</th>
                  <th scope="col" className="px-3 py-3 font-medium">Nhìn thấy</th>
                  <th scope="col" className="px-5 py-3 font-medium">Chỉ TENANT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-strong">
                {shown.map((p) => (
                  <tr key={p.key} className="align-top">
                    <th scope="row" className="px-5 py-3 font-normal">
                      <Mono className="text-foreground">{p.key}</Mono>
                      <div className="mt-0.5 font-medium">{permissionLabel(p.key)}</div>
                      <div className="mt-1">
                        <Tag>{resourceTypeLabel(p.resourceType)}</Tag>
                      </div>
                    </th>
                    <td className="max-w-xs px-3 py-3 text-muted">{p.description}</td>
                    <td className="px-3 py-3">
                      <RiskBadge risk={p.riskLevel} />
                    </td>
                    <td className="px-3 py-3">
                      {p.isVisibility ? (
                        <span className="inline-flex items-center gap-1.5 text-foreground">
                          <Check className="size-4 text-emerald-600" aria-hidden />
                          Có
                        </span>
                      ) : (
                        <span className="text-muted">
                          <span aria-hidden>–</span>
                          <span className="sr-only">Không</span>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {p.tenantScopeOnly ? (
                        <div>
                          <span className="inline-flex items-center gap-1.5 text-foreground">
                            <Check className="size-4 text-emerald-600" aria-hidden />
                            Có
                          </span>
                          <p className="mt-1 max-w-48 text-xs text-muted">Chỉ assignment ở phạm vi toàn tổ chức mới trao được quyền này.</p>
                        </div>
                      ) : (
                        <span className="text-muted">
                          <span aria-hidden>–</span>
                          <span className="sr-only">Không</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted">
        "Nhìn thấy" là quyền cho phép xem một loại tài nguyên; các quyền khác thường cần kèm quyền này để có tác dụng.
      </p>
    </div>
  );
}

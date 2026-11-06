import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { MatrixTab } from "@/components/authz/matrix-tab";
import { SimulateTab } from "@/components/authz/simulate-tab";
import { TabBar } from "@/components/authz/fields";
import { WhoCanTab } from "@/components/authz/who-can-tab";
import { hasPermission } from "@/lib/permissions";
import { meQuery } from "@/lib/queries";

type Tab = "simulate" | "matrix" | "who-can";

const TABS: { value: Tab; label: string }[] = [
  { value: "simulate", label: "Mô phỏng" },
  { value: "matrix", label: "Ma trận quyền" },
  { value: "who-can", label: "Ai có quyền" },
];

const INTRO: Record<Tab, string> = {
  simulate: "Hỏi thử “người này làm việc này trên tài nguyên kia thì sao” và xem từng bước hệ thống quyết định. Đây là công cụ học: hiện cả mã lý do và ràng buộc mà người dùng thường không thấy.",
  matrix: "Mỗi quyền của một người đang có ở những phạm vi nào, nhờ vai trò nào.",
  "who-can": "Ngược lại với ma trận: với một quyền trên một tài nguyên, ai đang có quyền?",
};

export function SimulatorPage() {
  const { tab = "simulate" } = useSearch({ from: "/shell/mo-phong" });
  const navigate = useNavigate({ from: "/mo-phong" });
  const me = useQuery(meQuery);

  if (me.data && !hasPermission(me.data, "authz_simulation.run")) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm font-medium">Bạn chưa có quyền dùng công cụ mô phỏng</p>
        <p className="mt-1 text-sm text-muted">Công cụ này dành cho quản trị cấp tổ chức.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <TabBar label="Công cụ phân quyền" tabs={TABS} value={tab} onChange={(next) => navigate({ search: { tab: next } })} />
        <p className="max-w-3xl text-sm text-muted">{INTRO[tab]}</p>
      </div>
      {tab === "simulate" ? <SimulateTab /> : tab === "matrix" ? <MatrixTab /> : <WhoCanTab />}
    </div>
  );
}

import type { DecisionTrace, EvaluationState } from "@authz-demo/authz-types";
import { Check, Minus, X } from "lucide-react";
import { Badge, Card, CardHead, Mono, Tag } from "@/components/common";
import { permissionLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { roleKeyLabel, CONSTRAINT_INFO, ERROR_INFO, REASON_INFO, STATE_LABEL, STEP_INFO } from "./labels";

type Outcome = "PASS" | "FAIL" | "SKIP";

const OUTCOME = {
  PASS: { label: "Đạt", icon: Check, circle: "bg-emerald-50 text-emerald-700 ring-emerald-200", text: "text-emerald-700" },
  FAIL: { label: "Trượt", icon: X, circle: "bg-red-50 text-red-700 ring-red-200", text: "text-red-700" },
  SKIP: { label: "Bỏ qua", icon: Minus, circle: "bg-zinc-100 text-zinc-500 ring-zinc-200", text: "text-zinc-500" },
} as const;

const STATE_TONE: Record<EvaluationState, "success" | "error" | "warning"> = {
  ALLOW: "success",
  DENY: "error",
  NOT_APPLICABLE: "warning",
  INDETERMINATE: "warning",
};

function detailText(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null;
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

export function ResultBlock({ trace }: { trace: DecisionTrace }) {
  const { result } = trace;
  const ok = result.state === "ALLOW";
  return (
    <Card aria-live="polite" className={cn(ok ? "border-emerald-200" : "border-red-200")}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
        <div className="min-w-0">
          <p className="text-xs text-muted">Kết quả mô phỏng</p>
          <p className={cn("text-lg font-semibold", ok ? "text-emerald-700" : "text-red-700")}>{STATE_LABEL[result.state]}</p>
        </div>
        <Badge tone={STATE_TONE[result.state]}>{result.state}</Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-3 px-4 pb-4 text-sm sm:grid-cols-3 sm:px-5">
        <div>
          <dt className="text-xs text-muted">reasonCode</dt>
          <dd className="mt-0.5 font-mono text-xs font-medium">{result.reasonCode}</dd>
          <dd className="mt-1 text-xs text-muted">{REASON_INFO[result.reasonCode]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Mã HTTP</dt>
          <dd className="mt-0.5 font-mono text-xs font-medium">{result.httpStatus}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">errorCode</dt>
          <dd className="mt-0.5 font-mono text-xs font-medium">{result.errorCode ?? "không có lỗi"}</dd>
          {result.errorCode ? <dd className="mt-1 text-xs text-muted">{ERROR_INFO[result.errorCode]}</dd> : null}
        </div>
      </dl>
      <p className="border-t border-border-strong px-4 py-3 text-xs text-muted sm:px-5">
        Người dùng thật chỉ nhận mã HTTP và errorCode. reasonCode và ràng buộc chỉ hiện ở công cụ học này và trong nhật ký.
      </p>
    </Card>
  );
}

export function Timeline({ trace }: { trace: DecisionTrace }) {
  return (
    <Card>
      <CardHead title="Các bước đánh giá" meta="PA4 → D6" />
      <ol className="px-4 pb-4 sm:px-5">
        {trace.steps.map((step, index) => {
          const meta = OUTCOME[step.outcome as Outcome];
          const info = STEP_INFO[step.id];
          const detail = detailText(step.detail);
          const Icon = meta.icon;
          const last = index === trace.steps.length - 1;
          return (
            <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
              {last ? null : <span aria-hidden className="absolute top-8 bottom-0 left-4 -ml-px w-px bg-border-strong" />}
              <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-1", meta.circle)}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Mono className="font-semibold text-foreground">{step.id}</Mono>
                  <span className={cn("text-sm font-medium", step.outcome === "SKIP" && "text-muted")}>{info.title}</span>
                  <span className={cn("text-xs font-medium", meta.text)}>{meta.label}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">{info.what}</p>
                {step.outcome === "FAIL" && info.onFail ? <p className="mt-0.5 text-xs text-red-700">{info.onFail}</p> : null}
                {detail ? <Mono className="mt-1 block [overflow-wrap:anywhere]">{detail}</Mono> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function GrantsTable({ trace }: { trace: DecisionTrace }) {
  const covering = trace.grants.filter((g) => g.coversResource).length;
  return (
    <Card>
      <CardHead title="Grant hiệu lực của người dùng" meta={`${covering}/${trace.grants.length} bao phủ tài nguyên`} />
      {trace.grants.length === 0 ? (
        <p className="px-4 pb-5 text-sm text-muted sm:px-5">Không có grant nào trao quyền này (đã loại assignment hết hạn, chưa hiệu lực hoặc bị thu hồi).</p>
      ) : (
        <ul className="divide-y divide-border-strong border-t border-border-strong">
          {trace.grants.map((g) => (
            <li key={`${g.assignmentId}`} className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5", g.coversResource ? "bg-emerald-50/40" : "")}>
              <div className="min-w-0">
                <p className="text-sm font-medium [overflow-wrap:anywhere]">
                  {roleKeyLabel(g.roleKey)} <span className="text-xs font-normal text-muted">cấp {g.roleLevel}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <Tag>{g.scopeType}</Tag>
                  <span className="[overflow-wrap:anywhere]">{g.scopeLabel}</span>
                </p>
              </div>
              {g.coversResource ? <Badge tone="success">Bao phủ</Badge> : <Badge tone="neutral">Không bao phủ</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ConstraintsTable({ trace }: { trace: DecisionTrace }) {
  return (
    <Card>
      <CardHead title="Ràng buộc quản trị" meta={trace.constraints.length ? `${trace.constraints.filter((c) => c.outcome === "FAIL").length} trượt` : undefined} />
      {trace.constraints.length === 0 ? (
        <p className="px-4 pb-5 text-sm text-muted sm:px-5">Không có ràng buộc nào được tính: action này không phải thao tác quản trị, hoặc quyết định đã dừng trước bước C2.</p>
      ) : (
        <ul className="divide-y divide-border-strong border-t border-border-strong">
          {trace.constraints.map((c) => {
            const info = CONSTRAINT_INFO[c.id];
            const detail = detailText(c.detail);
            return (
              <li key={c.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                    <Mono className="font-semibold text-foreground">{c.id}</Mono>
                    <span className="text-sm font-medium">{info.title}</span>
                  </div>
                  {c.outcome === "PASS" ? <Badge tone="success">Đạt</Badge> : <Badge tone="error">Trượt</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted">{info.what}</p>
                {detail ? <Mono className="mt-1 block [overflow-wrap:anywhere]">{detail}</Mono> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function TraceView({ trace, principalName }: { trace: DecisionTrace; principalName: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        <span className="font-medium text-foreground">{principalName}</span> hỏi quyền <span className="font-medium text-foreground">{permissionLabel(trace.request.action)}</span>{" "}
        <Mono>{trace.request.action}</Mono>
      </p>
      <ResultBlock trace={trace} />
      <Timeline trace={trace} />
      <GrantsTable trace={trace} />
      <ConstraintsTable trace={trace} />
    </div>
  );
}

import type { ReactNode } from "react";
import type { AuditEventDto } from "@authz-demo/authz-types";
import { X } from "lucide-react";
import { Badge, Mono, Tag } from "@/components/common";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CONSTRAINT_INFO, eventTypeLabel, LOGIN_DENIED_REASON, REASON_INFO, targetTypeLabel } from "./labels";

const pad = (n: number) => String(n).padStart(2, "0");
export function formatFull(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Trường nhiễu: updated_at đổi ở mọi lần sửa, tenant_id luôn như nhau trong một tổ chức.
const IGNORED = new Set(["updated_at", "tenant_id"]);

export type DiffRow = { field: string; before?: unknown; after?: unknown; kind: "changed" | "added" | "removed" };

export function diffPayload(payload: Record<string, unknown>): DiffRow[] {
  const before = isObject(payload.old) ? payload.old : null;
  const after = isObject(payload.new) ? payload.new : null;
  if (!before && !after) return [];
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !IGNORED.has(k));
  if (before && after) {
    return keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((field) => ({ field, before: before[field], after: after[field], kind: "changed" }));
  }
  return keys.map((field) => (after ? { field, after: after[field], kind: "added" } : { field, before: before![field], kind: "removed" }));
}

function Value({ value, tone }: { value: unknown; tone: "before" | "after" }) {
  const text = value === null || value === undefined ? "trống" : typeof value === "string" ? (value === "" ? "chuỗi rỗng" : value) : JSON.stringify(value);
  const empty = value === null || value === undefined || value === "";
  return (
    <code
      className={cn(
        "block rounded-lg px-2.5 py-1.5 font-mono text-xs [overflow-wrap:anywhere]",
        tone === "before" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700",
        empty && "italic opacity-70",
      )}
    >
      {text}
    </code>
  );
}

function DiffList({ rows }: { rows: DiffRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">Không có trường nào khác nhau (bỏ qua updated_at).</p>;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.field}>
          <Mono className="font-semibold text-foreground">{row.field}</Mono>
          <div className={cn("mt-1 grid gap-1.5", row.kind === "changed" && "sm:grid-cols-2")}>
            {row.kind !== "added" ? (
              <div>
                <span className="sr-only">Trước: </span>
                <Value value={row.before} tone="before" />
              </div>
            ) : null}
            {row.kind !== "removed" ? (
              <div>
                <span className="sr-only">Sau: </span>
                <Value value={row.after} tone="after" />
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 font-medium [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? null : JSON.stringify(v));

function DenyDetails({ event }: { event: AuditEventDto }) {
  const p = event.payload;
  const reason = str(p.reason_code);
  const constraint = str(p.constraint);
  const detail = p.detail === null || p.detail === undefined ? null : JSON.stringify(p.detail);
  if (event.eventType === "auth.login_denied") {
    const code = str(p.reason);
    return (
      <dl className="flex flex-col gap-2 text-sm">
        <Row label="Lý do">
          {code ? <Mono className="text-foreground">{code}</Mono> : "—"}
          {code && LOGIN_DENIED_REASON[code] ? <span className="mt-0.5 block text-xs font-normal text-muted">{LOGIN_DENIED_REASON[code]}</span> : null}
        </Row>
        <Row label="Email">{str(p.email) ?? "—"}</Row>
        <Row label="Nhà cung cấp">{str(p.provider) ?? "—"}</Row>
      </dl>
    );
  }
  return (
    <dl className="flex flex-col gap-2 text-sm">
      <Row label="Hành động">{str(p.action) ? <Mono className="text-foreground">{str(p.action)}</Mono> : "—"}</Row>
      <Row label="reason_code">
        {reason ? <Mono className="text-foreground">{reason}</Mono> : "—"}
        {reason && reason in REASON_INFO ? <span className="mt-0.5 block text-xs font-normal text-muted">{REASON_INFO[reason as keyof typeof REASON_INFO]}</span> : null}
      </Row>
      <Row label="Ràng buộc">
        {constraint ? <Mono className="text-foreground">{constraint}</Mono> : "—"}
        {constraint && constraint in CONSTRAINT_INFO ? <span className="mt-0.5 block text-xs font-normal text-muted">{CONSTRAINT_INFO[constraint as keyof typeof CONSTRAINT_INFO].title}</span> : null}
      </Row>
      <Row label="http_status">{str(p.http_status) ? <Mono className="text-foreground">{str(p.http_status)}</Mono> : "—"}</Row>
      {str(p.state) ? <Row label="Trạng thái">{str(p.state)}</Row> : null}
      {str(p.failed_dependency) ? <Row label="Phụ thuộc lỗi">{str(p.failed_dependency)}</Row> : null}
      {detail ? (
        <Row label="Chi tiết">
          <Mono className="text-foreground [overflow-wrap:anywhere]">{detail}</Mono>
        </Row>
      ) : null}
    </dl>
  );
}

export function AuditSheet({ event, onClose }: { event: AuditEventDto | null; onClose: () => void }) {
  const rows = event?.eventClass === "A" ? diffPayload(event.payload) : [];
  const note = event ? str(event.payload.reason) : null;
  return (
    <Sheet open={!!event} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="sm:w-[32rem]">
        {event ? (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <SheetTitle className="text-base font-semibold">{eventTypeLabel(event.eventType)}</SheetTitle>
                <SheetDescription asChild>
                  <p className="mt-1">
                    <Mono>{event.eventType}</Mono>
                  </p>
                </SheetDescription>
              </div>
              <SheetClose
                aria-label="Đóng"
                className="-mr-2 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted outline-hidden hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
              >
                <X className="size-4" aria-hidden />
              </SheetClose>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
              <dl className="flex flex-col gap-2 text-sm">
                <Row label="Thời điểm">
                  <span className="tabular-nums">{formatFull(event.occurredAt)}</span>
                </Row>
                <Row label="Lớp">
                  {event.eventClass === "A" ? <Badge tone="neutral">A · Thay đổi dữ liệu</Badge> : <Badge tone="warning">B · Từ chối truy cập</Badge>}
                </Row>
                <Row label="Người thực hiện">
                  {event.actor?.displayName || (event.eventClass === "B" ? "Chưa đăng nhập" : "Không xác định")}
                  {event.eventClass === "A" && !event.actorAttributed ? <span className="mt-0.5 block text-xs font-normal text-amber-700">Thay đổi không đi qua dịch vụ nên không gắn được người thực hiện.</span> : null}
                </Row>
                <Row label="Đối tượng">
                  {event.targetLabel ?? "—"}
                  {event.targetType ? (
                    <span className="mt-0.5 block">
                      <Tag>{targetTypeLabel(event.targetType)}</Tag>
                    </span>
                  ) : null}
                </Row>
                <Row label="Đơn vị">{event.orgUnit ? event.orgUnit.name : <Tag>Cấp tổ chức</Tag>}</Row>
                {note ? <Row label="Lý do ghi nhận">{note}</Row> : null}
                {event.correlationId ? (
                  <Row label="Mã tương quan">
                    <Mono className="[overflow-wrap:anywhere]">{event.correlationId}</Mono>
                  </Row>
                ) : null}
              </dl>

              <section aria-labelledby="audit-detail-h">
                <h3 id="audit-detail-h" className="mb-3 text-sm font-semibold">
                  {event.eventClass === "A" ? "Thay đổi giá trị" : "Chi tiết từ chối"}
                </h3>
                {event.eventClass === "A" ? <DiffList rows={rows} /> : <DenyDetails event={event} />}
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

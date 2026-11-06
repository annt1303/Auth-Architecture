import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { AuditEventDto } from "@authz-demo/authz-types";
import { Info, Loader2, ScrollText } from "lucide-react";
import { AuditSheet, formatFull } from "@/components/authz/audit-detail";
import { Field, SelectField, TabBar, type OptionGroup } from "@/components/authz/fields";
import { EVENT_TYPE_GROUPS, eventTypeLabel, TARGET_FILTER_GROUPS, targetTypeLabel } from "@/components/authz/labels";
import { Badge, Card, LoadError, Mono, Skel, Tag } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import { formatUpdated } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { meQuery } from "@/lib/queries";
import { auditQuery, simUsersQuery, type AuditFilters } from "@/lib/queries-authz";
import { cn } from "@/lib/utils";

type ClassTab = "ALL" | "A" | "B";

const CLASS_TABS: { value: ClassTab; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "A", label: "A · Thay đổi dữ liệu" },
  { value: "B", label: "B · Từ chối truy cập" },
];

const GRID = "md:grid-cols-[7.5rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] md:gap-4";

const EVENT_GROUPS: OptionGroup[] = EVENT_TYPE_GROUPS.map((g) => ({
  label: g.label,
  options: g.types.map((t) => ({ value: t, label: eventTypeLabel(t) })),
}));
const TARGET_GROUPS: OptionGroup[] = TARGET_FILTER_GROUPS.map((g) => ({
  label: g.label,
  options: g.types.map((t) => ({ value: t, label: targetTypeLabel(t) })),
}));

// Lọc theo ngày giờ máy: "từ" là 00:00 ngày đã chọn, "đến" là hết ngày đã chọn (cận trên loại trừ).
const dayStartIso = (value: string) => new Date(`${value}T00:00:00`).toISOString();
const dayEndIso = (value: string) => {
  const d = new Date(`${value}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
};

function EventRow({ event, onOpen }: { event: AuditEventDto; onOpen: () => void }) {
  const actor = event.actor?.displayName || (event.eventClass === "B" ? "Chưa đăng nhập" : "Không xác định");
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full cursor-pointer flex-col gap-1.5 px-4 py-3 text-left outline-hidden transition-colors hover:bg-item-hover focus-visible:bg-item-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset sm:px-5 md:grid md:items-center",
          GRID,
        )}
      >
        <span className="flex items-center justify-between gap-3 md:block">
          <span className="text-xs text-muted tabular-nums" title={formatFull(event.occurredAt)}>
            {formatUpdated(event.occurredAt)}
          </span>
          <span className="md:mt-1 md:block">
            {event.eventClass === "A" ? <Badge tone="neutral">A · Dữ liệu</Badge> : <Badge tone="warning">B · Từ chối</Badge>}
          </span>
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium [overflow-wrap:anywhere]">{eventTypeLabel(event.eventType)}</span>
          <Mono className="block [overflow-wrap:anywhere]">{event.eventType}</Mono>
        </span>
        <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
          <span className="text-xs text-muted md:sr-only">Người thực hiện: </span>
          {actor}
          {event.eventClass === "A" && !event.actorAttributed ? (
            <span className="ml-1.5 text-xs text-amber-700">(chưa gắn người)</span>
          ) : null}
        </span>
        <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
          <span className="text-xs text-muted md:sr-only">Đối tượng: </span>
          {event.targetLabel ?? (event.targetType ? targetTypeLabel(event.targetType) : "—")}
          {event.targetLabel && event.targetType ? <span className="block text-xs text-muted">{targetTypeLabel(event.targetType)}</span> : null}
        </span>
        <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
          <span className="text-xs text-muted md:sr-only">Đơn vị: </span>
          {event.orgUnit ? event.orgUnit.name : <Tag>Cấp tổ chức</Tag>}
        </span>
      </button>
    </li>
  );
}

export function AuditPage() {
  const me = useQuery(meQuery);
  const users = useQuery(simUsersQuery);
  const [cls, setCls] = useState<ClassTab>("ALL");
  const [eventType, setEventType] = useState("");
  const [actorId, setActorId] = useState("");
  const [targetType, setTargetType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<AuditEventDto | null>(null);

  const filters: AuditFilters = useMemo(
    () => ({
      ...(cls !== "ALL" ? { eventClass: cls } : {}),
      ...(eventType ? { eventType } : {}),
      ...(actorId ? { actorId } : {}),
      ...(targetType ? { targetType } : {}),
      ...(from ? { from: dayStartIso(from) } : {}),
      ...(to ? { to: dayEndIso(to) } : {}),
    }),
    [cls, eventType, actorId, targetType, from, to],
  );
  const filtered = Object.keys(filters).length > 0;
  const audit = useInfiniteQuery(auditQuery(filters));
  const events = audit.data?.pages.flatMap((p) => p.items) ?? [];

  const actorOptions = useMemo(() => (users.data ?? []).map((u) => ({ value: u.id, label: u.displayName })), [users.data]);

  const clear = () => {
    setCls("ALL");
    setEventType("");
    setActorId("");
    setTargetType("");
    setFrom("");
    setTo("");
  };

  if (me.data && !hasPermission(me.data, "authorization_audit.read")) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm font-medium">Bạn chưa có quyền xem nhật ký phân quyền</p>
      </div>
    );
  }

  const forbidden = isApiError(audit.error, "forbidden") || isApiError(audit.error, "tenant_access_denied");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <p className="flex gap-2.5 rounded-2xl bg-primary-light px-4 py-3 text-sm text-foreground/80">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          Quản trị công ty chỉ thấy sự kiện trong cây công ty của mình. Sự kiện cấp tổ chức (đơn vị ghi “Cấp tổ chức”, như tạm ngưng thành viên, tài khoản, đăng nhập bị từ chối) chỉ người có quyền cấp tổ chức mới thấy.
        </span>
      </p>

      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <TabBar label="Lớp sự kiện" tabs={CLASS_TABS} value={cls} onChange={setCls} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SelectField label="Loại sự kiện" value={eventType} onChange={setEventType} groups={EVENT_GROUPS} placeholder="Tất cả loại" />
          <SelectField label="Người thực hiện" value={actorId} onChange={setActorId} options={actorOptions} loading={users.isPending} placeholder="Tất cả mọi người" />
          <SelectField label="Loại đối tượng" value={targetType} onChange={setTargetType} groups={TARGET_GROUPS} placeholder="Tất cả đối tượng" />
          <Field id="audit-from" label="Từ ngày">
            <Input id="audit-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field id="audit-to" label="Đến ngày">
            <Input id="audit-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button onClick={clear} disabled={!filtered}>
              Xoá bộ lọc
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div aria-hidden className={cn("hidden border-b border-border-strong px-5 py-2.5 text-xs font-medium text-muted md:grid", GRID)}>
          <span>Thời điểm</span>
          <span>Sự kiện</span>
          <span>Người thực hiện</span>
          <span>Đối tượng</span>
          <span>Đơn vị</span>
        </div>
        {audit.isPending ? (
          <ul aria-busy aria-label="Đang tải" className="divide-y divide-border-strong">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex flex-col gap-2 px-5 py-4">
                <Skel className="w-1/2" />
                <Skel className="w-1/3" />
              </li>
            ))}
          </ul>
        ) : audit.isError ? (
          <LoadError
            title={forbidden ? "Bạn không có quyền xem nhật ký" : "Không tải được nhật ký"}
            why={forbidden ? "Cần quyền xem nhật ký phân quyền." : "Kiểm tra kết nối rồi thử lại."}
            onRetry={() => audit.refetch()}
          />
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <ScrollText className="size-8 text-muted" aria-hidden />
            <p className="text-sm font-medium">{filtered ? "Không có sự kiện nào khớp bộ lọc" : "Chưa có sự kiện nào trong phạm vi của bạn"}</p>
            <p className="max-w-sm text-sm text-muted">{filtered ? "Thử nới bộ lọc hoặc xoá bộ lọc." : "Sự kiện chỉ hiện trong phạm vi bạn được xem."}</p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border-strong" aria-label="Danh sách sự kiện">
              {events.map((event) => (
                <EventRow key={event.id} event={event} onOpen={() => setOpen(event)} />
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3 border-t border-border-strong px-4 py-3 sm:px-5">
              <p className="text-xs text-muted tabular-nums">Đã tải {events.length} sự kiện{audit.hasNextPage ? "" : ", đã hết"}</p>
              {audit.hasNextPage ? (
                <Button onClick={() => audit.fetchNextPage()} disabled={audit.isFetchingNextPage} aria-busy={audit.isFetchingNextPage || undefined}>
                  {audit.isFetchingNextPage ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                  Tải thêm
                </Button>
              ) : null}
            </div>
            {audit.isFetchNextPageError ? (
              <p role="alert" className="px-5 pb-3 text-sm text-red-600">
                Không tải thêm được. Thử lại.
              </p>
            ) : null}
          </>
        )}
      </Card>

      <AuditSheet event={open} onClose={() => setOpen(null)} />
    </div>
  );
}

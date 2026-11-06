import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import type { DomainDto, OrgUnitTreeDto } from "@authz-demo/authz-types";
import { useForm } from "react-hook-form";
import { Check, CircleCheck, Globe, Loader2, Plus, Undo2, X } from "lucide-react";
import { z } from "zod";
import { Badge, Card, CardHead, LoadError, Skel } from "@/components/common";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { isApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { companyDomainsQuery, useDomainTransition, useProposeDomain } from "@/lib/queries-org";
import { DOMAIN_STATUS, orgErrorText } from "./messages";

const domainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Nhập tên miền")
    .max(253, "Tên miền tối đa 253 ký tự")
    .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, "Nhập dạng ten-mien.com, không kèm “@” hay “https://”"),
});

function AddDomainSheet({
  open,
  onOpenChange,
  company,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: OrgUnitTreeDto;
  onDone: (domain: DomainDto) => void;
}) {
  const propose = useProposeDomain(company.id);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<{ domain: string }>({ resolver: zodResolver(domainSchema), defaultValues: { domain: "" } });

  const close = () => {
    if (propose.isPending) return;
    onOpenChange(false);
    propose.reset();
    reset();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <SheetContent>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold">Thêm domain email</SheetTitle>
            <SheetDescription className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">
              Email có đuôi domain này sẽ được xếp vào “{company.name}”.
            </SheetDescription>
          </div>
          <SheetClose
            aria-label="Đóng"
            className="-mr-2 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted outline-hidden hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
          >
            <X className="size-4" aria-hidden />
          </SheetClose>
        </div>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5"
          onSubmit={handleSubmit(({ domain }) =>
            propose.mutate(domain, {
              onSuccess: (created) => {
                onOpenChange(false);
                propose.reset();
                reset();
                onDone(created);
              },
            }),
          )}
        >
          <div>
            <label htmlFor="domain-name" className="mb-1.5 block text-sm font-medium">
              Tên miền
            </label>
            <Input
              id="domain-name"
              autoFocus
              inputMode="url"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              placeholder="acme.example"
              maxLength={253}
              aria-invalid={!!errors.domain}
              aria-describedby="domain-hint domain-error"
              {...register("domain")}
            />
            {errors.domain ? (
              <p id="domain-error" role="alert" className="mt-1.5 text-sm text-red-600">
                {errors.domain.message}
              </p>
            ) : null}
            <p id="domain-hint" className="mt-1.5 text-xs text-muted">
              Domain của công ty, không phải domain email công cộng như gmail.com. Quản trị tenant được kích hoạt ngay; người khác gửi đề xuất và chờ duyệt.
            </p>
          </div>
          {propose.isError ? (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {orgErrorText("propose", propose.error)}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={close} disabled={propose.isPending}>
              Huỷ
            </Button>
            <Button type="submit" variant="primary" disabled={propose.isPending} aria-busy={propose.isPending || undefined}>
              {propose.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              Thêm domain
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function RevokeDialog({
  domain,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  domain: DomainDto | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (domain: DomainDto) => void;
}) {
  return (
    <AlertDialog open={!!domain} onOpenChange={(open) => !open && !pending && onCancel()}>
      <AlertDialogContent>
        <AlertDialogTitle className="text-base font-semibold">Thu hồi domain này?</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="mt-2 flex flex-col gap-2 text-sm text-muted [overflow-wrap:anywhere]">
            <p>
              Domain <span className="font-medium text-foreground">{domain?.domain}</span> sẽ ngừng được dùng để xếp email vào công ty.
            </p>
            {domain && domain.affectedUsers > 0 ? (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-amber-700">
                Ảnh hưởng {domain.affectedUsers} người dùng đang có email thuộc domain này. Họ có thể mất liên kết với công ty.
              </p>
            ) : (
              <p>Hiện chưa có người dùng nào có email thuộc domain này.</p>
            )}
          </div>
        </AlertDialogDescription>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel className={buttonClasses("outline")} disabled={pending}>
            Huỷ
          </AlertDialogCancel>
          <Button variant="danger" disabled={pending} aria-busy={pending || undefined} onClick={() => domain && onConfirm(domain)}>
            {pending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            Thu hồi domain
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const small = "min-h-9 px-3";

function DomainRow({
  domain,
  busy,
  anyBusy,
  onAction,
  onRevoke,
}: {
  domain: DomainDto;
  busy: "approve" | "reject" | null;
  anyBusy: boolean;
  onAction: (domain: DomainDto, action: "approve" | "reject") => void;
  onRevoke: (domain: DomainDto) => void;
}) {
  const status = DOMAIN_STATUS[domain.status];
  const actions = domain._actions;
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-sm font-medium" title={domain.domain}>
          {domain.domain}
        </span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 text-xs text-muted [overflow-wrap:anywhere]">
          {domain.requestedBy ? `Đề xuất bởi ${domain.requestedBy.displayName}` : "Không rõ người đề xuất"} · {formatDate(domain.createdAt)}
          {domain.decidedAt ? ` · Xử lý ${formatDate(domain.decidedAt)}` : ""}
          {domain.status === "ACTIVE" ? ` · ${domain.affectedUsers} người dùng` : ""}
        </p>
        {actions.length > 0 ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {actions.includes("approve") ? (
              <Button
                variant="secondary"
                className={small}
                disabled={anyBusy}
                aria-busy={busy === "approve" || undefined}
                onClick={() => onAction(domain, "approve")}
                aria-label={`Duyệt domain ${domain.domain}`}
              >
                {busy === "approve" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Check aria-hidden />}
                Duyệt
              </Button>
            ) : null}
            {actions.includes("reject") ? (
              <Button
                className={small}
                disabled={anyBusy}
                aria-busy={busy === "reject" || undefined}
                onClick={() => onAction(domain, "reject")}
                aria-label={`Từ chối domain ${domain.domain}`}
              >
                {busy === "reject" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <X aria-hidden />}
                Từ chối
              </Button>
            ) : null}
            {actions.includes("revoke") ? (
              <Button variant="danger" className={small} onClick={() => onRevoke(domain)} aria-label={`Thu hồi domain ${domain.domain}`}>
                <Undo2 aria-hidden />
                Thu hồi
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function DomainSection({ company, canPropose }: { company: OrgUnitTreeDto; canPropose: boolean }) {
  const query = useQuery({ ...companyDomainsQuery(company.id), retry: false });
  const transition = useDomainTransition(company.id);
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<DomainDto | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const run = (domain: DomainDto, action: "approve" | "reject") => {
    setNotice(null);
    transition.mutate(
      { id: domain.id, action },
      {
        onSuccess: () => setNotice({ tone: "ok", text: action === "approve" ? `Đã duyệt domain ${domain.domain}.` : `Đã từ chối domain ${domain.domain}.` }),
        onError: (error) => setNotice({ tone: "error", text: orgErrorText(action, error) }),
      },
    );
  };

  const busy = transition.isPending && transition.variables.action !== "revoke" ? transition.variables : null;

  let body;
  if (query.isPending) {
    body = (
      <div aria-busy aria-label="Đang tải domain" className="flex flex-col gap-4 px-4 pb-5 sm:px-5">
        <Skel className="h-4 w-2/3" />
        <Skel className="h-4 w-1/2" />
        <Skel className="h-4 w-3/5" />
      </div>
    );
  } else if (query.isError) {
    body = isApiError(query.error, "forbidden") || isApiError(query.error, "not_found") ? (
      <p className="px-4 pb-5 text-sm text-muted sm:px-5">Bạn không có quyền xem domain của công ty này.</p>
    ) : (
      <LoadError title="Không tải được domain" why="Kiểm tra kết nối rồi thử lại." onRetry={() => query.refetch()} />
    );
  } else if (query.data.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-3 px-4 pt-2 pb-8 text-center">
        <Globe className="size-6 text-muted" aria-hidden />
        <div>
          <p className="text-sm font-medium">Công ty chưa có domain email</p>
          <p className="mt-1 text-sm text-muted">Thêm domain để email của nhân viên tự xếp vào công ty này.</p>
        </div>
        {canPropose ? (
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Thêm domain
          </Button>
        ) : null}
      </div>
    );
  } else {
    body = (
      <ul className="divide-y divide-border border-t border-border">
        {query.data.map((domain) => (
          <DomainRow
            key={domain.id}
            domain={domain}
            busy={busy?.id === domain.id ? (busy.action as "approve" | "reject") : null}
            anyBusy={busy !== null}
            onAction={run}
            onRevoke={(d) => {
              transition.reset();
              setRevoking(d);
            }}
          />
        ))}
      </ul>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 pr-4 sm:pr-5">
        <div className="min-w-0 flex-1">
          <CardHead title="Domain email" meta={query.data ? `${query.data.length} domain` : undefined} />
        </div>
        {canPropose && query.data && query.data.length > 0 ? (
          <Button className="mt-3 min-h-9 px-3" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Thêm domain
          </Button>
        ) : null}
      </div>
      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            notice.tone === "error"
              ? "mx-4 mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-5"
              : "mx-4 mb-3 flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 sm:mx-5"
          }
        >
          {notice.tone === "ok" ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
          <span className="[overflow-wrap:anywhere]">{notice.text}</span>
        </div>
      ) : null}
      {body}

      <AddDomainSheet
        open={adding}
        onOpenChange={setAdding}
        company={company}
        onDone={(created) =>
          setNotice({
            tone: "ok",
            text:
              created.status === "ACTIVE"
                ? `Domain ${created.domain} đã được kích hoạt ngay.`
                : `Đã gửi đề xuất domain ${created.domain}. Domain đang chờ quản trị tenant duyệt, chưa có hiệu lực.`,
          })
        }
      />
      <RevokeDialog
        domain={revoking}
        pending={transition.isPending && transition.variables.action === "revoke"}
        error={transition.isError && transition.variables.action === "revoke" ? orgErrorText("revoke", transition.error) : null}
        onCancel={() => {
          transition.reset();
          setRevoking(null);
        }}
        onConfirm={(domain) => {
          setNotice(null);
          transition.mutate(
            { id: domain.id, action: "revoke" },
            {
              onSuccess: () => {
                setRevoking(null);
                setNotice({ tone: "ok", text: `Đã thu hồi domain ${domain.domain}.` });
              },
            },
          );
        }}
      />
    </Card>
  );
}

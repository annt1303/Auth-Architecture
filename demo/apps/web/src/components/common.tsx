import type { ReactNode } from "react";
import type { OrgUnitType, ScopeDto } from "@authz-demo/authz-types";
import { Briefcase, Building2, FileText, Globe, RotateCw, User, Users, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ORG_TYPE_LABEL, SCOPE_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

// Hợp đồng nguyên tố (D1) dùng chung cho mọi màn. Class chép từ wireframe đã duyệt.

const TONE = {
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  neutral: "bg-zinc-100 text-zinc-600",
  error: "bg-red-50 text-red-700",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ring-1 ring-black/5 ring-inset",
        TONE[tone],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

export const DocumentStatusBadge = ({ status }: { status: "DRAFT" | "PUBLISHED" }) =>
  status === "PUBLISHED" ? <Badge tone="success">Đã phát hành</Badge> : <Badge tone="neutral">Nháp</Badge>;

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-zinc-600">
      {children}
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn("font-mono text-xs text-muted", className)}>{children}</code>;
}

const AVATAR_TONES = [
  "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "bg-sky-50 text-sky-700 ring-sky-200",
  "bg-indigo-50 text-indigo-700 ring-indigo-200",
  "bg-pink-50 text-pink-700 ring-pink-200",
  "bg-amber-50 text-amber-700 ring-amber-200",
  "bg-violet-50 text-violet-700 ring-violet-200",
];

// components/avatar.md: chữ cái đầu trên nền pastel, màu theo seed (id hoặc email), không theo tên.
export function Avatar({ seed, name, className = "size-8 text-xs" }: { seed: string; name: string; className?: string }) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-1",
        AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length],
        className,
      )}
    >
      {name.trim().charAt(0).toLocaleUpperCase("vi")}
    </span>
  );
}

const ORG_ICON: Record<OrgUnitType, LucideIcon> = { COMPANY: Building2, DEPARTMENT: Briefcase, TEAM: Users };

export function UnitLabel({ name, type, extra }: { name: string; type: OrgUnitType; extra?: ReactNode }) {
  const Icon = ORG_ICON[type];
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 truncate" title={name}>
        {name}
      </span>
      <Tag>{ORG_TYPE_LABEL[type]}</Tag>
      {extra}
    </span>
  );
}

const SCOPE_ICON: Record<ScopeDto["type"], LucideIcon> = {
  TENANT: Globe,
  COMPANY: Building2,
  DEPARTMENT: Briefcase,
  TEAM: Users,
  RESOURCE: FileText,
  SELF: User,
};

export function ScopeLabel({ scope, extra }: { scope: ScopeDto; extra?: ReactNode }) {
  const Icon = SCOPE_ICON[scope.type];
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 truncate" title={scope.label}>
        {scope.label}
      </span>
      {scope.type !== "TENANT" && scope.type !== "SELF" ? <Tag>{SCOPE_TYPE_LABEL[scope.type]}</Tag> : null}
      {extra}
    </span>
  );
}

export function Card({ children, className, ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("rounded-2xl border border-border bg-surface", className)} {...props}>
      {children}
    </section>
  );
}

export function CardHead({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {meta ? <p className="shrink-0 text-xs text-muted">{meta}</p> : null}
    </div>
  );
}

// components/description-list.md: khuôn đổi theo bề rộng <dl> (@container).
export function DlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 @sm:grid-cols-[7rem_minmax(0,1fr)] @sm:items-baseline @sm:gap-6 @xl:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 font-medium text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

// Email xuống dòng nguyên cụm, chỉ bẻ sau "@" khi dài hơn cả dòng (description-list.md, EmailText).
export function EmailText({ email, suffix = "" }: { email: string; suffix?: string }) {
  const at = email.lastIndexOf("@");
  if (at < 0) return <span className="wrap-anywhere">{email + suffix}</span>;
  return (
    <span className="inline-block max-w-full wrap-anywhere">
      <span className="inline-block max-w-full">{email.slice(0, at + 1)}</span>
      <span className="inline-block max-w-full">
        {email.slice(at + 1)}
        {suffix}
      </span>
    </span>
  );
}

// Cắt phần trước "@", giữ tên miền (overlay.md, "Cắt email").
export function AccountEmail({ email }: { email: string }) {
  const at = email.lastIndexOf("@");
  return (
    <span className="flex min-w-0 text-xs text-muted" title={email}>
      <span className="min-w-0 truncate">{email.slice(0, at)}</span>
      <span className="max-w-full shrink-0 truncate">{email.slice(at)}</span>
    </span>
  );
}

export function Skel({ className }: { className: string }) {
  return <div className={cn("h-3 animate-pulse rounded-full bg-foreground/5 motion-reduce:animate-none", className)} />;
}

// components/empty-state.md, "Lỗi tải": hai tầng, nút viền "Thử lại".
export function LoadError({ title, why, onRetry }: { title: string; why: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
      <div>
        <p className="text-sm font-medium text-red-600">{title}</p>
        <p className="mt-1 text-sm text-muted">{why}</p>
      </div>
      <Button onClick={onRetry}>
        <RotateCw aria-hidden />
        Thử lại
      </Button>
    </div>
  );
}

// Dấu sản phẩm, hướng 1: chữ A dựng từ hai thanh, chấm tròn thay gạch ngang. Có logo thật thì thay path ở đây.
export function ProductMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M10.2 4h3.6L19.5 20h-3.7L12 9.1 8.2 20H4.5z" />
      <circle cx="12" cy="17.2" r="1.5" />
    </svg>
  );
}

export function ProductBrand({ className }: { className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ProductMark className="size-5" />
      </span>
      <span className="truncate text-sm font-semibold text-foreground">Authz Demo</span>
    </span>
  );
}

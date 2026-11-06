import { Input } from "@/components/ui/input";
import { FieldError, Label } from "./shared";

// Thời hạn nhập theo ngày (giờ địa phương). Rỗng = không giới hạn phía đó.
const pad = (n: number) => String(n).padStart(2, "0");

export const toDateInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// validFrom: đầu ngày; validUntil: hết ngày (23:59:59), để "đến ngày X" gồm cả ngày X.
export const fromDateInput = (value: string, end: boolean) => {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return (end ? new Date(y!, m! - 1, d, 23, 59, 59) : new Date(y!, m! - 1, d, 0, 0, 0)).toISOString();
};

export function validityError(from: string, until: string): string | undefined {
  if (from && until && until < from) return "Ngày kết thúc phải sau hoặc bằng ngày bắt đầu";
  return undefined;
}

export function ValidityFields({
  from,
  until,
  onFrom,
  onUntil,
  error,
  idPrefix,
}: {
  from: string;
  until: string;
  onFrom: (value: string) => void;
  onUntil: (value: string) => void;
  error?: string;
  idPrefix: string;
}) {
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${idPrefix}-from`}>Có hiệu lực từ</Label>
          <Input id={`${idPrefix}-from`} type="date" value={from} onChange={(e) => onFrom(e.target.value)} aria-describedby={`${idPrefix}-error`} />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-until`}>Hết hạn vào</Label>
          <Input
            id={`${idPrefix}-until`}
            type="date"
            value={until}
            min={from || undefined}
            onChange={(e) => onUntil(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={`${idPrefix}-error`}
          />
        </div>
      </div>
      <FieldError id={`${idPrefix}-error`} message={error} />
      <p className="mt-1.5 text-xs text-muted">Để trống nếu không giới hạn. Hết hạn vào ngày nào thì còn hiệu lực đến hết ngày đó.</p>
    </div>
  );
}

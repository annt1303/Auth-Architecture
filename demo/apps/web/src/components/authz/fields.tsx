import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { inputClasses } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type Option = { value: string; label: string; disabled?: boolean };
export type OptionGroup = { label: string; options: Option[] };

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// Select gốc của trình duyệt (đọc được bằng bàn phím và trình đọc màn hình), chỉ đổi mũi tên cho đồng bộ với Input.
export function SelectField({
  label,
  value,
  onChange,
  options,
  groups,
  placeholder,
  hint,
  disabled,
  loading,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: Option[];
  groups?: OptionGroup[];
  placeholder: string;
  hint?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <Field id={id} label={label} hint={hint}>
        <div className="relative">
          <select
            id={id}
            value={value}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            aria-describedby={hint ? `${id}-hint` : undefined}
            onChange={(event) => onChange(event.target.value)}
            className={cn(inputClasses, "cursor-pointer appearance-none pr-10 disabled:cursor-not-allowed disabled:opacity-50", !value && "text-muted")}
          >
            <option value="">{loading ? "Đang tải…" : placeholder}</option>
            {options?.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
            {groups?.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
        </div>
      </Field>
    </div>
  );
}

export function TabBar<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-tab-rail p-1">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "h-8 shrink-0 cursor-pointer rounded-lg px-3 text-sm font-medium whitespace-nowrap outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-focus",
              active ? "bg-surface text-foreground shadow-segment-thumb" : "text-foreground/70 hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

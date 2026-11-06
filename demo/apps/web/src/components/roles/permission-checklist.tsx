import { useMemo } from "react";
import type { PermissionDto } from "@authz-demo/authz-types";
import { Lock } from "lucide-react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { Mono, Tag } from "@/components/common";
import { permissionLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RiskBadge, resourceTypeLabel } from "./labels";

export const LOCKED_HINT = "Bạn chưa có quyền này tại phạm vi của role nên không thể thêm vào";

type Props = {
  catalog: PermissionDto[];
  selected: ReadonlySet<string>;
  // Gợi ý UX: actor có quyền này tại phạm vi của role không. API mới quyết định.
  canGrant: (permission: string) => boolean;
  readOnly?: boolean;
  onToggle: (permission: string, checked: boolean) => void;
};

function Row({ permission, checked, locked, canGrant, readOnly, onToggle }: {
  permission: PermissionDto;
  checked: boolean;
  locked: boolean; // không có quyền và chưa chọn: khóa
  canGrant: boolean;
  readOnly: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const disabled = readOnly || locked;
  const hintId = `perm-hint-${permission.key}`;
  const row = (
    <label
      className={cn(
        "flex gap-3 rounded-xl px-3 py-2.5 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-focus",
        disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-item-hover",
        locked && "opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={locked ? hintId : undefined}
        onChange={(event) => onToggle(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-[inherit] accent-primary outline-hidden"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{permissionLabel(permission.key)}</span>
          <RiskBadge risk={permission.riskLevel} />
          {permission.tenantScopeOnly ? <Tag>Chỉ TENANT</Tag> : null}
        </span>
        <Mono className="mt-0.5 block break-all">{permission.key}</Mono>
        <span className="mt-1 block text-xs text-muted">{permission.description}</span>
        {locked ? (
          <span id={hintId} className="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
            {LOCKED_HINT}
          </span>
        ) : null}
        {checked && !readOnly && !canGrant ? (
          <span className="mt-1 block text-xs text-muted">Bạn không có quyền này nên chỉ bỏ đi được, không thêm lại được.</span>
        ) : null}
      </span>
    </label>
  );
  if (!locked) return row;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{row}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-[60] max-w-xs rounded-lg bg-foreground px-3 py-2 text-xs text-white shadow-popover"
        >
          {LOCKED_HINT}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function PermissionChecklist({ catalog, selected, canGrant, readOnly = false, onToggle }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, PermissionDto[]>();
    for (const permission of catalog) map.set(permission.resourceType, [...(map.get(permission.resourceType) ?? []), permission]);
    return [...map.entries()];
  }, [catalog]);

  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <div className="flex flex-col gap-4">
        {groups.map(([type, items]) => {
          const count = items.filter((p) => selected.has(p.key)).length;
          const headingId = `perm-group-${type}`;
          return (
            <fieldset key={type} aria-labelledby={headingId} className="min-w-0">
              <div className="mb-1 flex items-baseline justify-between gap-3 px-3">
                <h4 id={headingId} className="text-xs font-semibold tracking-wide text-muted uppercase">
                  {resourceTypeLabel(type)}
                </h4>
                <span className="text-xs text-muted tabular-nums">
                  {count}/{items.length}
                </span>
              </div>
              {items.map((permission) => {
                const checked = selected.has(permission.key);
                return (
                  <Row
                    key={permission.key}
                    permission={permission}
                    checked={checked}
                    locked={!readOnly && !checked && !canGrant(permission.key)}
                    canGrant={canGrant(permission.key)}
                    readOnly={readOnly}
                    onToggle={(value) => onToggle(permission.key, value)}
                  />
                );
              })}
            </fieldset>
          );
        })}
      </div>
    </TooltipPrimitive.Provider>
  );
}

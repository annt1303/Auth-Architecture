import { useMemo, useState } from "react";
import type { OrgUnitTreeDto } from "@authz-demo/authz-types";
import { Collapsible } from "radix-ui";
import { Archive, ChevronRight, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { UnitLabel } from "@/components/common";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CHILD_TYPES } from "./messages";

export type TreeNode = { unit: OrgUnitTreeDto; children: TreeNode[] };

// Đơn vị có cha không nhìn thấy được (không nằm trong danh sách) thì coi là gốc.
export function buildOrgTree(units: OrgUnitTreeDto[]): TreeNode[] {
  const nodes = new Map(units.map((unit) => [unit.id, { unit, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.unit.parentId ? nodes.get(node.unit.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

export type TreeActions = {
  onCreateChild: (unit: OrgUnitTreeDto) => void;
  onRename: (unit: OrgUnitTreeDto) => void;
  onArchive: (unit: OrgUnitTreeDto) => void;
};

type NodeProps = TreeActions & {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: Set<string>;
  toggle: (id: string) => void;
};

function TreeItem({ node, depth, selectedId, onSelect, collapsed, toggle, ...actions }: NodeProps) {
  const { unit, children } = node;
  const hasChildren = children.length > 0;
  const open = !collapsed.has(unit.id);
  const selected = selectedId === unit.id;
  const canManage = unit._actions.includes("manage");
  const canAddChild = CHILD_TYPES[unit.type].length > 0;

  return (
    <li>
      <Collapsible.Root open={open} onOpenChange={() => toggle(unit.id)}>
        <div
          style={{ paddingLeft: `${depth * 1.25}rem` }}
          className={cn("flex items-center gap-1 rounded-xl transition-colors", selected ? "bg-secondary" : "hover:bg-item-hover")}
        >
          {hasChildren ? (
            <Collapsible.Trigger
              aria-label={`${open ? "Thu gọn" : "Mở rộng"} ${unit.name}`}
              className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
            >
              <ChevronRight className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
            </Collapsible.Trigger>
          ) : (
            <span className="size-10 shrink-0" aria-hidden />
          )}
          <button
            type="button"
            onClick={() => onSelect(unit.id)}
            aria-current={selected ? "true" : undefined}
            className={cn(
              "flex min-h-10 min-w-0 flex-1 cursor-pointer items-center rounded-xl py-1.5 text-left text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-focus",
              selected && "font-medium",
            )}
          >
            <UnitLabel name={unit.name} type={unit.type} />
          </button>
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Hành động cho ${unit.name}`}
                className="mr-1 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted outline-hidden hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-foreground/5"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canAddChild ? (
                  <DropdownMenuItem onSelect={() => actions.onCreateChild(unit)}>
                    <Plus aria-hidden />
                    Tạo đơn vị con
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => actions.onRename(unit)}>
                  <Pencil aria-hidden />
                  Đổi tên
                </DropdownMenuItem>
                <DropdownMenuItem variant="danger" onSelect={() => actions.onArchive(unit)}>
                  <Archive aria-hidden />
                  Lưu trữ
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {hasChildren ? (
          <Collapsible.Content>
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {children.map((child) => (
                <TreeItem
                  key={child.unit.id}
                  node={child}
                  depth={depth + 1}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  collapsed={collapsed}
                  toggle={toggle}
                  {...actions}
                />
              ))}
            </ul>
          </Collapsible.Content>
        ) : null}
      </Collapsible.Root>
    </li>
  );
}

export function OrgTree({
  units,
  selectedId,
  onSelect,
  ...actions
}: TreeActions & { units: OrgUnitTreeDto[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const roots = useMemo(() => buildOrgTree(units), [units]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <ul aria-label="Cây đơn vị" className="flex flex-col gap-0.5 p-2">
      {roots.map((node) => (
        <TreeItem key={node.unit.id} node={node} depth={0} selectedId={selectedId} onSelect={onSelect} collapsed={collapsed} toggle={toggle} {...actions} />
      ))}
    </ul>
  );
}

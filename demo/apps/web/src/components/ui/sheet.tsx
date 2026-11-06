import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

// layouts/overlay.md, Panel trượt: lớp phủ black/15, chỉ translate, vào 500ms ra 350ms cubic-bezier(0.32,0.72,0,1).
const Sheet = SheetPrimitive.Root;
const SheetClose = SheetPrimitive.Close;
const SheetTitle = SheetPrimitive.Title;
const SheetDescription = SheetPrimitive.Description;

const motion =
  "ease-[cubic-bezier(0.32,0.72,0,1)] data-open:animate-in data-open:duration-500 data-closed:animate-out data-closed:duration-350 motion-reduce:animate-none";

function SheetContent({
  className,
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "left" | "right" }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className={cn("fixed inset-0 z-50 bg-black/15 data-open:fade-in-0 data-closed:fade-out-0", motion)}
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 z-50 flex flex-col bg-surface text-foreground shadow-modal outline-hidden",
          motion,
          side === "right" &&
            "right-0 w-full border-l border-border sm:w-[28rem] data-open:slide-in-from-right data-closed:slide-out-to-right",
          side === "left" &&
            "left-0 w-[280px] border-r border-border data-open:slide-in-from-left data-closed:slide-out-to-left",
          className,
        )}
        {...props}
      />
    </SheetPrimitive.Portal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetTitle, SheetDescription };

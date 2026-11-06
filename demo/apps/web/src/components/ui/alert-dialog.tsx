import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

// layouts/overlay.md, Hộp xác nhận: max-w-md, lớp phủ black/30, mờ + scale-95, vào 150ms ra 100ms.
const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTitle = AlertDialogPrimitive.Title;
const AlertDialogDescription = AlertDialogPrimitive.Description;
const AlertDialogCancel = AlertDialogPrimitive.Cancel;

function AlertDialogContent({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-open:animate-in data-open:fade-in-0 data-open:duration-150 data-closed:animate-out data-closed:fade-out-0 data-closed:duration-100" />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        <AlertDialogPrimitive.Content
          data-slot="alert-dialog-content"
          className={cn(
            "pointer-events-auto w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-foreground shadow-modal outline-hidden",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:duration-150 data-open:ease-out",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-100 data-closed:ease-in motion-reduce:animate-none",
            className,
          )}
          {...props}
        />
      </div>
    </AlertDialogPrimitive.Portal>
  );
}

export { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel };

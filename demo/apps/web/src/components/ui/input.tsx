import * as React from "react";
import { cn } from "@/lib/utils";

// components/input.md: nền surface (không trong suốt), viền border-strong, focus viền nhấn + ring mờ.
// Lỗi: viền đỏ, quầng đỏ chỉ khi đang gõ.
export const inputClasses =
  "h-11 w-full min-w-0 rounded-xl border border-border-strong bg-surface px-4 text-base text-foreground outline-hidden transition-colors placeholder:text-muted focus:border-focus focus:ring-2 focus:ring-focus md:h-10 md:text-sm aria-invalid:border-red-500 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-500/10";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(inputClasses, className)} {...props} />;
}

export { Input };

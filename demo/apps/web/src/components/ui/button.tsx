import * as React from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

// Bốn dạng của skill (I1) cộng nút nguy hiểm (I4). Mặc định là nút viền. Không prop size:
// nút khác cỡ truyền className (thấp hơn 40px thì truyền cả min-h-*).
export type ButtonVariant = "outline" | "primary" | "secondary" | "ghost" | "danger";

function getVariantClasses(variant: ButtonVariant): string {
  return cn(
    variant === "outline" && "border border-border-strong bg-surface text-foreground hover:bg-button-hover",
    variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary-hover",
    variant === "secondary" && "bg-secondary text-foreground hover:bg-secondary-hover",
    variant === "ghost" && "bg-transparent text-muted hover:bg-foreground/5 hover:text-foreground",
    variant === "danger" && "bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 hover:text-rose-700",
  );
}

export const buttonBaseClasses =
  "relative inline-flex min-h-10 max-w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2 text-center text-sm leading-tight font-medium outline-hidden transition-colors [overflow-wrap:anywhere] aria-busy:cursor-progress disabled:cursor-not-allowed disabled:not-aria-busy:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

export function buttonClasses(variant: ButtonVariant = "outline", className?: string) {
  return cn(buttonBaseClasses, getVariantClasses(variant), className);
}

type ButtonProps = React.ComponentProps<"button"> & { variant?: ButtonVariant; asChild?: boolean };

function Button({ className, variant = "outline", asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : (type ?? "button")}
      className={buttonClasses(variant, className)}
      {...props}
    />
  );
}

export { Button };

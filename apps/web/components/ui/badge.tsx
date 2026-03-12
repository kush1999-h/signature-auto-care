import clsx from "clsx";
import { HTMLAttributes } from "react";

type Variant = "default" | "secondary" | "warning" | "success" | "danger";

export function Badge({ className, variant = "default", ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  const variants: Record<Variant, string> = {
    default: "bg-primary/15 text-primary border border-primary/25",
    secondary: "bg-muted text-foreground border border-border",
    warning: "bg-[var(--warning-bg)] text-[var(--warning-text)] border border-[var(--warning-border)]",
    success: "bg-[var(--success-bg)] text-[var(--success-text)] border border-[var(--success-border)]",
    danger: "bg-[var(--danger-bg)] text-[var(--danger-text)] border border-[var(--danger-border)]"
  };
  return <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium", variants[variant], className)} {...props} />;
}

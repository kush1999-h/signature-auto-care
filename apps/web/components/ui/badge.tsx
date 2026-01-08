import clsx from "clsx";
import { HTMLAttributes } from "react";

type Variant = "default" | "secondary" | "warning" | "success";

export function Badge({ className, variant = "default", ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  const variants: Record<Variant, string> = {
    default: "bg-primary/20 text-primary border border-primary/40",
    secondary: "bg-muted text-foreground border border-border",
    warning: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
    success: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
  };
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", variants[variant], className)} {...props} />;
}

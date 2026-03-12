import { ReactNode } from "react";

type CollapsibleSectionProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

export function CollapsibleSection({
  title,
  description,
  actions,
  defaultOpen = true,
  children,
  className = "",
}: CollapsibleSectionProps) {
  return (
    <details
      open={defaultOpen}
      className={`rounded-xl border border-border bg-card/40 p-3 sm:p-4 ${className}`.trim()}
    >
      <summary className="flex cursor-pointer list-none flex-col gap-2 sm:flex-row sm:items-start sm:justify-between [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{title}</p>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex items-center gap-2 self-start">
          {actions}
          <span className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground">
            Toggle
          </span>
        </div>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

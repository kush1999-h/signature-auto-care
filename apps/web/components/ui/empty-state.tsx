import { ReactNode } from "react";
import clsx from "clsx";

type EmptyStateProps = {
  title: string;
  description?: string;
  className?: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "w-full rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm",
        className
      )}
    >
      <p className="font-semibold text-foreground">{title}</p>
      {description && <p className="text-muted-foreground mt-1">{description}</p>}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

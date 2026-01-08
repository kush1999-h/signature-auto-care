import clsx from "clsx";
import { ReactNode } from "react";
import { Button } from "./button";

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
  actionLabel?: string;
  className?: string;
  icon?: ReactNode;
};

export function ErrorState({ title = "Something went wrong", message, onRetry, actionLabel = "Retry", className, icon }: ErrorStateProps) {
  return (
    <div
      className={clsx(
        "w-full rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-5 text-sm text-foreground",
        className
      )}
    >
      <div className="flex items-start gap-3">
        {icon}
        <div className="flex-1">
          <p className="font-semibold text-foreground">{title}</p>
          <p className="text-muted-foreground mt-1">{message}</p>
          {onRetry && (
            <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
              {actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

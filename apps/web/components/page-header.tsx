"use client";

import { ReactNode } from "react";
import { Badge } from "./ui/badge";

type PageHeaderProps = {
  title: string;
  description?: string;
  meta?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, description, meta, badge, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">{title}</h1>
          {typeof badge === "string" || typeof badge === "number" ? (
            <Badge variant="secondary">{badge}</Badge>
          ) : (
            badge
          )}
        </div>
        {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        {meta && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>}
    </div>
  );
}

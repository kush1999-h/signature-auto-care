"use client";

import { ReactNode } from "react";
import clsx from "clsx";

type PageToolbarProps = {
  children: ReactNode;
  className?: string;
};

export function PageToolbar({ children, className }: PageToolbarProps) {
  return (
    <div className={clsx("glass rounded-xl p-3 sm:p-4", className)}>
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-between">{children}</div>
    </div>
  );
}

type PageToolbarSectionProps = {
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
};

export function PageToolbarSection({
  children,
  align = "start",
  className,
}: PageToolbarSectionProps) {
  return (
    <div
      className={clsx(
        "flex flex-1 flex-col gap-3 md:flex-row md:flex-wrap md:items-end",
        align === "end" && "md:justify-end 2xl:justify-end",
        className
      )}
    >
      {children}
    </div>
  );
}

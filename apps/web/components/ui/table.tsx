import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import clsx from "clsx";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={clsx("w-full border-collapse text-sm", className)} {...props} />;
}
export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={clsx("sticky top-0 z-[1] bg-[var(--surface-strong)] text-muted-foreground uppercase text-xs backdrop-blur-sm", className)} {...props} />;
}
export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={clsx("divide-y divide-border", className)} {...props} />;
}
export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={clsx("transition hover:bg-muted/70", className)} {...props} />;
}
export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={clsx("px-3 py-2.5 text-left font-medium whitespace-nowrap", className)} {...props} />;
}
export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={clsx("px-3 py-2.5 align-middle", className)} {...props} />;
}

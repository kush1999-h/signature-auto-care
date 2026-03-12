import clsx from "clsx";
import { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";

type Props = {
  title: string;
  value: string | number;
  subtitle?: string;
  accent?: "red" | "blue" | "gray";
  meta?: ReactNode;
  href?: Route;
};

export function MetricCard({ title, value, subtitle, accent = "red", meta, href }: Props) {
  const accents: Record<string, string> = {
    red: "from-primary/80 to-primary/40",
    blue: "from-accent/80 to-accent/40",
    gray: "from-muted to-muted"
  };
  const content = (
    <div className="glass relative overflow-hidden rounded-xl p-4 sm:p-5">
      <div className={clsx("absolute inset-0 opacity-30 bg-gradient-to-br", accents[accent])}></div>
      <div className="relative">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="text-3xl font-semibold mt-1 text-foreground">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-2">{subtitle}</p>}
        {meta && <div className="mt-2">{meta}</div>}
      </div>
    </div>
  );
  if (!href) return content;
  return (
    <Link href={href} className="block rounded-xl transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      {content}
    </Link>
  );
}

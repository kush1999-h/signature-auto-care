import clsx from "clsx";
import { ReactNode } from "react";

type Props = {
  title: string;
  value: string | number;
  subtitle?: string;
  accent?: "red" | "blue" | "gray";
  meta?: ReactNode;
};

export function MetricCard({ title, value, subtitle, accent = "red", meta }: Props) {
  const accents: Record<string, string> = {
    red: "from-primary/80 to-primary/40",
    blue: "from-accent/80 to-accent/40",
    gray: "from-muted to-muted"
  };
  return (
    <div className="glass p-4 rounded-xl relative overflow-hidden">
      <div className={clsx("absolute inset-0 opacity-40 bg-gradient-to-br", accents[accent])}></div>
      <div className="relative">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="text-3xl font-semibold mt-1 text-foreground">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-2">{subtitle}</p>}
        {meta && <div className="mt-2">{meta}</div>}
      </div>
    </div>
  );
}

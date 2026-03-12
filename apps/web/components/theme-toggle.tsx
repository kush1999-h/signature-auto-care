"use client";

import clsx from "clsx";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={clsx(
        "inline-flex items-center rounded-xl border border-border bg-card/80 p-1 shadow-sm",
        compact ? "gap-1" : "gap-1.5"
      )}
    >
      <button
        type="button"
        onClick={() => setTheme("light")}
        aria-pressed={theme === "light"}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
          theme === "light" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:bg-muted"
        )}
      >
        <Sun size={14} />
        {!compact && "Light"}
      </button>
      <button
        type="button"
        onClick={() => setTheme("dark")}
        aria-pressed={theme === "dark"}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
          theme === "dark" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:bg-muted"
        )}
      >
        <Moon size={14} />
        {!compact && "Dark"}
      </button>
    </div>
  );
}

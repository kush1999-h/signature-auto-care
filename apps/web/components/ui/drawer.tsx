import { ReactNode } from "react";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  side?: "right" | "left";
  title?: string;
  children: ReactNode;
};

export function Drawer({ open, onClose, side = "right", title, children }: DrawerProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-[var(--overlay)]" onClick={onClose} />
      <div
        className={`w-full max-w-xl bg-[var(--surface-strong)] shadow-[var(--shadow-strong)] backdrop-blur-xl ${
          side === "left" ? "order-first border-r border-border" : "border-l border-border"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-semibold text-foreground">{title}</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            x
          </button>
        </div>
        <div className="max-h-screen overflow-y-auto p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

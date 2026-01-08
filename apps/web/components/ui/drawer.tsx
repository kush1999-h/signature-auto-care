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
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className={`w-full max-w-xl bg-card border-l border-border shadow-2xl ${side === "left" ? "order-first" : ""}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="font-semibold text-foreground">{title}</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto max-h-screen">{children}</div>
      </div>
    </div>
  );
}

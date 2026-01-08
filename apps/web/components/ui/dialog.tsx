import { ReactNode } from "react";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function Dialog({ open, onClose, title, children, footer }: DialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-semibold text-foreground">{title}</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close dialog">Close</button>
        </div>
        <div className="p-4 space-y-4">{children}</div>
        {footer && <div className="border-t border-border px-4 py-3 flex justify-end">{footer}</div>}
      </div>
    </div>
  );
}

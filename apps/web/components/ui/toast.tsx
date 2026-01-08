import { createContext, useContext, useState, ReactNode, useCallback } from "react";
import clsx from "clsx";

type Toast = { id: string; title: string; description?: ReactNode; variant?: "default" | "error" | "success" };

const ToastContext = createContext<{ show: (t: Omit<Toast, "id">) => void }>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((toast: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              "min-w-[240px] rounded-md border px-4 py-3 shadow-lg text-sm",
              toast.variant === "error" && "border-red-500/60 bg-red-500/20 text-red-100",
              toast.variant === "success" && "border-emerald-500/60 bg-emerald-500/20 text-emerald-50",
              (!toast.variant || toast.variant === "default") && "border-border bg-card text-foreground"
            )}
          >
            <p className="font-semibold">{toast.title}</p>
            {toast.description && <div className="text-xs text-muted-foreground mt-1">{toast.description}</div>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

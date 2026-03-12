import { forwardRef, InputHTMLAttributes } from "react";
import clsx from "clsx";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={clsx(
        "w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground shadow-sm transition focus:outline-none focus:ring-2 focus:ring-primary",
        className
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";

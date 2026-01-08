import clsx from "clsx";
import { KeyboardEvent, useCallback } from "react";

type Option = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SegmentedControlProps = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  "aria-label"?: string;
  disabled?: boolean;
};

export function SegmentedControl({ options, value, onChange, disabled, "aria-label": ariaLabel }: SegmentedControlProps) {
  const handleKey = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      let nextIndex = index + direction;
      while (nextIndex >= 0 && nextIndex < options.length && (options[nextIndex].disabled || disabled)) {
        nextIndex += direction;
      }
      if (nextIndex >= 0 && nextIndex < options.length) {
        onChange(options[nextIndex].value);
      }
    },
    [onChange, options, disabled]
  );

  return (
    <div className="inline-flex rounded-full border border-border bg-muted/50 p-1" role="group" aria-label={ariaLabel}>
      {options.map((opt, idx) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !disabled && !opt.disabled && onChange(opt.value)}
            onKeyDown={(e) => handleKey(e, idx)}
            disabled={disabled || opt.disabled}
            className={clsx(
              "px-3 py-1 text-xs font-semibold rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background transition-colors",
              isActive
                ? "bg-primary text-foreground shadow-sm"
                : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/10",
              (disabled || opt.disabled) && "opacity-60 cursor-not-allowed"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

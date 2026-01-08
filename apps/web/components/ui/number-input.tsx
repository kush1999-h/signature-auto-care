import clsx from "clsx";
import { ChangeEvent, InputHTMLAttributes } from "react";

type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "value"> & {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  allowEmpty?: boolean;
};

export function NumberInput({ value, onChange, className, min = 0, allowEmpty = true, step = "0.01", ...props }: NumberInputProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (next === "") {
      if (allowEmpty) onChange("");
      else onChange(min.toString());
      return;
    }
    const numeric = Number(next);
    if (!Number.isFinite(numeric)) return;
    if (min !== undefined && numeric < min) {
      onChange(min.toString());
      return;
    }
    onChange(next);
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      value={value}
      onChange={handleChange}
      className={clsx(
        "bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
        className
      )}
      {...props}
    />
  );
}

type CurrencyInputProps = NumberInputProps & { prefix?: string; inputClassName?: string };

export function CurrencyInput({ prefix = "Tk.", className, inputClassName, ...props }: CurrencyInputProps) {
  return (
    <div
      className={clsx(
        "flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40",
        className
      )}
    >
      <span className="text-xs text-muted-foreground">{prefix}</span>
      <NumberInput {...props} className={clsx("flex-1 border-0 bg-transparent px-0 py-0", inputClassName)} />
    </div>
  );
}

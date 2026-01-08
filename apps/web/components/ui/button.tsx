import {
  forwardRef,
  ButtonHTMLAttributes,
  cloneElement,
  isValidElement,
  ReactElement,
  Ref
} from "react";
import clsx from "clsx";

type Variant = "default" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  default: "bg-primary text-white hover:opacity-90",
  secondary: "bg-muted text-foreground hover:bg-border",
  outline: "border border-border text-foreground hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
  danger: "bg-red-600 text-white hover:bg-red-700"
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 py-1.5 text-sm",
  md: "h-10 px-4 py-2 text-sm",
  lg: "h-11 px-5 py-3 text-base"
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  asChild?: boolean;
};

export const Button = forwardRef<HTMLElement, ButtonProps>(
  ({ className, variant = "default", size = "md", isLoading, asChild, children, disabled, type, ...props }, ref) => {
    const classes = clsx(
      "inline-flex items-center justify-center gap-2 rounded-md font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 disabled:cursor-not-allowed",
      sizeClasses[size],
      variantClasses[variant],
      className
    );

    const content = (
      <>
        {isLoading && (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/60 border-t-transparent" aria-hidden />
        )}
        {children}
      </>
    );

    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement, {
        className: clsx(classes, (children as ReactElement).props?.className),
        children: content,
        "aria-disabled": disabled || isLoading,
        tabIndex: disabled ? -1 : (children as ReactElement).props?.tabIndex,
        ...("onClick" in props ? { onClick: props.onClick } : {}),
        ref
      });
    }

    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        className={classes}
        disabled={disabled || isLoading}
        type={type ?? "button"}
        {...props}
      >
        {content}
      </button>
    );
  }
);
Button.displayName = "Button";

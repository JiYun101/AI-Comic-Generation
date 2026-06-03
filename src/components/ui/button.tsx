import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90"
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2.5 text-xs",
        lg: "h-10 px-4",
        icon: "h-9 w-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function getTextFromChildren(children: React.ReactNode): string | undefined {
  const text = React.Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (React.isValidElement(child)) return getTextFromChildren((child.props as { children?: React.ReactNode }).children) ?? "";
      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, title, "aria-label": ariaLabel, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const resolvedTitle = title ?? ariaLabel ?? (!asChild ? getTextFromChildren(children) : undefined);
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} title={resolvedTitle} aria-label={ariaLabel} {...props}>
        {children}
      </Comp>
    );
  }
);

Button.displayName = "Button";

export { buttonVariants };

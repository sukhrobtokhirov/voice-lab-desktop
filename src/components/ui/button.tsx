import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap",
    "rounded-lg border border-transparent bg-clip-padding text-sm font-medium cursor-pointer select-none",
    "transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
    "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
    "active:not-aria-[haspopup]:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
    "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",

        // App-specific semantic variant retained for existing callers.
        success: ["bg-success text-success-foreground", "hover:bg-success/80"].join(" "),

        destructive: [
          "bg-destructive/10 text-destructive",
          "hover:bg-destructive/20",
          "focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
          "dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        ].join(" "),

        outline: [
          "border-border bg-background",
          "hover:bg-muted hover:text-foreground",
          "aria-expanded:bg-muted aria-expanded:text-foreground",
          "dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        ].join(" "),

        // App-specific flat outline retained for existing callers.
        "outline-flat": [
          "border-border bg-transparent text-muted-foreground",
          "hover:bg-muted hover:text-foreground",
          "dark:border-input dark:hover:bg-input/50",
        ].join(" "),

        secondary: [
          "bg-secondary text-secondary-foreground",
          "hover:bg-[color-mix(in_oklch,var(--color-secondary),var(--color-foreground)_5%)]",
          "aria-expanded:bg-[color-mix(in_oklch,var(--color-secondary),var(--color-foreground)_5%)]",
        ].join(" "),

        ghost: [
          "hover:bg-muted hover:text-foreground",
          "aria-expanded:bg-muted aria-expanded:text-foreground",
          "dark:hover:bg-muted/50 dark:aria-expanded:bg-muted/50",
        ].join(" "),

        link: "text-primary underline-offset-4 hover:underline",

        // App-specific auth variant retained for existing callers.
        social: [
          "border-border bg-background text-foreground",
          "hover:bg-muted",
          "dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        ].join(" "),
      },
      size: {
        default: "h-8 gap-1.5 px-2.5 has-[>svg]:px-2",
        sm: "h-7 gap-1 rounded-lg px-2 text-[0.8rem] has-[>svg]:px-1.5",
        lg: "h-9 gap-1.5 rounded-lg px-3 has-[>svg]:px-2.5",
        icon: "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button };

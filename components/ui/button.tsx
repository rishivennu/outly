"use client";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "ripple-host relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[transform,background-color,color,box-shadow,opacity] duration-200 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:text-muted-foreground [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90 disabled:[background:hsl(var(--secondary))] disabled:text-muted-foreground disabled:shadow-none disabled:brightness-100 disabled:ring-1 disabled:ring-inset disabled:ring-border",
        /** The Outlly action. Lime fill, lime-foreground ink, lime glow. */
        lime: "lime-bg lime-glow font-semibold hover:brightness-[1.06] disabled:[background:hsl(var(--secondary))] disabled:text-muted-foreground disabled:shadow-none disabled:brightness-100 disabled:ring-1 disabled:ring-inset disabled:ring-border",
        energy: "energy-bg text-[hsl(var(--lime-foreground))] font-semibold shadow-[0_10px_40px_-12px_hsl(var(--energy-b)/0.7)] hover:shadow-[0_14px_50px_-10px_hsl(var(--energy-b)/0.85)] disabled:[background:hsl(var(--secondary))] disabled:text-muted-foreground disabled:shadow-none disabled:brightness-100 disabled:ring-1 disabled:ring-inset disabled:ring-border",
        subtle: "bg-secondary text-secondary-foreground hover:bg-secondary/70 hairline",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        outline: "hairline text-foreground hover:bg-secondary",
        // Light mode ink is a shade deeper than --destructive: on its own 15% tint the base red is 4.27:1.
        danger: "bg-destructive/15 text-[hsl(0_72%_38%)] hover:bg-destructive/25 dark:text-destructive",
      },
      size: {
        sm: "h-9 px-3.5 text-[13px]",
        md: "h-11 px-5 text-sm",
        lg: "h-14 px-7 text-base",
        xl: "h-16 px-9 text-lg",
        icon: "h-11 w-11",
        "icon-sm": "h-9 w-9",
      },
    },
    defaultVariants: { variant: "subtle", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";
export { buttonVariants };

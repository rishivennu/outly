"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-12 w-full rounded-2xl bg-secondary/60 px-4 text-base text-foreground placeholder:text-muted-foreground/80 field-edge transition focus:bg-secondary focus-visible:outline-2",
      className,
    )}
    dir="auto"
    {...p}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full resize-none rounded-2xl bg-secondary/60 px-4 py-3 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/80 hairline transition focus:bg-secondary",
      className,
    )}
    dir="auto"
    {...p}
  />
));
Textarea.displayName = "Textarea";

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-2 flex items-center justify-between text-[13px] font-medium text-muted-foreground", className)} {...p} />;
}

export function Counter({ value, max }: { value: number; max: number }) {
  const over = value > max;
  const near = value > max * 0.9;
  return (
    <span className={cn("tabular text-xs", over ? "text-destructive" : near ? "text-warning" : "text-muted-foreground")} aria-live="polite">
      {value}/{max}
      <span className="sr-only">{over ? " characters, over the limit" : " characters"}</span>
    </span>
  );
}

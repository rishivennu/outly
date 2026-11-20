"use client";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/** Inputs and selects share one look: 48px tall, radius 12, tonal edge. */
export const CONTROL = "h-12 w-full rounded-xl bg-secondary/60 px-4 text-base text-foreground field-edge transition focus:bg-secondary focus-visible:outline-2";
export const ERROR_INK = "text-[hsl(0_72%_38%)] dark:text-destructive";

export function Field({ id, label, optional, hint, error, children, className }: { id: string; label: ReactNode; optional?: boolean; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={id}>
        <span>{label}</span>
        {optional && <span className="text-[12px] font-normal">Optional</span>}
      </Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
          {hint}
        </p>
      )}
      <FieldError id={id} error={error} />
    </div>
  );
}

export function FieldError({ id, error }: { id: string; error?: string }) {
  return (
    <p id={`${id}-err`} className={cn("text-[13px] leading-snug", ERROR_INK, error && "mt-1.5")}>
      {error}
    </p>
  );
}

/** aria wiring for a control: invalid flag plus the hint and the error it is described by. */
export const describe = (id: string, error?: string, hint?: boolean) => ({
  id,
  "aria-invalid": error ? (true as const) : undefined,
  "aria-describedby": [hint ? `${id}-hint` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined,
});

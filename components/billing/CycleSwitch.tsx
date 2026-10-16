"use client";
import { cn } from "@/lib/utils";
import type { Cycle } from "@/lib/billing/cycle";

/** Monthly / Yearly segmented switch, with the yearly saving as a badge. */
export function CycleSwitch({ value, onChange, save, className }: { value: Cycle; onChange: (c: Cycle) => void; save: number; className?: string }) {
  const opt = (c: Cycle, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === c}
      onClick={() => onChange(c)}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors duration-300",
        value === c ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {c === "year" && save > 0 && (
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", value === c ? "bg-lime text-[hsl(var(--lime-foreground))]" : "bg-lime/20 text-lime-ink")}>Save {save}%</span>
      )}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Billing period" className={cn("inline-flex rounded-full bg-secondary/70 p-1 hairline", className)}>
      {opt("month", "Monthly")}
      {opt("year", "Yearly")}
    </div>
  );
}

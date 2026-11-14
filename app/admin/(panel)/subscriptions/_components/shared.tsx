"use client";
import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/billing/money";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/admin/ui";

export const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "n/a" : `${Math.round(n * 1000) / 10}%`);
export const inr = (paise: number) => formatMoney(Math.round(paise), "INR");
export const money = (minor: number | null | undefined, cur: string) => (minor == null ? "n/a" : formatMoney(minor, cur));
export const TIER_LABEL: Record<string, string> = { intro: "First-time", standard: "Returning", legacy: "Legacy", founding: "Founding" };

export function Switch({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-2xl bg-secondary/40 px-4 py-2 hairline">
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{label}</span>
        {hint && <span className="block text-[12px] text-muted-foreground">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-300 peer-checked:after:translate-x-5 motion-reduce:after:transition-none" />
    </label>
  );
}

export const chip = (on: boolean) =>
  cn(
    "inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
    on ? "bg-foreground text-background" : "bg-secondary/60 text-muted-foreground hairline hover:text-foreground",
  );

/** Margin text with its meaning spelled out, never colour alone. */
export function MarginBadge({ margin, target }: { margin: number | null; target: number }) {
  if (margin == null) return <span className="text-muted-foreground">n/a</span>;
  const ok = margin >= target - 1e-9;
  return <Pill tone={ok ? "ok" : "bad"} className="tabular">{pct(margin)} {ok ? "ok" : "below target"}</Pill>;
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-secondary/40 px-4 py-3 hairline">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-display text-[1.35rem] font-semibold tabular">{value}</p>
      {hint && <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

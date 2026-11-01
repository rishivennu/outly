"use client";
import { useEffect, useState } from "react";
import type { FunnelStep } from "@/lib/growth/core";
import { useSeen } from "@/components/dashboard/motion";
import { RollingNumber } from "@/components/dashboard/RollingNumber";

const pct = (n: number | null) => (n === null ? "" : `${Math.round(n * 100)}%`);

/**
 * The Growth signup funnel (1081, analytics motion): bars grow from the left one after another the first
 * time the funnel is seen, and counts roll up. Picking another range grows or shrinks each bar from where it
 * was, with no stagger. Bars are decorative (aria-hidden); the count and rate beside each carry the numbers.
 */
export function FunnelBars({ steps, worstKey }: { steps: FunnelStep[]; worstKey: string | null }) {
  const { ref, seen } = useSeen<HTMLOListElement>(0.2);
  const [stagger, setStagger] = useState(true);
  useEffect(() => {
    if (!seen) return;
    const t = setTimeout(() => setStagger(false), 80 * steps.length + 800);
    return () => clearTimeout(t);
  }, [seen, steps.length]);
  const top = Math.max(1, ...steps.map((s) => s.count));

  return (
    <ol ref={ref} className="grid gap-3">
      {steps.map((s, i) => {
        const w = Math.max(2, (s.count / top) * 100);
        const style = { "--cut": seen ? `${100 - w}%` : "100%", "--d": stagger ? `${i * 80}ms` : "0ms" } as React.CSSProperties;
        return (
          <li key={s.key} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[180px_1fr_120px]">
            <span className="text-[13.5px] font-semibold">{i + 1}. {s.label}</span>
            <span className="relative h-9 overflow-hidden rounded-xl bg-secondary/70" aria-hidden>
              <span className="grow-clip lime-bg absolute inset-0 rounded-xl" style={style} />
            </span>
            <span className="flex items-baseline gap-2 sm:justify-end">
              <RollingNumber value={s.count.toLocaleString("en-IN")} className="font-display text-[1.15rem] font-bold tabular" />
              {s.rate !== null && <span className={`text-[12.5px] tabular ${worstKey === s.key ? "pill-ink-bad font-semibold" : "text-muted-foreground"}`}>{pct(s.rate)}{s.lost ? `, ${s.lost.toLocaleString("en-IN")} lost` : ""}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

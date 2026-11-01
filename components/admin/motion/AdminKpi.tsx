"use client";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { RollingNumber } from "@/components/dashboard/RollingNumber";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { cn } from "@/lib/utils";

/** Colour of a trend line: is the second half of the window better than the first? Under 5% is flat. */
export function trendTone(data: number[], invert = false): "up" | "down" | "flat" {
  if (data.length < 4) return "flat";
  const h = Math.floor(data.length / 2);
  const avg = (a: number[]) => a.reduce((t, v) => t + v, 0) / (a.length || 1);
  const a = avg(data.slice(0, h));
  const b = avg(data.slice(h));
  const base = Math.max(Math.abs(a), 1e-9);
  if (a === b || Math.abs(b - a) / base < 0.05) return "flat";
  return b > a !== invert ? "up" : "down";
}

/**
 * An admin KPI card in the analytics style (1081): the number rolls up when the card enters, and when a
 * series is given a small trend line draws in beside it. Same data and wording as before; the line is
 * decorative (the number, change and caption carry the meaning).
 */
export function AdminKpi({ label, value, sub, change, invert, tone, spark, i = 0 }: { label: string; value: string; sub?: string; change?: number | null; invert?: boolean; tone?: "bad"; spark?: number[]; i?: number }) {
  const up = (change ?? 0) >= 0;
  const good = invert ? !up : up;
  return (
    <div data-enter className="admin-card kpi-card flex min-w-0 flex-col rounded-[24px] bg-card p-5 hairline">
      <p className="text-[12.5px] font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 flex min-w-0 items-end justify-between gap-3">
        <RollingNumber value={value} className={cn("block min-w-0 font-display text-[1.85rem] font-bold leading-none tracking-[-0.03em] tabular", tone === "bad" && "text-destructive")} />
        {spark && spark.length > 1 && (
          <div className="w-[42%] max-w-[110px] shrink-0">
            <Sparkline data={spark} tone={trendTone(spark, invert)} delay={0.1 + i * 0.045} />
          </div>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px]">
        {change !== undefined && change !== null && change !== 0 && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold", good ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive")}>
            {up ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}
            {Math.abs(change * 100).toFixed(0)}%<span className="sr-only">{up ? " up" : " down"} on the previous 30 days</span>
          </span>
        )}
        {sub && <span className="text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

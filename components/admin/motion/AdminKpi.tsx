"use client";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { RollingNumber } from "@/components/dashboard/RollingNumber";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { cn } from "@/lib/utils";
import { Hint, Unavailable } from "../ui";

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
export function AdminKpi({ label, value, sub, change, invert, tone, spark, i = 0, compare = "the previous 30 days", hint, unavailable, compareNote }: { label: string; value: string; sub?: string; change?: number | null; invert?: boolean; tone?: "bad"; spark?: number[]; i?: number; /** 1163: what `change` compares against, printed beside it. */ compare?: string; /** 1163: how the number is counted, behind an "i". */ hint?: string; /** 1163: the value cannot be known (integration off, role cannot see it): say why instead of showing 0. */ unavailable?: string; /** 1165: what to print when `change` is null (no earlier period); defaults to a sentence built from `compare`. */ compareNote?: string }) {
  const up = (change ?? 0) >= 0;
  const good = invert ? !up : up;
  return (
    <div data-enter className="admin-card kpi-card flex min-w-0 flex-col rounded-[24px] bg-card p-5 hairline">
      <p className="flex items-start gap-1 text-[12.5px] font-medium leading-snug text-muted-foreground">
        <span className="min-w-0 break-words">{label}</span>
        {hint && <Hint text={hint} label={`How ${label} is counted`} />}
      </p>
      <div className="mt-2 flex min-w-0 items-end justify-between gap-3">
        {unavailable ? <Unavailable reason={unavailable} /> : <RollingNumber value={value} className={cn("block min-w-0 font-display text-[1.85rem] font-bold leading-none tracking-[-0.03em] tabular", tone === "bad" && "text-destructive")} />}
        {!unavailable && spark && spark.length > 1 && (
          <div className="w-[42%] max-w-[110px] shrink-0">
            <Sparkline data={spark} tone={trendTone(spark, invert)} delay={0.1 + i * 0.045} />
          </div>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px]">
        {!unavailable && change !== undefined && change !== null && change !== 0 && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold", good ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive")} title={`vs ${compare}`}>
            {up ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}
            {Math.abs(change * 100).toFixed(0)}%<span className="sr-only">{up ? " up" : " down"} on {compare}</span>
          </span>
        )}
        {!unavailable && change === 0 && <span className="rounded-full bg-secondary px-1.5 py-0.5 font-semibold text-muted-foreground" title={`vs ${compare}`}>No change</span>}
        {!unavailable && change !== undefined && change !== null && <span className="text-muted-foreground" aria-hidden>vs {compare}</span>}
        {!unavailable && change === null && <span className="text-muted-foreground">{compareNote ?? `Nothing in ${compare} to compare with`}</span>}
        {!unavailable && sub && <span className={cn("text-muted-foreground", change !== undefined && change !== null && "basis-full")}>{sub}</span>}
      </div>
    </div>
  );
}

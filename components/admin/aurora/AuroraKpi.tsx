import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Hint, Unavailable } from "@/components/admin/ui";

export type KpiProps = {
  label: string;
  value: string;
  sub?: string;
  change?: number | null;
  invert?: boolean;
  tone?: "bad";
  spark?: number[];
  compare?: string;
  hint?: string;
  unavailable?: string;
  compareNote?: string;
};

type Trend = "up" | "down" | "flat";

/** Same rule as the classic card: the second half of the window against the first, under 5% is flat. */
export function trendTone(data: number[], invert = false): Trend {
  if (data.length < 4) return "flat";
  const h = Math.floor(data.length / 2);
  const avg = (a: number[]) => a.reduce((t, v) => t + v, 0) / (a.length || 1);
  const a = avg(data.slice(0, h));
  const b = avg(data.slice(h));
  const base = Math.max(Math.abs(a), 1e-9);
  if (a === b || Math.abs(b - a) / base < 0.05) return "flat";
  return b > a !== invert ? "up" : "down";
}

const PLAIN_NUMBER = /^\d[\d,]*(\.\d+)?%?$/;

export function KpiValue({ value, className }: { value: string; className?: string }) {
  if (!PLAIN_NUMBER.test(value)) return <span className={cn("tabular", className)}>{value}</span>;
  return (
    <span data-aurora="count" data-count={value} className={cn("tabular", className)}>
      {value}
    </span>
  );
}

function pct(change: number) {
  const v = Math.abs(change * 100);
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;
}

export function KpiDelta({ change, invert, compare = "the previous 30 days", compareNote, className }: Pick<KpiProps, "change" | "invert" | "compare" | "compareNote"> & { className?: string }) {
  if (change === undefined) return null;
  if (change === null) return <span className={cn("text-[12px] text-muted-foreground", className)}>{compareNote ?? `Nothing in ${compare} to compare with`}</span>;
  if (change === 0) {
    return (
      <span className={cn("au-delta inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium", className)} data-tone="flat">
        <Minus className="h-3 w-3 shrink-0" aria-hidden />
        <span>No change vs {compare}</span>
      </span>
    );
  }
  const up = change > 0;
  const good = invert ? !up : up;
  return (
    <span className={cn("au-delta inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums", className)} data-tone={good ? "up" : "down"} data-dir={up ? "up" : "down"}>
      {up ? <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden /> : <ArrowDownRight className="h-3 w-3 shrink-0" aria-hidden />}
      <span className="min-w-0 break-words">
        {up ? "+" : "-"}
        {pct(change)} vs {compare}
        <span className="sr-only">{good ? ", a good change" : ", a change to watch"}</span>
      </span>
    </span>
  );
}

const SPARK_COLOR: Record<Trend, string> = {
  up: "text-[#3d6b00] dark:text-lime",
  down: "text-destructive",
  flat: "text-muted-foreground",
};

export function Spark({ data, invert, className }: { data: number[]; invert?: boolean; className?: string }) {
  if (data.length < 2) return null;
  const tone = trendTone(data, invert);
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * 100, 26 - ((v - min) / span) * 24] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 28" width="100" height="28" preserveAspectRatio="none" aria-hidden="true" focusable="false" data-tone={tone} className={cn("block h-7 w-[100px] max-w-full overflow-visible", SPARK_COLOR[tone], className)}>
      <path d={`${line} L100 28 L0 28 Z`} fill="currentColor" opacity={0.1} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Aurora stat card: same inputs and wording as the classic KPI card, drawn without client code. */
export function AuroraKpi({ label, value, sub, change, invert, tone, spark, compare = "the previous 30 days", hint, unavailable, compareNote }: KpiProps) {
  return (
    <section data-aurora="card" aria-label={label} className="admin-card kpi-card au-stat flex min-w-0 flex-col rounded-[24px] bg-card p-5">
      <p className="flex items-start justify-between gap-2 text-[13px] font-medium leading-snug text-muted-foreground">
        <span className="min-w-0 break-words">{label}</span>
        {hint && <Hint text={hint} label={`How ${label} is counted`} />}
      </p>
      {unavailable ? (
        <div className="mt-3">
          <Unavailable reason={unavailable} />
        </div>
      ) : (
        <>
          <div className="mt-3 flex min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-2">
            <KpiValue value={value} className={cn("block min-w-0 break-words font-display text-[30px] font-[650] leading-none tracking-[-0.02em] tabular-nums sm:text-[34px]", tone === "bad" && "text-destructive")} />
            {spark && spark.length > 1 && <Spark data={spark} invert={invert} />}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <KpiDelta change={change} invert={invert} compare={compare} compareNote={compareNote} />
            {sub && <span className="basis-full text-[12px] text-muted-foreground">{sub}</span>}
          </div>
        </>
      )}
    </section>
  );
}

/** One compact line in the "More numbers" list: label, value, change. */
export function AuroraKpiRow({ label, value, sub, change, invert, tone, compare = "the previous 30 days", hint, unavailable, compareNote }: KpiProps) {
  return (
    <li className="au-row flex min-h-[44px] min-w-0 flex-col gap-1.5 py-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="flex min-w-0 items-start gap-1 text-[13px] font-medium leading-snug text-muted-foreground">
          <span className="min-w-0 break-words">{label}</span>
          {hint && <Hint text={hint} label={`How ${label} is counted`} />}
        </span>
        {!unavailable && <KpiValue value={value} className={cn("shrink-0 font-display text-[18px] font-[650] leading-tight tracking-[-0.02em] tabular-nums", tone === "bad" && "text-destructive")} />}
      </div>
      {unavailable ? (
        <Unavailable reason={unavailable} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <KpiDelta change={change} invert={invert} compare={compare} compareNote={compareNote} />
          {sub && <span className="text-[12px] text-muted-foreground">{sub}</span>}
        </div>
      )}
    </li>
  );
}

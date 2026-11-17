"use client";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useSeen } from "@/components/dashboard/motion";
import { AdminChartCard, type ChartTable } from "./ChartCard";

export type Series = { key: string; name: string; kind: "bar" | "line" | "area"; color: string };

const tip = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 14, fontSize: 13, color: "hsl(var(--popover-foreground))" };
const axis = { fontSize: 12, fill: "hsl(var(--muted-foreground))" };
const grid = "hsl(var(--foreground) / 0.06)";
const cursor = { fill: "hsl(var(--foreground) / 0.05)" };
const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-IN") : String(v));

/** The chart itself mounts once its box scrolls into view, so a long report page becomes usable before every chart has drawn. */
export function LazyChart({ rows, series, height = 240, xKey = "label", unit }: { rows: Record<string, string | number>[]; series: Series[]; height?: number; xKey?: string; unit?: string }) {
  const { ref, seen } = useSeen<HTMLDivElement>(0.05);
  const tick = Math.max(0, Math.floor(rows.length / 7));
  return (
    <div ref={ref} style={{ height }} className="min-w-0" role="img" aria-label={`${series.map((s) => s.name).join(", ")}${unit ? ` (${unit})` : ""}. Use Table view for every value.`}>
      {seen && (
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ left: -14, right: 6, top: 6, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={grid} />
            <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={false} interval={tick} minTickGap={8} />
            <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
            <Tooltip contentStyle={tip} cursor={cursor} formatter={(v: unknown, name: unknown) => [fmt(v), String(name)]} />
            {series.length > 1 && <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12.5, paddingTop: 6 }} />}
            {series.map((s) =>
              s.kind === "bar" ? (
                <Bar key={s.key} isAnimationActive={false} name={s.name} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={22} />
              ) : s.kind === "area" ? (
                <Area key={s.key} isAnimationActive={false} name={s.name} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2.2} fill={s.color} fillOpacity={0.14} />
              ) : (
                <Line key={s.key} isAnimationActive={false} name={s.name} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={1.8} dot={false} strokeDasharray="4 3" />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** A chart card with exact values on hover, a table view of the same rows, and an honest empty state when every value is zero. */
export function SeriesChart({ title, hint, rows, series, table, height, empty, className, unit }: { title: string; hint?: React.ReactNode; rows: Record<string, string | number>[]; series: Series[]; table: ChartTable; height?: number; empty?: { title: string; body?: string }; className?: string; unit?: string }) {
  const allZero = rows.every((r) => series.every((s) => !Number(r[s.key])));
  return (
    <AdminChartCard title={title} hint={hint} table={table} allZero={allZero} empty={empty} className={className}>
      <LazyChart rows={rows} series={series} height={height} unit={unit} />
    </AdminChartCard>
  );
}

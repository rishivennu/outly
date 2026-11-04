"use client";
import { useReducedMotion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PipChart } from "@/lib/pip/types";
import { chartMotion } from "@/lib/motion/numbers";

/**
 * One chart under a Pip answer (1123). Loaded on demand (recharts is heavy), so the card shows its table first.
 * A forecast series is dashed and labelled "(estimate)" so it never reads as an actual. A null is a gap: a day
 * with no data, not a zero.
 */
const COLORS = ["var(--pc-accent)", "var(--pc-ok)", "var(--pc-warn)", "var(--pc-muted)"];
const short = (n: number) => (Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : `${+n.toFixed(2)}`);

export default function PipChartView({ c }: { c: PipChart }) {
  const reduce = useReducedMotion();
  const data = c.x.map((x, i) => {
    const row: Record<string, string | number | null> = { x };
    for (const s of c.series) row[s.key] = s.values[i] ?? null;
    return row;
  });
  const label = (s: PipChart["series"][number]) => (s.estimate ? `${s.label} (estimate)` : s.label);
  const axis = { tick: { fontSize: 11, fill: "var(--pc-muted)" }, tickLine: false, axisLine: false } as const;
  const tip = {
    contentStyle: { background: "var(--pc-solid)", border: "1px solid var(--pc-line)", borderRadius: 12, fontSize: 12 },
    formatter: (v: unknown, name: unknown) => [typeof v === "number" ? `${v.toLocaleString()}${c.unit ? ` ${c.unit}` : ""}` : "No data", String(name)] as [string, string],
  };
  const many = c.series.length > 1;
  return (
    <div className="h-[168px] w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        {c.kind === "bar" ? (
          <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--pc-line)" />
            <XAxis dataKey="x" {...axis} interval="preserveStartEnd" minTickGap={14} />
            <YAxis {...axis} width={44} tickFormatter={short} />
            <Tooltip {...tip} cursor={{ fill: "var(--pc-fill)" }} />
            {many && <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
            {c.series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={label(s)} fill={COLORS[i % COLORS.length]} fillOpacity={s.estimate ? 0.45 : 1} radius={[4, 4, 0, 0]} maxBarSize={28} {...chartMotion(reduce, i)} />
            ))}
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--pc-line)" />
            <XAxis dataKey="x" {...axis} interval="preserveStartEnd" minTickGap={18} />
            <YAxis {...axis} width={44} tickFormatter={short} />
            <Tooltip {...tip} />
            {many && <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
            {c.series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={label(s)}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                strokeDasharray={s.estimate ? "5 4" : undefined}
                dot={c.x.length <= 14 ? { r: 2.5 } : false}
                connectNulls={false}
                {...chartMotion(reduce, i)}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

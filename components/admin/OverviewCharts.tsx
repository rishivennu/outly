"use client";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, ComposedChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/billing/money";
import { prefersReduced, useEnter, useSeen } from "@/components/dashboard/motion";
import { useSlider } from "@/components/dashboard/useSlider";
import { RollingNumber } from "@/components/dashboard/RollingNumber";
import { Card, CardTitle } from "./ui";
import { cn } from "@/lib/utils";

type Row = { day: string; label: string; users: number; signups: number; active: number; revenue: number; newSubs: number; cancels: number; activeSubs: number };
const RANGES = [7, 30, 90] as const;
const LIME = "hsl(var(--lime-ink))";
const PIE = ["#22f04a", "#a3e635", "#dcfa18", "#14b8a6", "#64748b"];
const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const CROSS = { stroke: "hsl(var(--foreground) / 0.28)", strokeWidth: 1, strokeDasharray: "3 4" };
const DOT = { r: 5, strokeWidth: 2.5, stroke: LIME, fill: "hsl(var(--card))" };

/** The analytics glass tooltip (pulse-tip), fed by Recharts. Its wrapper glides from day to day. */
type TipItem = { name?: unknown; value?: unknown; color?: string; payload?: unknown };
function GlassTip({ active, payload, label, fmt }: { active?: boolean; payload?: readonly TipItem[]; label?: unknown; fmt?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="pulse-tip">
      {label !== undefined && label !== "" && <p className="pulse-tip-date">{String(label)}</p>}
      {payload.map((p, i) => (
        <p key={i} className="pulse-tip-row">
          <span className="pulse-key" style={{ borderTopColor: p.color ?? (p.payload as { fill?: string } | undefined)?.fill }} />
          {String(p.name ?? "")}
          <b>{fmt ? fmt(Number(p.value ?? 0)) : Number(p.value ?? 0).toLocaleString("en-IN")}</b>
        </p>
      ))}
    </div>
  );
}

/** A chart card: it rises in with the section, and its chart only mounts (and so draws in) once it is on screen. */
function ChartCard({ title, hint, className, h = 220, children }: { title: string; hint: string; className?: string; h?: number; children: React.ReactNode }) {
  const { ref, seen } = useSeen<HTMLDivElement>(0.3);
  return (
    <Card data-enter className={className}>
      <CardTitle hint={hint}>{title}</CardTitle>
      <div ref={ref} style={{ height: h }}>{seen && children}</div>
    </Card>
  );
}

/**
 * Admin Overview trends (1081, the 1080 analytics motion): the cards stagger in, each line draws left to
 * right when its card is first seen, a new range morphs the shapes, the range pill slides, and the donut
 * sweeps round once while its shares roll up. Reduced motion: everything is simply there.
 */
export function OverviewCharts({ series, revenueByPlan, currency, showMoney }: { series: Row[]; revenueByPlan: { name: string; value: number }[]; currency: string; showMoney: boolean }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [still, setStill] = useState(true);
  useEffect(() => setStill(prefersReduced()), []);
  const { root } = useEnter<HTMLDivElement>();
  const seg = useSlider<HTMLDivElement>(range);
  const data = useMemo(() => series.slice(-range), [series, range]);
  const money = (v: number) => formatMoney(Math.round(v * 100), currency, { compact: true });
  const tick = Math.max(0, Math.floor(data.length / 6));
  const anim = (i: number) => (still ? { isAnimationActive: false } : { isAnimationActive: true, animationBegin: 60 + i * 90, animationDuration: 950, animationEasing: "ease-out" as const });
  const tipMotion = still ? { isAnimationActive: false } : { isAnimationActive: true, animationDuration: 220, animationEasing: "ease-out" as const };
  const tipWrap = { outline: "none", zIndex: 5 };

  const onRangeKey = (e: React.KeyboardEvent) => {
    const i = RANGES.indexOf(range);
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const r = RANGES[(to + RANGES.length) % RANGES.length];
    setRange(r);
    requestAnimationFrame(() => seg.box.current?.querySelector<HTMLElement>(`[data-r="${r}"]`)?.focus());
  };
  const total = revenueByPlan.reduce((t, r) => t + r.value, 0) || 1;

  return (
    <div ref={root} data-enter-root className="mt-6">
      <div data-enter className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-[1.2rem] font-semibold tracking-tight">Trends</h2>
        <div ref={seg.box} role="radiogroup" aria-label="Date range" onKeyDown={onRangeKey} className="pulse-seg relative">
          <span ref={seg.bar} aria-hidden="true" className="pulse-seg-pill" />
          {RANGES.map((r) => (
            <button key={r} data-r={r} type="button" role="radio" aria-checked={range === r} tabIndex={range === r ? 0 : -1} onClick={() => setRange(r)} className={cn("relative z-[1] h-9 min-w-[64px] rounded-[10px] px-3 text-[12.5px] font-semibold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring", range === r ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {r} days
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Active users" hint="Distinct users who opened the studio each day">
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ left: -18, right: 6, top: 6 }}>
              <defs><linearGradient id="g-act" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7cf52a" stopOpacity={0.45} /><stop offset="1" stopColor="#7cf52a" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={tick} />
              <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...tipMotion} wrapperStyle={tipWrap} cursor={CROSS} content={(p) => <GlassTip active={p.active} payload={p.payload} label={p.label} />} />
              <Area {...anim(0)} type="monotone" dataKey="active" name="Active" stroke={LIME} strokeWidth={2.2} fill="url(#g-act)" activeDot={DOT} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="User growth" hint="Total accounts, and new sign-ups per day">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ left: -18, right: -10, top: 6 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={tick} />
              <YAxis yAxisId="a" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis yAxisId="b" orientation="right" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...tipMotion} wrapperStyle={tipWrap} cursor={{ fill: "hsl(var(--foreground) / 0.05)", radius: 6 }} content={(p) => <GlassTip active={p.active} payload={p.payload} label={p.label} />} />
              <Bar {...anim(1)} yAxisId="a" dataKey="signups" name="Sign-ups" fill="#a3e635" radius={[6, 6, 0, 0]} />
              <Line {...anim(2)} yAxisId="b" type="monotone" dataKey="users" name="Total users" stroke={LIME} strokeWidth={2.2} dot={false} activeDot={DOT} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        {showMoney && (
          <>
            <ChartCard title="Revenue" hint={`Successful payments per day, ${currency}`}>
              <ResponsiveContainer>
                <AreaChart data={data} margin={{ left: 0, right: 6, top: 6 }}>
                  <defs><linearGradient id="g-rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22f04a" stopOpacity={0.4} /><stop offset="1" stopColor="#22f04a" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
                  <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={tick} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={money} width={56} />
                  <Tooltip {...tipMotion} wrapperStyle={tipWrap} cursor={CROSS} content={(p) => <GlassTip active={p.active} payload={p.payload} label={p.label} fmt={money} />} />
                  <Area {...anim(0)} type="monotone" dataKey="revenue" name="Revenue" stroke="#16a34a" strokeWidth={2.2} fill="url(#g-rev)" activeDot={{ ...DOT, stroke: "#16a34a" }} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Subscriptions & churn" hint="Active paid subscriptions, with new and cancelled per day">
              <ResponsiveContainer>
                <LineChart data={data} margin={{ left: -18, right: 6, top: 6 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
                  <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={tick} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip {...tipMotion} wrapperStyle={tipWrap} cursor={CROSS} content={(p) => <GlassTip active={p.active} payload={p.payload} label={p.label} />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Line {...anim(0)} type="monotone" dataKey="activeSubs" name="Active" stroke={LIME} strokeWidth={2.4} dot={false} activeDot={DOT} />
                  <Line {...anim(1)} type="monotone" dataKey="newSubs" name="New" stroke="#14b8a6" strokeWidth={1.8} dot={false} />
                  <Line {...anim(2)} type="monotone" dataKey="cancels" name="Cancelled" stroke="hsl(var(--destructive))" strokeWidth={1.8} strokeDasharray="4 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <Card data-enter className="lg:col-span-2">
              <CardTitle hint="Successful payments in the last 90 days">Revenue by plan</CardTitle>
              {revenueByPlan.length ? (
                <div className="grid items-center gap-6 sm:grid-cols-[220px_1fr]">
                  <Donut rows={revenueByPlan} money={money} anim={anim(0)} tipMotion={tipMotion} />
                  <ul className="flex flex-col gap-2.5">
                    {revenueByPlan.map((r, i) => (
                      <li key={r.name} className="flex items-center gap-3 text-[14px]">
                        <span className="h-3 w-3 rounded-full" style={{ background: PIE[i % PIE.length] }} aria-hidden />
                        <span className="flex-1 font-medium">{r.name}</span>
                        <RollingNumber value={`${Math.round((r.value / total) * 100)}%`} className="tabular text-muted-foreground" />
                        <RollingNumber value={money(r.value)} className="w-24 text-right font-semibold tabular" />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="py-8 text-center text-[13.5px] text-muted-foreground">No paid plans sold yet. Your first payment will show up here.</p>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

/** The plan donut sweeps clockwise from twelve o'clock the first time it is seen. Decorative: the list carries it. */
function Donut({ rows, money, anim, tipMotion }: { rows: { name: string; value: number }[]; money: (v: number) => string; anim: object; tipMotion: object }) {
  const { ref, seen } = useSeen<HTMLDivElement>(0.3);
  return (
    <div ref={ref} className="h-[200px]" aria-hidden>
      {seen && (
        <ResponsiveContainer>
          <PieChart accessibilityLayer={false} tabIndex={-1}>
            <Pie {...anim} rootTabIndex={-1} data={rows} dataKey="value" nameKey="name" startAngle={90} endAngle={-270} innerRadius={58} outerRadius={90} paddingAngle={3} stroke="none">
              {rows.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
            </Pie>
            <Tooltip {...tipMotion} wrapperStyle={{ outline: "none", zIndex: 5 }} content={(p) => <GlassTip active={p.active} payload={p.payload} label={p.label} fmt={money} />} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

"use client";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, ComposedChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/billing/money";
import { Card, CardTitle } from "./ui";
import { cn } from "@/lib/utils";

type Row = { day: string; label: string; users: number; signups: number; active: number; revenue: number; newSubs: number; cancels: number; activeSubs: number };
const RANGES = [7, 30, 90] as const;
const LIME = "hsl(var(--lime-ink))";
const PIE = ["#22f04a", "#a3e635", "#dcfa18", "#14b8a6", "#64748b"];
const tip = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 14, fontSize: 12, color: "hsl(var(--popover-foreground))" };
const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

export function OverviewCharts({ series, revenueByPlan, currency, showMoney }: { series: Row[]; revenueByPlan: { name: string; value: number }[]; currency: string; showMoney: boolean }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const data = useMemo(() => series.slice(-range), [series, range]);
  const money = (v: number) => formatMoney(Math.round(v * 100), currency, { compact: true });
  const tick = Math.max(0, Math.floor(data.length / 6));

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-[1.2rem] font-semibold tracking-tight">Trends</h2>
        <div role="radiogroup" aria-label="Date range" className="relative inline-flex rounded-full bg-secondary/70 p-1 hairline">
          {RANGES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={range === r} onClick={() => setRange(r)} className={cn("relative h-8 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors", range === r ? "lime-bg" : "text-muted-foreground hover:text-foreground")}>
              {r} days
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="Distinct users who opened the studio each day">Active users</CardTitle>
          <div className="h-[220px]">
            <ResponsiveContainer>
              <AreaChart data={data} margin={{ left: -18, right: 6, top: 6 }}>
                <defs><linearGradient id="g-act" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7cf52a" stopOpacity={0.45} /><stop offset="1" stopColor="#7cf52a" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={tick} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tip} formatter={(v: number) => [v, "Active"]} />
                <Area isAnimationActive={false} type="monotone" dataKey="active" stroke={LIME} strokeWidth={2.2} fill="url(#g-act)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardTitle hint="Total accounts, and new sign-ups per day">User growth</CardTitle>
          <div className="h-[220px]">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ left: -18, right: -10, top: 6 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={tick} />
                <YAxis yAxisId="a" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis yAxisId="b" orientation="right" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tip} cursor={{ fill: "hsl(var(--foreground) / 0.04)" }} />
                <Bar isAnimationActive={false} yAxisId="a" dataKey="signups" name="Sign-ups" fill="#a3e635" radius={[6, 6, 0, 0]} />
                <Line isAnimationActive={false} yAxisId="b" type="monotone" dataKey="users" name="Total users" stroke={LIME} strokeWidth={2.2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {showMoney && (
          <>
            <Card>
              <CardTitle hint={`Successful payments per day, ${currency}`}>Revenue</CardTitle>
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <AreaChart data={data} margin={{ left: 0, right: 6, top: 6 }}>
                    <defs><linearGradient id="g-rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22f04a" stopOpacity={0.4} /><stop offset="1" stopColor="#22f04a" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
                    <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={tick} />
                    <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={money} width={56} />
                    <Tooltip contentStyle={tip} formatter={(v: number) => [money(v), "Revenue"]} />
                    <Area isAnimationActive={false} type="monotone" dataKey="revenue" stroke="#16a34a" strokeWidth={2.2} fill="url(#g-rev)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardTitle hint="Active paid subscriptions, with new and cancelled per day">Subscriptions & churn</CardTitle>
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <LineChart data={data} margin={{ left: -18, right: 6, top: 6 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
                    <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={tick} />
                    <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={tip} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="activeSubs" name="Active" stroke={LIME} strokeWidth={2.4} dot={false} />
                    <Line isAnimationActive={false} type="monotone" dataKey="newSubs" name="New" stroke="#14b8a6" strokeWidth={1.8} dot={false} />
                    <Line isAnimationActive={false} type="monotone" dataKey="cancels" name="Cancelled" stroke="hsl(var(--destructive))" strokeWidth={1.8} strokeDasharray="4 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="lg:col-span-2">
              <CardTitle hint="Successful payments in the last 90 days">Revenue by plan</CardTitle>
              {revenueByPlan.length ? (
                <div className="grid items-center gap-6 sm:grid-cols-[220px_1fr]">
                  <div className="h-[200px]" aria-hidden>
                    <ResponsiveContainer>
                      <PieChart accessibilityLayer={false} tabIndex={-1}>
                        <Pie isAnimationActive={false} rootTabIndex={-1} data={revenueByPlan} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={3} stroke="none">
                          {revenueByPlan.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tip} formatter={(v: number) => money(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="flex flex-col gap-2.5">
                    {(() => {
                      const total = revenueByPlan.reduce((t, r) => t + r.value, 0) || 1;
                      return revenueByPlan.map((r, i) => (
                        <li key={r.name} className="flex items-center gap-3 text-[14px]">
                          <span className="h-3 w-3 rounded-full" style={{ background: PIE[i % PIE.length] }} aria-hidden />
                          <span className="flex-1 font-medium">{r.name}</span>
                          <span className="tabular text-muted-foreground">{Math.round((r.value / total) * 100)}%</span>
                          <span className="w-24 text-right font-semibold tabular">{money(r.value)}</span>
                        </li>
                      ));
                    })()}
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

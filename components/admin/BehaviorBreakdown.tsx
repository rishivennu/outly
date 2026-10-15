"use client";
import { useRef } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BehaviorStats } from "@/lib/admin/behavior";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Empty, Pill, Table, ago } from "./ui";
import { hoursText, pct, pname } from "./behavior-fmt";
import { MOTION_OK, countUp, gsap, settleCounts, useGSAP } from "@/lib/motion/gsap";

const LIME = "hsl(var(--lime-ink))";
const tip = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 14, fontSize: 12, color: "hsl(var(--popover-foreground))" };
const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const grid = "hsl(var(--foreground) / 0.06)";
const cursor = { fill: "hsl(var(--foreground) / 0.04)" };
const SEG_COLOR: Record<string, string> = { new: "hsl(var(--accent))", power: "hsl(var(--lime-ink))", regular: "hsl(var(--lime))", casual: "hsl(var(--lime) / 0.45)", dormant: "hsl(var(--muted-foreground) / 0.35)" };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card as="div" className="kpi-card gs-in p-5">
      <p className="text-[12.5px] font-medium text-muted-foreground">{label}</p>
      <p data-count={value} className="mt-2 font-display text-[1.75rem] font-bold leading-none tracking-[-0.03em] tabular">{value}</p>
      {sub && <p className="mt-2.5 text-[12px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

/**
 * Entrance choreography (GSAP): cards rise in a stagger, KPI numbers count up, bars grow from the left
 * and the cohort grid fills in from the top-left corner. Replays when the range changes or the tab is shown.
 */
function useBreakdownMotion(ref: React.RefObject<HTMLDivElement>, key: string, active: boolean) {
  useGSAP(() => {
    const root = ref.current;
    if (!root || !active) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const q = gsap.utils.selector(root);
      const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.55 } });
      tl.fromTo(q(".gs-in"), { opacity: 0, y: 14 }, { opacity: 1, y: 0, stagger: 0.045 }, 0)
        .from(q(".gs-bar"), { scaleX: 0, duration: 0.8, ease: "power2.out", stagger: 0.06 }, 0.15)
        .from(q(".gs-cell"), { opacity: 0, scale: 0.8, duration: 0.3, stagger: { each: 0.01, grid: "auto", from: "start" } }, 0.3);
      q("[data-count]").forEach((el, i) => countUp(tl, el as HTMLElement, 0.08 + i * 0.05));
      return () => settleCounts(root);
    }, root);
    root.dataset.gsReady = "1";
  }, { dependencies: [key, active], scope: ref, revertOnUpdate: true });
}

export function BehaviorBreakdown({ s, active = true }: { s: BehaviorStats; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useBreakdownMotion(ref, `${s.rangeDays}:${s.totals.users}:${s.totals.dau}`, active);
  if (!s.totals.users) return <Empty title="No users yet" body="Once people sign up and open the studio, their behavior shows up here." />;
  const tick = Math.max(0, Math.floor(s.series.length / 7));
  const published = s.funnel.find((f) => f.key === "publish");
  const segTotal = s.segments.reduce((t, x) => t + x.users, 0) || 1;
  const planMax = Math.max(s.plans.paidAvgActiveDays, s.plans.freeAvgActiveDays, 1);
  return (
    <div ref={ref} className="gs-stage flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active today" value={String(s.totals.dau)} sub={`${s.totals.wau} this week, ${s.totals.mau} this month`} />
        <Stat label="Stickiness" value={pct(s.totals.stickiness)} sub="Daily actives as a share of monthly" />
        <Stat label={`New sign-ups, ${s.rangeDays} days`} value={String(s.totals.newUsers)} sub={`${s.totals.prevNewUsers} in the ${s.rangeDays} days before`} />
        <Stat label="Have published" value={pct(published?.pct ?? 0)} sub={`${published?.count ?? 0} of ${s.totals.users} users`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Card className="gs-in">
          <CardTitle hint="Each step counts people who also did every step before it">Activation funnel</CardTitle>
          <ol className="flex flex-col gap-3">
            {s.funnel.map((f, i) => (
              <li key={f.key}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="font-medium">{f.label}</span>
                  <span className="tabular text-muted-foreground">
                    <b className="text-foreground">{f.count.toLocaleString("en-IN")}</b> · {pct(f.pct)}
                    {i > 0 && f.stepPct < 1 && <span className="ml-2 text-[12px]">({pct(1 - f.stepPct)} drop)</span>}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-foreground/[0.06]">
                  <div className="gs-bar h-full rounded-full bg-lime" style={{ width: `${Math.max(f.pct * 100, f.count ? 1.5 : 0)}%` }} />
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card className="gs-in">
          <CardTitle hint="People who signed up in the last 120 days">Retention</CardTitle>
          <div className="flex flex-col gap-4">
            {s.retention.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13.5px] font-medium">{r.label}</p>
                  <p className="text-[12px] text-muted-foreground">{r.eligible ? `${r.retained} of ${r.eligible} people` : "Not enough time has passed"}</p>
                </div>
                <p data-count={r.eligible ? pct(r.rate) : "n/a"} className="font-display text-[1.6rem] font-bold tabular">{r.eligible ? pct(r.rate) : "n/a"}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="gs-in">
        <CardTitle hint="Distinct active users each day, with posts created and published">Daily activity</CardTitle>
        <div className="h-[240px]">
          <ResponsiveContainer>
            <ComposedChart data={s.series} margin={{ left: -18, right: 6, top: 6 }}>
              <defs><linearGradient id="g-beh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7cf52a" stopOpacity={0.4} /><stop offset="1" stopColor="#7cf52a" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid vertical={false} stroke={grid} />
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={tick} />
              <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tip} cursor={cursor} />
              <Area isAnimationActive={false} name="Active" type="monotone" dataKey="active" stroke={LIME} strokeWidth={2.2} fill="url(#g-beh)" />
              <Bar isAnimationActive={false} name="Posts created" dataKey="posts" fill="hsl(var(--accent) / 0.55)" radius={[4, 4, 0, 0]} maxBarSize={14} />
              <Line isAnimationActive={false} name="Published" type="monotone" dataKey="published" stroke="hsl(var(--foreground) / 0.7)" strokeWidth={1.6} dot={false} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="gs-in">
        <CardTitle hint="Share of each weekly sign-up group that was active in each week after joining">Weekly cohorts</CardTitle>
        <div className="relative -mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
          <table className="w-full min-w-[620px] border-separate border-spacing-1 text-[12px]">
            <thead>
              <tr>
                <th scope="col" className="pb-1 pr-2 text-left font-semibold text-muted-foreground">Joined week of</th>
                <th scope="col" className="pb-1 pr-2 text-right font-semibold text-muted-foreground">People</th>
                {Array.from({ length: 8 }, (_, w) => <th key={w} scope="col" className="pb-1 text-center font-semibold text-muted-foreground"><abbr title={w === 0 ? "Week they joined" : `Week ${w} after joining`} className="no-underline">W{w}</abbr></th>)}
              </tr>
            </thead>
            <tbody>
              {s.cohorts.map((c) => (
                <tr key={c.start}>
                  <th scope="row" className="pr-2 text-left font-medium">{c.label}</th>
                  <td className="pr-2 text-right tabular text-muted-foreground">{c.size}</td>
                  {c.weeks.map((r, w) => (
                    <td key={w} className={cn("h-8 min-w-[52px] rounded-lg text-center tabular", r === null ? "" : "gs-cell", r === null ? "" : r >= 0.5 ? "font-semibold text-[hsl(var(--lime-foreground))]" : "text-foreground")} style={r === null ? undefined : { background: `hsl(var(--lime) / ${(0.06 + r * 0.84).toFixed(2)})` }}>
                      {r === null ? <span className="sr-only">No data yet</span> : pct(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gs-in">
          <CardTitle hint={`Every user, by activity in the last ${s.rangeDays} days`}>Segments</CardTitle>
          <div className="gs-bar mb-4 flex h-3 overflow-hidden rounded-full bg-foreground/[0.06]" role="img" aria-label={s.segments.map((x) => `${x.label} ${pct(x.share)}`).join(", ")}>
            {s.segments.map((x) => (x.users > 0 ? <span key={x.key} style={{ width: `${(x.users / segTotal) * 100}%`, background: SEG_COLOR[x.key] }} /> : null))}
          </div>
          <ul className="flex flex-col gap-2.5">
            {s.segments.map((x) => (
              <li key={x.key} className="flex items-start gap-2.5 text-[13px]">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEG_COLOR[x.key] }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{x.label}</span>
                  <span className="block text-[12px] text-muted-foreground">{x.description}</span>
                </span>
                <span className="whitespace-nowrap tabular"><b>{x.users}</b> <span className="text-muted-foreground">· {pct(x.share)}</span></span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="gs-in">
          <CardTitle hint={`Users by number of active days in ${s.rangeDays} days`}>How often people come back</CardTitle>
          <div className="h-[200px]">
            <ResponsiveContainer>
              <BarChart data={s.frequency} margin={{ left: -22, right: 4, top: 6 }}>
                <CartesianGrid vertical={false} stroke={grid} />
                <XAxis dataKey="bucket" tick={axis} tickLine={false} axisLine={false} interval={0} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tip} cursor={cursor} formatter={(v: number) => [v, "Users"]} />
                <Bar isAnimationActive={false} dataKey="users" fill={LIME} radius={[6, 6, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="gs-in">
          <CardTitle hint="Active user-days by weekday (UTC)">Weekly rhythm</CardTitle>
          <div className="h-[200px]">
            <ResponsiveContainer>
              <BarChart data={s.weekday} margin={{ left: -22, right: 4, top: 6 }}>
                <CartesianGrid vertical={false} stroke={grid} />
                <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} interval={0} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tip} cursor={cursor} formatter={(v: number) => [v, "Active user-days"]} />
                <Bar isAnimationActive={false} dataKey="active" fill="hsl(var(--lime))" radius={[6, 6, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="gs-in">
          <CardTitle hint={`Accounts connected now; publishing in the last ${s.rangeDays} days, rehearsals excluded`}>Platforms</CardTitle>
          {s.platforms.length ? (
            <Table head={["Platform", "Connected", "Needs reconnect", "Publishes", "Success"]} className="[&_table]:min-w-[520px]">
              {s.platforms.map((p) => (
                <tr key={p.platform}>
                  <td className="font-medium">{pname(p.platform)}</td>
                  <td className="tabular">{p.connected}</td>
                  <td className="tabular">{p.needsReconnect ? <Pill tone="warn">{p.needsReconnect}</Pill> : 0}</td>
                  <td className="tabular">{p.targets}</td>
                  <td className="tabular">{p.successRate === null ? <span className="text-muted-foreground">n/a</span> : <Pill tone={p.successRate >= 0.9 ? "ok" : p.successRate >= 0.7 ? "warn" : "bad"}>{pct(p.successRate)}</Pill>}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">No one has connected a platform yet.</p>
          )}
        </Card>
        <Card className="gs-in">
          <CardTitle hint={`Posts created in the last ${s.rangeDays} days`}>Posting habits</CardTitle>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            {[
              ["Posts created", String(s.posts.inRange)],
              ["Reached published", pct(s.posts.publishRate)],
              ["Scheduled ahead", pct(s.posts.scheduledShare)],
              ["Sent for approval", pct(s.posts.approvalShare)],
              ["Posts per creator", String(s.posts.avgPerCreator)],
              ["Sign-up to first publish", hoursText(s.posts.medianHoursToFirstPublish)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] text-muted-foreground">{k}</dt>
                <dd className="font-display text-[1.1rem] font-semibold tabular">{v}</dd>
              </div>
            ))}
          </dl>
          {Object.keys(s.posts.byStatus).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {Object.entries(s.posts.byStatus).map(([k, n]) => <Pill key={k} tone={k === "failed" ? "bad" : k === "published" ? "ok" : k === "draft" ? "muted" : "info"}>{k} {n}</Pill>)}
            </div>
          )}
          {s.errors.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-[12px] font-semibold text-muted-foreground">Top publish errors</p>
              <ul className="flex flex-col gap-1 text-[12.5px]">
                {s.errors.map((e) => <li key={e.code} className="flex justify-between gap-3"><code className="truncate">{e.code}</code><span className="tabular">{e.count}</span></li>)}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card className="gs-in">
          <CardTitle hint={`Average active days in the last ${s.rangeDays} days`}>Paid versus free</CardTitle>
          <div className="flex flex-col gap-3">
            {([["Paying", s.plans.paidAvgActiveDays, s.plans.paidUsers], ["Free", s.plans.freeAvgActiveDays, s.plans.freeUsers]] as const).map(([k, v, n]) => (
              <div key={k}>
                <div className="mb-1 flex justify-between text-[13px]"><span className="font-medium">{k} <span className="text-muted-foreground">({n} people)</span></span><b className="tabular">{v} days</b></div>
                <div className="h-2.5 overflow-hidden rounded-full bg-foreground/[0.06]"><div className={cn("gs-bar h-full rounded-full", k === "Paying" ? "bg-lime" : "bg-foreground/25")} style={{ width: `${(v / planMax) * 100}%` }} /></div>
              </div>
            ))}
            <p className="text-[12px] text-muted-foreground">{s.totals.weeklyReportOptIn} of {s.totals.users} users get the Monday report email.</p>
          </div>
        </Card>
        <Card className="gs-in">
          <CardTitle hint="Most active people in the range. Shown here only, never sent to Gemini.">Most engaged</CardTitle>
          {s.topUsers.length ? (
            <Table head={["Person", "Active days", "Posts", "Published", "Platforms", "Plan", "Last seen"]}>
              {s.topUsers.map((u) => (
                <tr key={u.id}>
                  <td>
                    <a href={`/admin/users?q=${encodeURIComponent(u.email)}`} className="font-medium underline-offset-2 hover:underline">{u.name}</a>
                    <span className="block max-w-[200px] truncate text-[12px] text-muted-foreground">{u.email}</span>
                  </td>
                  <td className="tabular">{u.activeDays}</td>
                  <td className="tabular">{u.posts}</td>
                  <td className="tabular">{u.published}</td>
                  <td className="text-[12.5px]">{u.platforms.length ? u.platforms.map(pname).join(", ") : <span className="text-muted-foreground">None</span>}</td>
                  <td>{u.plan === "Free" ? <Pill>Free</Pill> : <Pill tone="lime">{u.plan}</Pill>}</td>
                  <td className="whitespace-nowrap text-muted-foreground" suppressHydrationWarning>{u.lastActiveAt ? ago(u.lastActiveAt) : "Never"}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">No activity in this range yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

"use client";
import { useRef } from "react";
import type { BehaviorStats } from "@/lib/admin/behavior";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Empty, Hint, Pill, Table, ago } from "./ui";
import { ScrollX } from "@/components/ui/scroll-x";
import { hoursText, pct, pname } from "./behavior-fmt";
import { ActivationFunnel } from "./ActivationFunnel";
import { SeriesChart } from "./SeriesChart";
import { MOTION_OK, countUp, gsap, settleCounts, useGSAP } from "@/lib/motion/gsap";

const SEG_COLOR: Record<string, string> = { new: "hsl(var(--accent))", power: "hsl(var(--lime-ink))", regular: "hsl(var(--lime))", casual: "hsl(var(--lime) / 0.45)", dormant: "hsl(var(--muted-foreground) / 0.35)" };
const n = (v: number) => v.toLocaleString("en-IN");

function Stat({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint?: string }) {
  return (
    <Card as="div" className="kpi-card gs-in p-5">
      <p className="flex items-start gap-1 text-[12.5px] font-medium text-muted-foreground">
        <span className="min-w-0">{label}</span>
        {hint && <Hint text={hint} label={`How ${label} is counted`} />}
      </p>
      <p data-count={value} className="mt-2 font-display text-[1.75rem] font-bold leading-none tracking-[-0.03em] tabular">{value}</p>
      {sub && <p className="mt-2.5 text-[12.5px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

/**
 * Entrance choreography (GSAP): cards rise in a stagger, KPI numbers count up, bars grow from the left
 * and the cohort grid fills in from the top-left corner. Replays when the range changes or the tab is shown.
 */
function useBreakdownMotion(ref: React.RefObject<HTMLDivElement | null>, key: string, active: boolean) {
  useGSAP(() => {
    const root = ref.current;
    if (!root || !active) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const q = gsap.utils.selector(root);
      const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.55 } });
      tl.fromTo(q(".gs-in"), { opacity: 0, y: 14 }, { opacity: 1, y: 0, stagger: 0.045 }, 0)
        .from(q(".gs-bar"), { scaleX: 0, transformOrigin: "left center", duration: 0.8, ease: "power2.out", stagger: 0.06 }, 0.15)
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
  const published = s.activation.all.steps.find((f) => f.key === "publish");
  const segTotal = s.segments.reduce((t, x) => t + x.users, 0);
  const planMax = Math.max(s.plans.paidAvgActiveDays, s.plans.freeAvgActiveDays, 1);
  const people = s.activation.peopleShown;
  return (
    <div ref={ref} className="gs-stage flex flex-col gap-4 [&>*]:min-w-0">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active today" value={n(s.totals.dau)} sub={`${n(s.totals.wau)} in 7 days, ${n(s.totals.mau)} in 30 days`} hint="Distinct people with at least one active day today (UTC). The 7 and 30 day figures include today." />
        <Stat label="Stickiness" value={pct(s.totals.stickiness)} sub="Active today as a share of the last 30 days" hint="Active today divided by distinct people active in the last 30 days, both in UTC days." />
        <Stat label={`New sign-ups, ${s.rangeDays} days`} value={n(s.totals.newUsers)} sub={`${n(s.totals.prevNewUsers)} in the ${s.rangeDays} days before`} hint={`Accounts created today or in the ${s.rangeDays - 1} UTC days before.`} />
        <Stat label="Have published" value={pct(published?.pctOfStart ?? 0)} sub={`${n(published?.count ?? 0)} of ${n(s.totals.users)} accounts`} hint="Accounts that connected a platform, uploaded, created a post and saw at least one go live. Practice runs do not count." />
      </div>

      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <ActivationFunnel a={s.activation} rangeDays={s.rangeDays} />
        <Card className="gs-in">
          <CardTitle hint="Everyone who signed up in the last 120 days, counted only once their window has fully ended. UTC days; the sign-up day is day 0.">Retention</CardTitle>
          <div className="flex flex-col gap-4">
            {s.retention.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-[13.5px] font-medium">{r.label}<Hint text={r.rule} label={`How ${r.label} retention is counted`} /></p>
                  <p className="text-[12.5px] text-muted-foreground">
                    {r.eligible ? `${n(r.retained)} of ${n(r.eligible)} people came back` : "Not yet measurable"}
                    {r.pending > 0 && <span className="block">{n(r.pending)} more still inside the window</span>}
                  </p>
                </div>
                <p data-count={r.eligible ? pct(r.rate) : undefined} className={cn("shrink-0 font-display font-bold tabular", r.eligible ? "text-[1.6rem]" : "text-[1rem] text-muted-foreground")}>{r.eligible ? pct(r.rate) : "Not yet"}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 border-t border-border/60 pt-3 text-[12.5px] text-muted-foreground">Retention asks whether a person came back at all inside a window. How often people come back, further down, counts their active days instead.</p>
        </Card>
      </div>

      <SeriesChart
        className="gs-in"
        title="Daily activity"
        hint="Distinct active people each UTC day, with posts created and posts that went live that day."
        rows={s.series}
        series={[{ key: "active", name: "Active people", kind: "area", color: "hsl(var(--lime-ink))" }, { key: "posts", name: "Posts created", kind: "bar", color: "hsl(var(--accent) / 0.6)" }, { key: "published", name: "Published", kind: "line", color: "hsl(var(--foreground) / 0.7)" }]}
        table={{ head: ["Day", "Active people", "Sign-ups", "Posts created", "Published"], rows: s.series.map((d) => [d.label, d.active, d.signups, d.posts, d.published]) }}
        empty={{ title: "No activity in this range", body: "Nobody opened the studio or posted in these days." }}
      />

      <Card className="gs-in">
        <CardTitle hint="Share of each weekly sign-up group active at least once in each calendar week (Monday to Sunday, UTC). W0 is the week they joined. Hover a cell for the count.">Weekly cohorts</CardTitle>
        <ScrollX label="Weekly cohorts" className="pin-first -mx-5 px-5 sm:-mx-6 sm:px-6">
          <table className="w-full min-w-[620px] border-separate border-spacing-1 text-[12.5px]">
            <caption className="sr-only">Weekly cohort retention. Empty cells are weeks that have not started yet.</caption>
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
                  {c.size === 0 ? (
                    <td colSpan={8} className="h-8 rounded-lg pl-2 text-left text-muted-foreground">No sign-ups this week</td>
                  ) : (
                    c.weeks.map((r, w) => (
                      <td key={w} title={r === null ? "Not yet measurable" : `${c.active[w]} of ${c.size} active${c.partial === w ? ", week still running" : ""}`} className={cn("h-8 min-w-[56px] rounded-lg text-center tabular", r === null ? "text-[11.5px] text-muted-foreground" : "gs-cell", r !== null && (r >= 0.5 ? "font-semibold text-[hsl(var(--lime-foreground))]" : "text-foreground"))} style={r === null ? undefined : { background: `hsl(var(--lime) / ${(0.06 + r * 0.84).toFixed(2)})` }}>
                        {r === null ? "Not yet" : <>{pct(r)}{c.partial === w && <span aria-label=", so far">*</span>}</>}
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
        <p className="mt-2 text-[12px] text-muted-foreground">* The week is still running, so the share can still grow. &quot;Not yet&quot; means the week has not started, which is not the same as 0%.</p>
      </Card>

      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-3">
        <Card className="gs-in">
          <CardTitle hint={`Every account in exactly one group. The first rule that matches wins, top to bottom. Activity is counted in the last ${s.rangeDays} days.`}>Segments</CardTitle>
          <div className="gs-bar mb-4 flex h-3 overflow-hidden rounded-full bg-foreground/[0.06]" role="img" aria-label={s.segments.map((x) => `${x.label} ${x.users}`).join(", ")}>
            {s.segments.map((x) => (x.users > 0 ? <span key={x.key} style={{ width: `${(x.users / (segTotal || 1)) * 100}%`, background: SEG_COLOR[x.key] }} /> : null))}
          </div>
          <ol className="flex flex-col gap-2.5">
            {s.segments.map((x, i) => (
              <li key={x.key} className="flex items-start gap-2.5 text-[13px]">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEG_COLOR[x.key] }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{i + 1}. {x.label}</span>
                  <span className="block text-[12.5px] text-muted-foreground">{x.description}</span>
                </span>
                <span className="whitespace-nowrap tabular"><b>{n(x.users)}</b> <span className="text-muted-foreground">· {pct(x.share)}</span></span>
              </li>
            ))}
          </ol>
          <p className="mt-3 flex justify-between border-t border-border/60 pt-2.5 text-[13px]"><span className="font-medium">Total</span><span className="tabular"><b>{n(segTotal)}</b> <span className="text-muted-foreground">of {n(s.totals.users)} accounts</span></span></p>
        </Card>
        <SeriesChart
          className="gs-in"
          title="How often people come back"
          hint={`Accounts by number of active days in the last ${s.rangeDays} days. People who joined during the range had fewer days to be active.`}
          height={210}
          rows={s.frequency.map((f) => ({ label: f.bucket, users: f.users }))}
          series={[{ key: "users", name: "People", kind: "bar", color: "hsl(var(--lime-ink))" }]}
          table={{ head: ["Active days", "People"], rows: s.frequency.map((f) => [f.bucket, f.users]) }}
        />
        <SeriesChart
          className="gs-in"
          title="Weekly rhythm"
          hint="Average active people on each weekday in the range (UTC). A 30 day range holds some weekdays five times and others four, so totals would mislead."
          height={210}
          rows={s.weekday.map((d) => ({ label: d.day, avg: d.avg }))}
          series={[{ key: "avg", name: "Average active people", kind: "bar", color: "hsl(var(--lime))" }]}
          table={{ head: ["Weekday", "Average active", "Active person-days", "Days in range"], rows: s.weekday.map((d) => [d.day, d.avg, d.active, d.days]) }}
        />
      </div>

      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="gs-in">
          <CardTitle hint={`Accounts linked now. Publishes are per platform in the last ${s.rangeDays} days, practice runs left out.`}>Connected platforms</CardTitle>
          {s.platforms.length ? (
            <Table head={["Platform", "Connected", "Needs reconnect", "Publishes", "Success"]} minWidth={520}>
              {s.platforms.map((p) => (
                <tr key={p.platform}>
                  <td className="font-medium">{pname(p.platform)}</td>
                  <td className="tabular">{p.connected}</td>
                  <td className="tabular">{p.needsReconnect ? <Pill tone="warn">{p.needsReconnect}</Pill> : 0}</td>
                  <td className="tabular">{p.targets}</td>
                  <td className="tabular">{p.successRate === null ? <span className="text-muted-foreground">No attempts</span> : <Pill tone={p.successRate >= 0.9 ? "ok" : p.successRate >= 0.7 ? "warn" : "bad"}>{pct(p.successRate)}</Pill>}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">No one has connected a platform yet.</p>
          )}
        </Card>
        <Card className="gs-in">
          <CardTitle hint={`Posts created in the last ${s.rangeDays} days.`}>Posting habits</CardTitle>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            {[
              ["Posts created", n(s.posts.inRange)],
              ["Reached published", pct(s.posts.publishRate)],
              ["Scheduled ahead", pct(s.posts.scheduledShare)],
              ["Sent for approval", pct(s.posts.approvalShare)],
              ["Posts per creator", String(s.posts.avgPerCreator)],
              ["Sign-up to first publish", hoursText(s.posts.medianHoursToFirstPublish)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12.5px] text-muted-foreground">{k}</dt>
                <dd className="font-display text-[1.1rem] font-semibold tabular">{v}</dd>
              </div>
            ))}
          </dl>
          {Object.keys(s.posts.byStatus).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {Object.entries(s.posts.byStatus).map(([k, v]) => <Pill key={k} tone={k === "failed" ? "bad" : k === "published" ? "ok" : k === "draft" ? "muted" : "info"}>{k} {v}</Pill>)}
            </div>
          )}
          {s.errors.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-[12.5px] font-semibold text-muted-foreground">Top publish errors</p>
              <ul className="flex flex-col gap-1 text-[12.5px]">
                {s.errors.map((e) => <li key={e.code} className="flex justify-between gap-3"><code className="truncate">{e.code}</code><span className="tabular">{e.count}</span></li>)}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="gs-in">
          <CardTitle hint={`Average active days per person in the last ${s.rangeDays} days. Paying means an active or past-due plan today.`}>Paid versus free</CardTitle>
          <div className="flex flex-col gap-3">
            {([["Paying", s.plans.paidAvgActiveDays, s.plans.paidUsers], ["Free", s.plans.freeAvgActiveDays, s.plans.freeUsers]] as const).map(([k, v, c]) => (
              <div key={k}>
                <div className="mb-1 flex justify-between text-[13px]"><span className="font-medium">{k} <span className="text-muted-foreground">({n(c)} people)</span></span><b className="tabular">{v} days</b></div>
                <div className="h-2.5 overflow-hidden rounded-full bg-foreground/[0.06]"><div className={cn("gs-bar h-full rounded-full", k === "Paying" ? "bg-lime" : "bg-foreground/25")} style={{ width: `${(v / planMax) * 100}%` }} /></div>
              </div>
            ))}
            <p className="text-[12.5px] text-muted-foreground">{n(s.totals.weeklyReportOptIn)} of {n(s.totals.users)} accounts get the Monday report email.</p>
          </div>
        </Card>
        <Card className="gs-in">
          <CardTitle hint="Most active people in the range, then most published. Shown here only, never sent to Gemini. Addresses are masked unless you are a super admin.">Most engaged</CardTitle>
          {!people ? (
            <p className="text-[13.5px] text-muted-foreground">Your role can see the totals but not individual people.</p>
          ) : s.topUsers.length ? (
            <Table head={["Person", "Active days", "Posts", "Published", "Platforms", "Plan", "Last seen"]}>
              {s.topUsers.map((u) => (
                <tr key={u.id}>
                  <td>
                    <a href={`/admin/users?q=${encodeURIComponent(u.email.includes("*") ? u.name : u.email)}`} className="font-medium underline-offset-2 [@media(hover:hover)]:hover:underline">{u.name}</a>
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

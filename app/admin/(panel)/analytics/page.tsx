import { ExternalLink } from "lucide-react";
import { requireAdmin } from "@/lib/admin/guard";
import { analyticsReport, type Panel } from "@/lib/analytics/posthog-report";
import { parseRange } from "@/lib/analytics/posthog-query";
import { parseAnalyticsSource } from "@/lib/analytics/outlly-core";
import { outllyAnalytics } from "@/lib/admin/analytics";
import { parseWindow, windowLabel, type OutllyAnalytics } from "@/lib/admin/analytics-core";
import { Card, CardTitle, Empty, ErrorState, Hint, PageHead, Table } from "@/components/admin/ui";
import { FilterChips } from "@/components/admin/SearchBox";
import { AdminDateRangePicker, AdminFilterBar, ReportMeta } from "@/components/admin/FilterBar";
import { AdminKpi } from "@/components/admin/motion/AdminKpi";
import { SeriesChart } from "@/components/admin/SeriesChart";
import { FunnelBars } from "@/components/admin/motion/FunnelBars";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString("en-IN");
const pct = (r: number) => (r > 0 && r < 0.005 ? "<1%" : `${Math.round(r * 100)}%`);
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const NO_DATA = "Nothing recorded in this range yet. PostHog only counts visitors who accepted analytics cookies.";

function PanelError({ error }: { error: string }) {
  return <ErrorState title="Couldn't load this panel" body={error} />;
}

/** A breakdown table whose last row is the total, so a reader can check the rows add up. */
function Breakdown({ head, rows, total, label }: { head: string[]; rows: (string | number)[][]; total?: (string | number)[]; label: string }) {
  return (
    <Table label={label} head={head}>
      {rows.map((r, i) => (
        <tr key={i}>
          {r.map((c, j) => (
            <td key={j} className={j ? "tabular" : "max-w-[16rem] truncate font-medium"} title={j ? undefined : String(c)}>{typeof c === "number" ? n(c) : c}</td>
          ))}
        </tr>
      ))}
      {total && (
        <tr>
          {total.map((c, j) => (
            <td key={j} className={j ? "tabular font-semibold" : "font-semibold"}>{typeof c === "number" ? n(c) : c}</td>
          ))}
        </tr>
      )}
    </Table>
  );
}

function ListPanel<T>({ title, hint, panel, empty, render }: { title: string; hint: string; panel: Panel<T[]>; empty: string; render: (rows: T[]) => React.ReactNode }) {
  return (
    <Card>
      <CardTitle hint={hint}>{title}</CardTitle>
      {!panel.ok ? <PanelError error={panel.error} /> : panel.data.length === 0 ? <p className="text-[13.5px] text-muted-foreground">{empty}</p> : render(panel.data)}
    </Card>
  );
}

/** 1166: Outlly's own records. Every account and post counts, no cookie needed; one window drives every panel. */
function OutllyView({ r }: { r: OutllyAnalytics }) {
  const w = r.window;
  const span = w.custom ? "in the range" : `in the last ${w.days} days`;
  const t = r.totals;
  const start = r.funnel[0].count;
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5 [&>*]:min-w-0">
        <AdminKpi label="New accounts" value={n(t.signups)} sub={span} hint="Accounts created on a UTC day inside the range, both ends included." />
        <AdminKpi label="Waitlist joins" value={n(t.waitlist)} sub={span} hint="Waitlist entries created inside the range. Counted on their own, never as sign-ups." i={1} />
        <AdminKpi label="Active people" value={n(t.active)} sub={`used Outlly ${span}`} hint="Distinct people with at least one active day (they opened the studio) inside the range." i={2} />
        <AdminKpi label="Active today" value={n(t.activeToday)} sub="today, UTC" hint="Distinct people active on today's UTC date, whatever range is picked." i={3} />
        <AdminKpi label="Posts published" value={n(t.postsPublished)} sub={`${n(t.publishes)} platform publishes`} hint="Posts with at least one real publish in the range. A post sent to three platforms is one post and three platform publishes. Practice runs do not count." i={4} />
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <SeriesChart
          title="Signups"
          hint="New accounts and waitlist joins per UTC day."
          rows={r.daily.map((d) => ({ label: dayLabel(d.day), signups: d.signups, waitlist: d.waitlist }))}
          series={[{ key: "signups", name: "New accounts", kind: "bar", color: "hsl(var(--lime-ink))" }, { key: "waitlist", name: "Waitlist joins", kind: "line", color: "hsl(var(--accent))" }]}
          table={{ head: ["Day", "New accounts", "Waitlist joins"], rows: r.daily.map((d) => [dayLabel(d.day), d.signups, d.waitlist]) }}
          empty={{ title: "No signups in this range", body: "No new accounts or waitlist joins on any day in the range." }}
        />
        <SeriesChart
          title="Posts published"
          hint="Posts on the UTC day of their first real publish in the range, and platform publishes that day. Practice runs left out."
          rows={r.daily.map((d) => ({ label: dayLabel(d.day), posts: d.posts, publishes: d.publishes }))}
          series={[{ key: "posts", name: "Posts", kind: "bar", color: "hsl(var(--lime-ink))" }, { key: "publishes", name: "Platform publishes", kind: "line", color: "hsl(var(--foreground) / 0.7)" }]}
          table={{ head: ["Day", "Posts", "Platform publishes"], rows: r.daily.map((d) => [dayLabel(d.day), d.posts, d.publishes]) }}
          empty={{ title: "Nothing published in this range" }}
        />
      </div>

      <Card className="mb-5">
        <CardTitle hint="The people who created an account in the range. Each step counts those who also did every step before it, at any time up to now.">Signup funnel</CardTitle>
        {start === 0 ? (
          <p className="text-[13.5px] text-muted-foreground">Nobody signed up in this range, so there is no one to follow through the funnel.</p>
        ) : (
          <ol className="grid gap-3">
            {r.funnel.map((s, i) => (
              <li key={s.key} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_minmax(0,260px)]">
                <span className="flex items-center gap-1 text-[13.5px] font-semibold">{i + 1}. {s.label}<Hint text={s.rule} label={`How ${s.label} is counted`} /></span>
                <span className="relative h-9 overflow-hidden rounded-xl bg-secondary/70" aria-hidden>
                  <span className="lime-bg absolute inset-y-0 left-0 rounded-xl" style={{ width: `${Math.max(s.count ? 2 : 0, s.pctOfStart * 100)}%` }} />
                </span>
                <span className="text-[13px] tabular text-muted-foreground sm:text-right">
                  <b className="font-display text-[1.1rem] text-foreground">{n(s.count)}</b> · {pct(s.pctOfStart)} of step 1
                  {s.stepRate !== null && <span className="block">{pct(s.stepRate)} of step {i}, {n(s.dropped)} stopped{s.skipped ? `, ${n(s.skipped)} skipped a step` : ""}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 rounded-2xl bg-secondary/50 px-4 py-3 text-[13px] text-muted-foreground">
          <b className="text-foreground">Waitlist, counted on its own:</b> {n(r.waitlist.joined)} people joined {span}, {n(r.waitlist.withAccount)} of them have an account and {n(r.waitlist.inCohort)} signed up {span}. People can sign up without the waitlist, so it is not step 1.
        </p>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardTitle hint="The campaign link, friend's link or direct visit each new account arrived on. Connected, posted and paid are how many of those accounts have done it so far.">Signup sources</CardTitle>
          {r.sources.length ? <Breakdown label="Signups by source" head={["Source", "Signups", "Connected", "Posted", "Paying"]} rows={r.sources.map((s) => [s.label, s.signups, s.connected, s.posted, s.paid])} total={["Total", t.signups, r.sources.reduce((a, s) => a + s.connected, 0), r.sources.reduce((a, s) => a + s.posted, 0), r.sources.reduce((a, s) => a + s.paid, 0)]} /> : <p className="text-[13.5px] text-muted-foreground">No new accounts in this range.</p>}
        </Card>
        <Card>
          <CardTitle hint="Where new accounts last signed in from, approximately. Unknown when no location was recorded.">Countries</CardTitle>
          {r.countries.length ? <Breakdown label="New accounts by country" head={["Country", "Signups"]} rows={r.countries.map((c) => [c.label, c.count])} total={["Total", t.signups]} /> : <p className="text-[13.5px] text-muted-foreground">No new accounts in this range.</p>}
        </Card>
        <Card>
          <CardTitle hint="Platform publishes in the range. One post sent to two platforms counts once on each.">Platforms</CardTitle>
          {r.platforms.length ? <Breakdown label="Publishes by platform" head={["Platform", "Publishes"]} rows={r.platforms.map((p) => [p.label, p.count])} total={["Total", t.publishes]} /> : <p className="text-[13.5px] text-muted-foreground">No posts were published in this range.</p>}
        </Card>
      </div>
    </>
  );
}

export default async function AnalyticsPage(props: { searchParams: Promise<{ d?: string; src?: string; from?: string; to?: string }> }) {
  await requireAdmin("growth");
  const sp = await props.searchParams;
  const src = parseAnalyticsSource(sp.src);
  const win = parseWindow(src === "outlly" ? sp : { d: sp.d });
  const source = <FilterChips param="src" label="Data source" current={src === "posthog" ? "posthog" : ""} options={[{ value: "", label: "Outlly data" }, { value: "posthog", label: "PostHog" }]} />;
  const range = <AdminDateRangePicker param="d" label="Date range" current={win.preset ?? 30} custom={src === "outlly"} from={win.custom ? win.from : null} to={win.custom ? win.to : null} />;

  if (src === "outlly") {
    const r = await outllyAnalytics(win);
    return (
      <>
        <PageHead title="Analytics" body="Outlly's own records: every account and post counts, no cookies needed. Visitors who never sign up are only in PostHog. The two sources are shown one at a time and never added together." />
        <AdminFilterBar label="Analytics filters" meta={<ReportMeta source="Outlly data" range={windowLabel(win)} tz={r.timezone} updatedAt={r.generatedAt} />}>
          {source}
          {range}
        </AdminFilterBar>
        <OutllyView r={r} />
      </>
    );
  }

  const days = parseRange(sp.d);
  const report = await analyticsReport(days);
  const customAsked = !!(sp.from && sp.to);
  const open = (
    <a href={report.projectUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background sm:h-9">
      Open in PostHog <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">(opens in a new tab)</span>
    </a>
  );
  const bar = (
    <AdminFilterBar label="Analytics filters" meta={report.connected ? <>PostHog · Last {days} days, rolling · UTC days · refreshes every 5 minutes</> : <>PostHog · not connected</>}>
      {source}
      {report.connected && range}
    </AdminFilterBar>
  );
  const note = customAsked ? <p role="status" className="mb-5 rounded-2xl bg-secondary/60 px-4 py-3 text-[13.5px]">Custom dates work with Outlly data only. PostHog shows the last {days} days.</p> : null;

  if (!report.connected) {
    return (
      <>
        <PageHead title="Analytics" body="Site traffic and the signup funnel, from PostHog. Switch to Outlly data for numbers from Outlly's own records." actions={open} />
        {bar}
        <Card>
          <Empty title="PostHog is not connected" body={`The reports need ${report.missing.join(" and ")} set in the server environment, then a redeploy. No PostHog numbers are shown until then.`}>
            <p className="max-w-md text-[13.5px] text-muted-foreground">
              {report.tracking ? "Tracking is already on for visitors who accept analytics cookies, so data is being collected meanwhile." : "Tracking is off too: NEXT_PUBLIC_POSTHOG_KEY is empty."}{" "}
              <a href="https://posthog.com/docs" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-4">PostHog docs<span className="sr-only"> (opens in a new tab)</span></a>
            </p>
          </Empty>
        </Card>
      </>
    );
  }

  const { daily, signups, funnel, pages, referrers, countries } = report;
  return (
    <>
      <PageHead title="Analytics" body={`Site traffic from PostHog, which only counts visitors who accepted analytics cookies. These numbers are never added to Outlly data, so nobody is counted twice.`} actions={open} />
      {bar}
      {note}

      <div className="mb-5 grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        {!daily.ok ? (
          <Card><CardTitle>Visitors</CardTitle><PanelError error={daily.error} /></Card>
        ) : (
          <SeriesChart
            title="Visitors"
            hint="Unique visitors and page views per UTC day."
            rows={daily.data.map((d) => ({ label: dayLabel(d.day), visitors: d.visitors, pageviews: d.pageviews }))}
            series={[{ key: "visitors", name: "Visitors", kind: "bar", color: "hsl(var(--lime-ink))" }, { key: "pageviews", name: "Page views", kind: "line", color: "hsl(var(--foreground) / 0.7)" }]}
            table={{ head: ["Day", "Visitors", "Page views"], rows: daily.data.map((d) => [dayLabel(d.day), d.visitors, d.pageviews]) }}
            empty={{ title: "No visits recorded", body: NO_DATA }}
          />
        )}
        {!signups.ok ? (
          <Card><CardTitle>Signups</CardTitle><PanelError error={signups.error} /></Card>
        ) : (
          <SeriesChart
            title="Signups"
            hint="signup_completed events per UTC day. Only visitors who accepted cookies, so this can be lower than Outlly's new accounts."
            rows={signups.data.map((d) => ({ label: dayLabel(d.day), count: d.count }))}
            series={[{ key: "count", name: "Signups", kind: "bar", color: "hsl(var(--lime-ink))" }]}
            table={{ head: ["Day", "Signups"], rows: signups.data.map((d) => [dayLabel(d.day), d.count]) }}
            empty={{ title: "No signups recorded", body: NO_DATA }}
          />
        )}
      </div>

      <Card className="mb-5">
        <CardTitle hint="People seen in the range. Each step counts people who also did every step before it, in any order.">Signup funnel</CardTitle>
        {!funnel.ok ? <PanelError error={funnel.error} /> : funnel.data[0].count === 0 ? <p className="text-[13.5px] text-muted-foreground">{NO_DATA}</p> : <FunnelBars steps={funnel.data} worstKey={null} />}
      </Card>

      <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
        <ListPanel title="Top pages" hint="Most viewed pages." panel={pages} empty={NO_DATA} render={(rows) => <Breakdown label="Top pages" head={["Page", "Views", "Visitors"]} rows={rows.map((p) => [p.path, p.views, p.visitors])} />} />
        <ListPanel title="Top referrers" hint="Where visitors came from." panel={referrers} empty={NO_DATA} render={(rows) => <Breakdown label="Top referrers" head={["Source", "Visitors"]} rows={rows.map((p) => [p.domain, p.visitors])} />} />
        <ListPanel title="Countries" hint="Approximate, from the visitor's network." panel={countries} empty={NO_DATA} render={(rows) => <Breakdown label="Visitors by country" head={["Country", "Visitors"]} rows={rows.map((p) => [p.country, p.visitors])} />} />
      </div>
    </>
  );
}

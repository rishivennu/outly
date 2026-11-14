import { ExternalLink } from "lucide-react";
import { requireAdmin } from "@/lib/admin/guard";
import { analyticsReport, type Panel } from "@/lib/analytics/posthog-report";
import { parseRange, type RangeDays } from "@/lib/analytics/posthog-query";
import { Card, CardTitle, Empty, PageHead } from "@/components/admin/ui";
import { FilterChips } from "@/components/admin/SearchBox";
import { FunnelBars } from "@/components/admin/motion/FunnelBars";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString("en-IN");
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const NO_DATA = "Nothing recorded in this range yet. Visitors are only counted after they accept analytics cookies.";

function PanelError({ error }: { error: string }) {
  return (
    <p role="status" className="rounded-2xl bg-secondary/60 px-4 py-3 text-[13.5px]">
      Couldn't load this panel. {error}
    </p>
  );
}

function SimpleTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[13.5px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={`border-b border-border pb-2 text-[12px] font-semibold text-muted-foreground ${i ? "pl-4 text-right" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="max-w-[18rem] truncate border-b border-border/60 py-2.5 text-left font-medium" title={String(c)}>{c}</th>
                ) : (
                  <td key={i} className="tabular border-b border-border/60 py-2.5 pl-4 text-right">{typeof c === "number" ? n(c) : c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bars are decorative; the summary and the table under them carry every number. */
function DayBars({ label, days, value, unit }: { label: string; days: { day: string }[]; value: (i: number) => number; unit: string }) {
  const values = days.map((_, i) => value(i));
  const top = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <figure>
      <div role="img" aria-label={`${label}: ${n(total)} ${unit} over ${days.length} days, busiest day ${n(top === 1 && total === 0 ? 0 : top)}.`} className="flex h-36 items-end gap-[2px] rounded-2xl bg-secondary/40 p-2">
        {values.map((v, i) => (
          <span key={days[i].day} title={`${dayLabel(days[i].day)}: ${n(v)}`} className="lime-bg min-w-[2px] flex-1 rounded-t-[3px]" style={{ height: `${v ? Math.max(3, (v / top) * 100) : 0}%` }} />
        ))}
      </div>
      <figcaption className="mt-2 flex justify-between text-[12px] text-muted-foreground">
        <span>{dayLabel(days[0].day)}</span>
        <span>{dayLabel(days[days.length - 1].day)}</span>
      </figcaption>
    </figure>
  );
}

function DataDetails({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-3">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13px] font-medium underline-offset-4 hover:underline">Show the numbers as a table</summary>
      <div className="mt-2 max-h-80 overflow-y-auto">{children}</div>
    </details>
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

export default async function AnalyticsPage(props: { searchParams: Promise<{ d?: string }> }) {
  await requireAdmin("growth");
  const days: RangeDays = parseRange((await props.searchParams).d);
  const report = await analyticsReport(days);
  const open = (
    <a href={report.projectUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background sm:h-9">
      Open in PostHog <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">(opens in a new tab)</span>
    </a>
  );
  const range = <FilterChips param="d" current={days === 30 ? "" : String(days)} options={[{ value: "7", label: "7 days" }, { value: "", label: "30 days" }, { value: "90", label: "90 days" }]} />;

  if (!report.connected) {
    return (
      <>
        <PageHead title="Analytics" body="Site traffic and the signup funnel, from PostHog." actions={open} />
        <Card>
          <Empty title="Not connected yet" body={`The reports need ${report.missing.join(" and ")} set in the server environment, then a redeploy.`}>
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
      <PageHead title="Analytics" body={`The last ${days} days of site traffic, from PostHog. Only visitors who accepted analytics cookies are counted; numbers refresh every 5 minutes.`} actions={<>{range}{open}</>} />

      <Card className="mb-5">
        <CardTitle hint="Unique visitors and page views per day (UTC).">Visitors</CardTitle>
        {!daily.ok ? (
          <PanelError error={daily.error} />
        ) : daily.data.every((d) => d.pageviews === 0) ? (
          <p className="text-[13.5px] text-muted-foreground">{NO_DATA}</p>
        ) : (
          <>
            <p className="mb-3 text-[13.5px]">
              <b className="font-display text-[1.15rem] tabular">{n(daily.data.reduce((a, d) => a + d.visitors, 0))}</b> visitor-days, <b className="tabular">{n(daily.data.reduce((a, d) => a + d.pageviews, 0))}</b> page views
            </p>
            <DayBars label="Unique visitors per day" days={daily.data} value={(i) => daily.data[i].visitors} unit="visitor-days" />
            <DataDetails>
              <SimpleTable caption="Visitors and page views per day" head={["Day", "Visitors", "Page views"]} rows={daily.data.map((d) => [dayLabel(d.day), d.visitors, d.pageviews])} />
            </DataDetails>
          </>
        )}
      </Card>

      <div className="mb-5 grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardTitle hint="Each step counts people who also did every step before it, in this range.">Signup funnel</CardTitle>
          {!funnel.ok ? <PanelError error={funnel.error} /> : funnel.data[0].count === 0 ? <p className="text-[13.5px] text-muted-foreground">{NO_DATA}</p> : <FunnelBars steps={funnel.data} worstKey={null} />}
        </Card>
        <Card>
          <CardTitle hint="New accounts per day (UTC).">Signups</CardTitle>
          {!signups.ok ? (
            <PanelError error={signups.error} />
          ) : signups.data.every((d) => d.count === 0) ? (
            <p className="text-[13.5px] text-muted-foreground">No signups recorded in this range yet.</p>
          ) : (
            <>
              <DayBars label="Signups per day" days={signups.data} value={(i) => signups.data[i].count} unit="signups" />
              <DataDetails>
                <SimpleTable caption="Signups per day" head={["Day", "Signups"]} rows={signups.data.map((d) => [dayLabel(d.day), d.count])} />
              </DataDetails>
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
        <ListPanel title="Top pages" hint="Most viewed pages." panel={pages} empty={NO_DATA} render={(r) => <SimpleTable caption="Top pages" head={["Page", "Views", "Visitors"]} rows={r.map((p) => [p.path, p.views, p.visitors])} />} />
        <ListPanel title="Top referrers" hint="Where visitors came from." panel={referrers} empty={NO_DATA} render={(r) => <SimpleTable caption="Top referrers" head={["Source", "Visitors"]} rows={r.map((p) => [p.domain, p.visitors])} />} />
        <ListPanel title="Countries" hint="Approximate, from the visitor's network." panel={countries} empty={NO_DATA} render={(r) => <SimpleTable caption="Visitors by country" head={["Country", "Visitors"]} rows={r.map((p) => [p.country, p.visitors])} />} />
      </div>
    </>
  );
}

import { requireAdmin } from "@/lib/admin/guard";
import { Card, CardTitle, Empty, PageHead, Table, fmtDate } from "@/components/admin/ui";
import { byVersion, fmtMetric, SEGMENTS, summarize, type Segment, type Stat, type Summary } from "@/lib/perf/aggregate";
import { METRIC_LABEL, PERF_METRICS, type PerfMetric } from "@/lib/perf/sample";
import { perfRows } from "@/lib/perf/store";

export const metadata = { title: "Startup speed" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const SEGMENT_LABEL: Record<Segment, string> = { all: "All loads", cold: "Cold", warm: "Warm", installed: "Installed app", browser: "Browser" };
const VERSION_METRICS: PerfMetric[] = ["ttfb", "fcp", "lcp", "cls", "hydrate", "content", "mwMs", "userMs"];

function Cell({ m, s }: { m: PerfMetric; s: Stat }) {
  if (!s.n) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="tabular-nums">
      {fmtMetric(m, s.p50)} / {fmtMetric(m, s.p75)} / {fmtMetric(m, s.p95)}
      <span className="block text-[12px] text-muted-foreground">{s.n.toLocaleString("en-IN")} loads</span>
    </span>
  );
}

function Window({ title, sum }: { title: string; sum: Summary }) {
  return (
    <Card className="mb-4">
      <CardTitle hint="Each cell is p50 / p75 / p95.">{`${title}: ${sum.samples.all.toLocaleString("en-IN")} page loads`}</CardTitle>
      {sum.samples.all ? (
        <Table label={`Startup timings, ${title}`} mobile="scroll" minWidth={900} head={["Metric", ...SEGMENTS.map((s) => `${SEGMENT_LABEL[s]} (${sum.samples[s]})`)]}>
          {PERF_METRICS.map((m) => (
            <tr key={m}>
              <th scope="row" className="text-left font-medium">{METRIC_LABEL[m]}</th>
              {SEGMENTS.map((s) => (
                <td key={s}>
                  <Cell m={m} s={sum.metrics[m][s]} />
                </td>
              ))}
            </tr>
          ))}
        </Table>
      ) : (
        <Empty title="No page loads in this window" body="Timings arrive from signed-in studio pages, one per load." />
      )}
    </Card>
  );
}

/** C3: startup timings from real page loads (components/shell/PerfBeacon.tsx), so a release's effect is one glance. */
export default async function PerfPage() {
  await requireAdmin("site");
  const now = Date.now();
  const rows = await perfRows(new Date(now - 7 * DAY));
  const day = summarize(rows, new Date(now - DAY));
  const week = summarize(rows);
  const versions = byVersion(rows);
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Startup speed"
        body="How long the studio takes to appear on real devices. Cold = first load of a session."
      />
      <Window title="Last 24 hours" sum={day} />
      <Window title="Last 7 days" sum={week} />
      <Card>
        <CardTitle hint="p75 per release over the last 7 days, newest first.">By version</CardTitle>
        {versions.length ? (
          <Table label="Startup timings by version" mobile="scroll" minWidth={900} head={["Version", "Loads", "Seen", ...VERSION_METRICS.map((m) => METRIC_LABEL[m])]}>
            {versions.map((v) => (
              <tr key={v.version}>
                <th scope="row" className="text-left font-mono text-[12.5px] font-medium">{v.version}</th>
                <td className="tabular-nums">{v.samples.toLocaleString("en-IN")}</td>
                <td className="text-[12.5px] text-muted-foreground">
                  {fmtDate(v.first, true)} to {fmtDate(v.last, true)}
                </td>
                {VERSION_METRICS.map((m) => (
                  <td key={m} className="tabular-nums">{fmtMetric(m, v.p75[m])}</td>
                ))}
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="No versions yet" />
        )}
      </Card>
    </>
  );
}

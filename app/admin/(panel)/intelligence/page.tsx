import { requireAdmin } from "@/lib/admin/guard";
import { ACTIVE_MODEL } from "@/lib/intelligence/model/predict";
import { intelligenceGovernance } from "@/lib/intelligence/shared";
import { Card, CardTitle, Empty, PageHead, Pill, Table, fmtDate } from "@/components/admin/ui";
import { AdminKpi } from "@/components/admin/motion/AdminKpi";
import { RebuildButton, VersionActions } from "@/components/admin/intelligence/IntelligencePanel";

export const metadata = { title: "Intelligence" };
export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const num = (n: number) => n.toLocaleString("en-IN");

/**
 * R1324 (Phase 6): governance for Personal Intelligence. What model is live, how its forecasts have done week by week
 * across creators, whether that is drifting, and the anonymised shared baselines: which buckets exist, how many
 * creators and posts are behind each, and who opted out (a count). Nothing here names a creator or a post.
 */
export default async function Intelligence() {
  await requireAdmin("intelligence");
  const g = await intelligenceGovernance({ modelKey: ACTIVE_MODEL, weeks: 12 });
  const driftTone = g.drift.verdict === "drifting" ? "warn" : g.drift.verdict === "improving" ? "ok" : g.drift.verdict === "steady" ? "info" : "muted";
  const latest = g.accuracy[g.accuracy.length - 1];
  const participating = g.participation.consented;

  return (
    <>
      <PageHead eyebrow="Insights" title="Intelligence" body="The forecasting model, its accuracy, and the anonymised cohort baselines it leans on. Aggregates only." actions={<RebuildButton />} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi i={0} label="Active model" value={g.modelKey} sub={`${num(g.predictions.total)} forecasts · ${num(g.predictions.evaluated)} evaluated`} hint="Every forecast is written before the outcome is known and filled with the actual after the post's first week." />
        <AdminKpi i={1} label={latest ? `Accuracy, week ${latest.week}` : "Accuracy, latest week"} value={latest ? pct(latest.mape) : "—"} sub={latest ? `MAPE across ${latest.owners} creator${latest.owners === 1 ? "" : "s"}, ${latest.n} posts` : "No evaluated week yet"} hint="Mean absolute percentage error over the forecasts judged that week. Lower is better." />
        <AdminKpi i={2} label="Drift" value={g.drift.deltaPts === null ? "—" : `${g.drift.deltaPts > 0 ? "+" : ""}${g.drift.deltaPts} pts`} sub={g.drift.verdict} hint="The last 4 evaluated weeks against the 4 before them. More than 10 points worse is drifting." />
        <AdminKpi i={3} label="Help improve Outlly AI" value={g.participation.creators ? `${Math.round((participating / g.participation.creators) * 100)}%` : "—"} sub={`${num(participating)} of ${num(g.participation.creators)} creators opted in · ${num(g.participation.withdrawn)} withdrew${g.participation.deletionsOpen ? ` · ${num(g.participation.deletionsOpen)} deletion${g.participation.deletionsOpen === 1 ? "" : "s"} pending` : ""}`} hint="Creators who explicitly said yes (never preselected). Only their measured posts may join the anonymised buckets; everyone else's stay home. Consent never changes anyone's own predictions." />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="One line per ISO week, each forecast filed under the week its outcome became known: the mean absolute percentage error, the share of actuals inside the predicted band, and the mean signed bias (positive = over-predicts).">Accuracy by week</CardTitle>
          {g.accuracy.length === 0 ? <Empty title="No evaluated forecasts yet" body="A forecast is evaluated once its post is a week old and measured. The first evaluated week starts this table." /> : (
            <Table label="Accuracy by week" head={["Week", "Creators", "Posts", "MAPE", "In band", "Bias"]} lead={1} align={[undefined, "right", "right", "right", "right", "right"]} minWidth={520}>
              {[...g.accuracy].reverse().map((w) => (
                <tr key={w.week}>
                  <td className="font-medium">{w.week}</td>
                  <td className="text-right tabular-nums">{num(w.owners)}</td>
                  <td className="text-right tabular-nums">{num(w.n)}</td>
                  <td className="text-right tabular-nums">{pct(w.mape)}</td>
                  <td className="text-right tabular-nums">{pct(w.within)}</td>
                  <td className="text-right tabular-nums">{w.biasPct === null ? "—" : `${w.biasPct > 0 ? "+" : ""}${w.biasPct.toFixed(1)}%`}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-[12.5px] text-muted-foreground"><Pill tone={driftTone}>{g.drift.verdict}</Pill> {g.drift.recentMape === null || g.drift.priorMape === null ? "Drift needs at least 8 evaluated weeks." : `Recent 4 weeks ${pct(g.drift.recentMape)} against ${pct(g.drift.priorMape)} before.`}</p>
        </Card>

        <Card>
          <CardTitle hint="Forecasts per platform and how many have an actual to compare against.">Forecasts by platform</CardTitle>
          {g.predictions.byPlatform.length === 0 ? <Empty title="No forecasts yet" /> : (
            <Table label="Forecasts by platform" head={["Platform", "Forecasts", "Evaluated"]} lead={1} align={[undefined, "right", "right"]} minWidth={320}>
              {g.predictions.byPlatform.map((p) => (
                <tr key={p.platform}>
                  <td className="font-medium capitalize">{p.platform}</td>
                  <td className="text-right tabular-nums">{num(p.total)}</td>
                  <td className="text-right tabular-nums">{num(p.evaluated)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card className="mb-4">
        <CardTitle hint={`Built from measured posts of the last ${g.shared?.windowDays ?? 180} days, each past its first week. A bucket, and each statistic in it, is published only with at least ${g.shared?.minOwners ?? 5} creators and ${g.shared?.minPosts ?? 20} posts and no creator above half of it. The number carried is views per follower, so it scales to any account size.`}>Shared baselines</CardTitle>
        {!g.shared ? (
          g.sharedStatus && g.sharedStatus !== "active" ? (
            <Empty title={`Document ${g.sharedStatus}`} body="Stored but served to nobody: every creator's estimate is their own numbers only. Activate it below to serve it again." />
          ) : (
            <Empty title="Not built yet" body="Rebuild now, or wait for the hourly sweep. Until then every creator's estimate is their own numbers only." />
          )
        ) : (
          <>
            <p className="mb-3 text-[12.5px] text-muted-foreground">
              Built <time dateTime={g.shared.builtAt ?? undefined}>{fmtDate(g.shared.builtAt)}</time> from {num(g.shared.rows)} posts by {num(g.shared.owners)} creators. {num(g.shared.buckets.length)} bucket{g.shared.buckets.length === 1 ? "" : "s"} published, {num(g.shared.dropped)} too thin or too concentrated to publish.{g.shared.truncated ? " The row cap was hit, so the window was not read in full." : ""}
            </p>
            {g.shared.buckets.length === 0 ? <Empty title="No bucket clears the threshold yet" body="Buckets appear as more creators have measured posts of the same format on the same platform." /> : (
              <Table label="Shared baselines" head={["Bucket", "Creators", "Posts", "Top creator share", "Views / follower (median)", "Views (median)", "Engagement (median)"]} lead={1} align={[undefined, "right", "right", "right", "right", "right", "right"]} minWidth={820}>
                {g.shared.buckets.map((b) => (
                  <tr key={b.key}>
                    <td><div className="font-medium capitalize">{b.platform} · {b.format}</div>{b.category && <div className="text-[12px] text-muted-foreground">{b.category}</div>}</td>
                    <td className="text-right tabular-nums">{num(b.owners)}</td>
                    <td className="text-right tabular-nums">{num(b.n)}</td>
                    <td className="text-right tabular-nums">{Math.round(b.topOwnerShare * 100)}%</td>
                    <td className="text-right tabular-nums">{b.viewsPerFollower ? `${b.viewsPerFollower.median.toFixed(3)} (${b.viewsPerFollower.n})` : "—"}</td>
                    <td className="text-right tabular-nums">{b.views ? `${num(Math.round(b.views.median))} (${b.views.n})` : "—"}</td>
                    <td className="text-right tabular-nums">{b.engagementRate ? `${b.engagementRate.median.toFixed(2)}% (${b.engagementRate.n})` : "—"}</td>
                  </tr>
                ))}
              </Table>
            )}
          </>
        )}
      </Card>

      <Card className="mb-4">
        <CardTitle hint={`One row per shared-model build (hourly, or at once for a deletion request). Each build reads consented creators' measured posts only, is validated before it is served (no creator id inside the document, every bucket past the floors) and compared with the build before. A failed validation serves an empty document and raises an admin event; an odd-looking build is served and flagged. Records are kept ${g.builds.retentionDays} days. Lineage: one pseudonymous row per contributor (an HMAC of the owner id, no user id stored), updated by every build; a deletion request clears its references.`}>Builds and lineage</CardTitle>
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          {num(g.builds.total)} build{g.builds.total === 1 ? "" : "s"} on record · {num(g.builds.flagged30d)} flagged and {num(g.builds.failed30d)} failed validation in 30 days · lineage {num(g.builds.lineage.active)} active contributor{g.builds.lineage.active === 1 ? "" : "s"} ({num(g.builds.lineage.recordsActive)} posts referenced), {num(g.builds.lineage.inactive)} inactive, {num(g.builds.lineage.deleted)} deleted on request.
          {g.builds.latest && ` Latest ${g.builds.latest.datasetVersion}: read ${num(g.builds.latest.rowsRead)} rows, kept ${num(g.builds.latest.rowsKept)}; rejected ${num(g.builds.latest.rejected.unmeasured)} unmeasured, ${num(g.builds.latest.rejected.noMetric)} without a metric, ${num(g.builds.latest.rejected.thinBuckets)} thin bucket${g.builds.latest.rejected.thinBuckets === 1 ? "" : "s"}${g.builds.latest.rejected.truncated ? ", row cap hit" : ""}; ${num(g.builds.latest.durationMs)} ms.`}
        </p>
        {g.builds.recent.length === 0 ? <Empty title="No build recorded yet" body="The next hourly sweep, or Rebuild now, writes the first record." /> : (
          <Table label="Shared model builds" head={["Version", "Built", "Trigger", "Creators", "Posts", "Buckets", "Validation", "Served", "Flag"]} lead={1} align={[undefined, undefined, undefined, "right", "right", "right"]} minWidth={860}>
            {g.builds.recent.map((b) => (
              <tr key={b.seq}>
                <td className="font-medium">{b.datasetVersion}</td>
                <td className="whitespace-nowrap text-[12.5px] text-muted-foreground"><time dateTime={b.builtAt}>{fmtDate(b.builtAt)}</time></td>
                <td className="capitalize">{b.trigger}</td>
                <td className="text-right tabular-nums">{num(b.contributors)}</td>
                <td className="text-right tabular-nums">{num(b.rowsKept)}</td>
                <td className="text-right tabular-nums">{num(b.buckets)}</td>
                <td><Pill tone={b.validation === "passed" ? "ok" : "warn"}>{b.validation}</Pill></td>
                <td>{b.served ? "Yes" : "No"}</td>
                <td className="max-w-[24rem] text-[12.5px] text-muted-foreground">{b.anomaly ?? "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardTitle hint="Every scorer and shared document the engine has used, newest first. Retiring the shared document stops every creator reading it within a few minutes (live estimates at the next cache turn; a stored calibration that leaned on it is recomputed on its next read); the active scorer stays until a replacement is shipped.">Model versions</CardTitle>
        {g.versions.length === 0 ? <Empty title="No versions recorded yet" body="The first personal-intelligence sweep registers the baseline scorer." /> : (
          <Table label="Model versions" head={["Key", "Kind", "Features v", "Status", "Notes", "Since"]} lead={1} minWidth={760}>
            {g.versions.map((v) => (
              <tr key={v.key}>
                <td className="font-medium">{v.key}</td>
                <td className="capitalize">{v.kind}</td>
                <td className="tabular-nums">{v.featureVersion}</td>
                <td><VersionActions version={v} locked={v.key === ACTIVE_MODEL} /></td>
                <td className="max-w-[28rem] text-[12.5px] text-muted-foreground">{v.notes ?? "—"}</td>
                <td className="whitespace-nowrap text-[12.5px] text-muted-foreground"><time dateTime={v.createdAt}>{fmtDate(v.createdAt)}</time></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

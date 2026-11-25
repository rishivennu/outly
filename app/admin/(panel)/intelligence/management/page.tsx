import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { intelligenceManagement } from "@/lib/intelligence/management";
import { CAPABILITY_LABEL, type Capability } from "@/lib/intelligence/entitlements-core";
import { CATEGORY_LABEL, type ConsentCategory } from "@/lib/intelligence/consent-core";
import { Card, CardTitle, Empty, PageHead, Pill, Table, fmtDate } from "@/components/admin/ui";
import { AdminKpi } from "@/components/admin/motion/AdminKpi";

export const metadata = { title: "AI Management" };
export const dynamic = "force-dynamic";

const num = (n: number) => n.toLocaleString("en-IN");
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${num(Math.round(n))} ms`);
const capLabel = (c: string) => (c in CAPABILITY_LABEL ? CAPABILITY_LABEL[c as Capability] : c);
const catLabel = (c: string) => (c in CATEGORY_LABEL ? CATEGORY_LABEL[c as ConsentCategory].label : c);
const sorted = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/**
 * R1337 (Phase 4): AI Intelligence Management. Five sections, every figure counted from rows at request time: who has
 * the engine by plan, who consented to the shared model, what the shared training pipeline did, how the personal engine
 * is keeping up, and the privacy ledger. A figure that has not been measured yet says so; nothing here is a placeholder,
 * and nothing names a creator.
 */
export default async function Management() {
  await requireAdmin("intelligence");
  const m = await intelligenceManagement();
  const a = m.access;
  const paid = a.users - a.free;
  const c = m.consent;
  const b = m.shared.builds;
  const p = m.personal;
  const j = p.jobs;
  const personalJob = j.jobs.find((x) => x.job === "personal");
  const sharedJob = j.jobs.find((x) => x.job === "shared");
  const fresh = p.profiles.freshness;
  const verdictTone = m.privacy.isolation.verdict === "verified" ? "ok" : m.privacy.isolation.verdict === "attention" ? "bad" : "muted";

  return (
    <>
      <PageHead
        eyebrow="Insights"
        title="AI Intelligence Management"
        body="Plan-based access, consent, shared-model training, the personal engine and the privacy ledger: live counts from the database, read when this page loads."
        actions={<Link href="/admin/intelligence" className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium hover:bg-secondary">Model governance</Link>}
      />

      {/* 1. Subscription distribution */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi i={0} label="Free accounts" value={num(a.free)} sub={`${pct(a.free, a.users)} of ${num(a.users)} accounts${a.freePlanGrantsAccess ? " · the Free plan lists the perk" : " · no Personal Intelligence"}`} hint="Accounts with no live paid subscription, gift, admin grant or referral reward right now. They see the honest upgrade explanation, never locked cards." />
        <AdminKpi i={1} label="Paid with access" value={num(a.perk + a.legacyPaid)} sub={`${num(a.perk)} by the perk · ${num(a.legacyPaid)} on a pre-perk plan`} hint="Live accounts whose winning plan lists the personal-intelligence perk, plus plans made before perks existed (every perk). Same rule the routes use (intelligenceAccessOf)." />
        <AdminKpi i={2} label="Paid without access" value={num(a.planWithoutPerk)} sub={paid ? `${pct(a.planWithoutPerk, paid)} of ${num(paid)} paying or granted accounts` : "No paying account yet"} hint="A live plan that lists its perks without personal-intelligence. Turn it on per plan in Admin > Pricing." />
        <AdminKpi i={3} label="Entitlement checks failed" value={num(m.denials.total)} sub={m.denials.total ? `${num(m.denials.owners)} account${m.denials.owners === 1 ? "" : "s"} · ${num(m.denials.last7d)} in 7 days` : "None in 30 days"} hint="Server-side denials (402 PLAN_LIMIT) in 30 days, one per account, capability and UTC day. Each one is a client that asked for a paid capability without the plan: the normal upgrade path, or a tampered client." />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="Each live account counted once under the plan that wins for it (highest tier, then paid before admin, referral, gift). Accounts with nothing live are on Free.">Access by plan</CardTitle>
          {a.byPlan.length === 0 ? <Empty title="No account yet" /> : (
            <Table label="Access by plan" head={["Plan", "Accounts", "Personal Intelligence", "Why"]} lead={1} align={[undefined, "right"]} minWidth={480}>
              {a.byPlan.map((r) => (
                <tr key={r.planSlug}>
                  <td className="font-medium">{r.planName}<span className="block text-[12px] text-muted-foreground">{r.planSlug}</span></td>
                  <td className="text-right tabular-nums">{num(r.users)}</td>
                  <td><Pill tone={r.enabled ? "ok" : "muted"}>{r.enabled ? "on" : "off"}</Pill></td>
                  <td className="text-[12.5px] text-muted-foreground">{r.reason === "perk" ? "plan lists the perk" : r.reason === "legacy-paid" ? "pre-perk plan, paid" : r.reason === "plan-without-perk" ? "plan lists perks without it" : "Free plan"}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            By source: {num(a.bySource.paid)} paid · {num(a.bySource.admin)} admin grant · {num(a.bySource.referral)} referral · {num(a.bySource.gift)} gift · {num(a.bySource.free)} free.{a.truncated ? " The read hit its row cap, so the split may be short." : ""}
          </p>
        </Card>

        <Card>
          <CardTitle hint="LearningEvent entitlement_denied rows of the last 30 days, split by the capability the client asked for and by why the account lacked it.">Denied capabilities (30 days)</CardTitle>
          {m.denials.total === 0 ? <Empty title="No denied request in 30 days" body="Every call to a paid Intelligence route in the window came from an account with the plan." /> : (
            <>
              <Table label="Denied capabilities" head={["Capability", "Denials"]} lead={1} align={[undefined, "right"]} minWidth={320}>
                {sorted(m.denials.byCapability).map(([cap, n]) => (
                  <tr key={cap}>
                    <td className="font-medium">{capLabel(cap)}</td>
                    <td className="text-right tabular-nums">{num(n)}</td>
                  </tr>
                ))}
              </Table>
              <p className="mt-3 text-[12.5px] text-muted-foreground">
                By reason: {sorted(m.denials.byReason).map(([r, n]) => `${r} ${num(n)}`).join(" · ")}. Last {m.denials.lastAt ? <time dateTime={m.denials.lastAt}>{fmtDate(m.denials.lastAt)}</time> : "—"}.
              </p>
            </>
          )}
        </Card>
      </div>

      {/* 2. Data consent */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi i={0} label="Opted in" value={num(c.granted)} sub={`${pct(c.granted, a.users)} of ${num(a.users)} accounts · policy ${c.policyVersion}`} hint="Accounts whose newest consent decision is granted. Never preselected: an account with no decision has not consented." />
        <AdminKpi i={1} label="Opted out" value={num(c.withdrawn)} sub={`${num(c.neverAsked)} never answered`} hint="Accounts whose newest decision is withdrawn. Withdrawal stops new contributions at once and takes their rows out of the shared document at the next rebuild." />
        <AdminKpi i={2} label="Withdrawals, 30 days" value={num(c.decisions30d.withdrawn)} sub={`${num(c.decisions30d.granted)} grants in the same 30 days`} hint="Decisions recorded in the last 30 days, by kind." />
        <AdminKpi i={3} label="Deletion requests" value={num(c.deletionsOpen)} sub={`${num(c.deletionsDone)} completed`} hint="Open requests to remove an account's contributions. An open request rebuilds the shared document on the next sweep tick and clears the account's lineage references." />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="Among accounts currently opted in: how many agreed to each data category (every grant lists them explicitly).">Consent by category</CardTitle>
          {c.granted === 0 ? <Empty title="Nobody has opted in yet" /> : (
            <Table label="Consent by category" head={["Category", "Accounts"]} lead={1} align={[undefined, "right"]} minWidth={320}>
              {c.categories.map((cat) => (
                <tr key={cat}>
                  <td className="font-medium">{catLabel(cat)}<span className="block text-[12px] text-muted-foreground">{cat}</span></td>
                  <td className="text-right tabular-nums">{num(c.byCategory[cat] ?? 0)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <CardTitle hint="Among accounts currently opted in: the consent policy version they agreed to. A new policy version needs a fresh decision; nobody is carried over.">Consent by policy version</CardTitle>
          {c.granted === 0 ? <Empty title="Nobody has opted in yet" /> : (
            <Table label="Consent by policy version" head={["Policy version", "Accounts", ""]} lead={1} align={[undefined, "right"]} minWidth={320}>
              {sorted(c.byPolicyVersion).map(([v, n]) => (
                <tr key={v}>
                  <td className="font-medium">{v}</td>
                  <td className="text-right tabular-nums">{num(n)}</td>
                  <td>{v === c.policyVersion ? <Pill tone="ok">current</Pill> : <Pill tone="warn">older</Pill>}</td>
                </tr>
              ))}
            </Table>
          )}
          {c.staleMirrors > 0 && <p className="mt-3 text-[12.5px] text-warning-foreground">{num(c.staleMirrors)} consent mirror{c.staleMirrors === 1 ? "" : "s"} out of step with the record; the next shared rebuild rewrites them.</p>}
        </Card>
      </div>

      {/* 3. Shared model training */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi i={0} label="Contributions" value={num(b.lineage.active)} sub={`${num(b.lineage.recordsActive)} posts referenced · ${num(b.lineage.inactive)} inactive · ${num(b.lineage.deleted)} deleted`} hint="Contributors in the latest served build (pseudonymous lineage rows), and how many of their measured posts the document rests on." />
        <AdminKpi i={1} label="Rejected in last build" value={b.latest ? num(b.latest.rejected.unmeasured + b.latest.rejected.noMetric + b.latest.rejected.thinBuckets) : "—"} sub={b.latest ? `${num(b.latest.rejected.unmeasured)} unmeasured · ${num(b.latest.rejected.noMetric)} no metric · ${num(b.latest.rejected.thinBuckets)} thin bucket${b.latest.rejected.thinBuckets === 1 ? "" : "s"}` : "No build yet"} hint="Rows read from consented creators that did not make it into the document, and why." />
        <AdminKpi i={2} label="Excluded (no consent)" value={num(m.shared.eligible.excludedWithData)} sub={`${num(m.shared.eligible.withMeasuredPosts)} creators have measured posts · ${num(m.shared.eligible.consented)} consented`} hint="Creators whose measured posts exist but who have not opted in: their rows never enter the shared document." />
        <AdminKpi i={3} label="Dataset versions" value={num(b.total)} sub={b.latest ? `latest ${b.latest.datasetVersion} · ${fmtDate(b.latest.builtAt)}` : "No build yet"} hint={`One version per rebuild (hourly, on a deletion request, or by hand). Records kept ${b.retentionDays} days.`} />
      </div>

      <Card className="mb-4">
        <CardTitle hint="The production shared document, the last training run, its evaluation against the build before, and what the builds cost. Builds run inside the minute sweep on the web host, so cost is measured as compute time; there is no separate training bill to show.">Training pipeline</CardTitle>
        <dl className="grid gap-3 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
          <div><dt className="text-muted-foreground">Production model</dt><dd className="font-medium">{m.shared.production ? <>{m.shared.production.key} <Pill tone={m.shared.production.status === "active" ? "ok" : "warn"}>{m.shared.production.status}</Pill></> : "Not built yet"}</dd>{m.shared.production && <dd className="text-[12px] text-muted-foreground">features v{m.shared.production.featureVersion} · updated {fmtDate(m.shared.production.updatedAt)}</dd>}</div>
          <div><dt className="text-muted-foreground">Last training run</dt><dd className="font-medium">{b.latest ? <time dateTime={b.latest.builtAt}>{fmtDate(b.latest.builtAt)}</time> : "—"}</dd>{b.latest && <dd className="text-[12px] text-muted-foreground">{b.latest.trigger} · {num(b.latest.contributors)} contributors · {num(b.latest.rowsKept)} of {num(b.latest.rowsRead)} rows kept · {num(b.latest.buckets)} buckets · {ms(b.latest.durationMs)}</dd>}</div>
          <div><dt className="text-muted-foreground">Evaluation</dt><dd className="font-medium">{b.latest ? <><Pill tone={b.latest.validation === "passed" ? "ok" : "bad"}>{b.latest.validation}</Pill> {b.latest.served ? "served" : "not served"}</> : "—"}</dd><dd className="text-[12px] text-muted-foreground">{b.latest ? (b.latest.anomaly ?? "In line with the build before.") : "No build to evaluate."} {num(b.flagged30d)} flagged, {num(b.failed30d)} failed in 30 days.</dd></div>
          <div><dt className="text-muted-foreground">Training cost, 30 days</dt><dd className="font-medium">{m.shared.compute30d.builds ? ms(m.shared.compute30d.totalMs) : "—"}</dd><dd className="text-[12px] text-muted-foreground">{m.shared.compute30d.builds ? `${num(m.shared.compute30d.builds)} builds · ${ms(m.shared.compute30d.meanMs ?? 0)} each on average · compute time inside the sweep, no separate bill` : "No build in 30 days."}</dd></div>
        </dl>
      </Card>

      {/* 4. Personal Intelligence */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi i={0} label="Active personal profiles" value={num(p.profiles.owners)} sub={`${num(p.retainedWithoutAccess)} kept after a downgrade · ${num(p.entitledWithoutProfile)} entitled, not built yet`} hint="Creators with a workspace profile on record. A downgraded creator's profile stays as data and is never rebuilt; an entitled creator without one is the cold start (or has no published post in the 90-day window)." />
        <AdminKpi i={1} label="Profile freshness" value={fresh.total ? pct(fresh.fresh, fresh.total) : "—"} sub={fresh.total ? `${num(fresh.fresh)} fresh · ${num(fresh.stale)} older than ${fresh.staleHours} h · oldest ${fresh.oldestAgeHours ?? 0} h` : "No profile yet"} hint="Share of workspace profiles rebuilt within the sweep's staleness rule. Downgraded creators' profiles age on purpose." />
        <AdminKpi i={2} label="Learning jobs, 30 days" value={personalJob?.successRate === null || personalJob?.successRate === undefined ? "—" : `${personalJob.successRate}%`} sub={personalJob?.runs ? `${num(personalJob.runs)} runs · ${num(personalJob.failed)} failed · ${num(j.personal.failedOwners)} owner failures inside runs` : "No run logged yet"} hint="The personal sweep step (every 10 minutes): a run fails when the step throws; an owner failure inside a run is counted separately and never stops the others." />
        <AdminKpi i={3} label="Forecast latency" value={j.predict ? ms(j.predict.p50) : "Not measured yet"} sub={j.predict ? `p95 ${ms(j.predict.p95)} · ${num(j.predict.n)} on-demand forecasts in ${j.latencyWindowDays} days · ${num(j.predict.failed)} failed` : `No on-demand forecast in ${j.latencyWindowDays} days`} hint="Measured on POST /api/intelligence/predictions: time from the request reaching the scorer to its answer. Backfilled forecasts inside the sweep are not counted here." />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="How much the engine knows each creator: personal (own history carries), blended (own plus cohort), general (cohort only), none (nothing measured). Workspace profiles only.">Data sufficiency</CardTitle>
          {p.profiles.rows === 0 ? <Empty title="No profile yet" body="The first personal sweep after an entitled creator has a measured post writes the first profile." /> : (
            <Table label="Data sufficiency" head={["Level", "Profiles", "Share"]} lead={1} align={[undefined, "right", "right"]} minWidth={320}>
              {(["personal", "blended", "general", "none"] as const).map((lvl) => (
                <tr key={lvl}>
                  <td className="font-medium capitalize">{lvl}</td>
                  <td className="text-right tabular-nums">{num(p.profiles.byLevel[lvl] ?? 0)}</td>
                  <td className="text-right tabular-nums">{pct(p.profiles.byLevel[lvl] ?? 0, p.profiles.rows)}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-[12.5px] text-muted-foreground">{num(p.predictions.total)} forecasts on record, {num(p.predictions.evaluated)} judged against the real number, {num(p.predictions.stored7d)} written in 7 days.</p>
        </Card>
        <Card>
          <CardTitle hint={`Every Intelligence job run of the last ${j.windowDays} days (IntelligenceJobRun, kept ${j.retentionDays} days). Durations are the measured wall time of the run.`}>Job log</CardTitle>
          <Table label="Job log" head={["Job", "Runs", "Failed", "Success", "p50", "p95", "Last run"]} lead={1} align={[undefined, "right", "right", "right", "right", "right"]} minWidth={640}>
            {j.jobs.map((x) => (
              <tr key={x.job}>
                <td className="font-medium">{x.label}</td>
                <td className="text-right tabular-nums">{num(x.runs)}</td>
                <td className="text-right tabular-nums">{num(x.failed)}</td>
                <td className="text-right tabular-nums">{x.successRate === null ? "—" : `${x.successRate}%`}</td>
                <td className="text-right tabular-nums">{x.durationMs ? ms(x.durationMs.p50) : "—"}</td>
                <td className="text-right tabular-nums">{x.durationMs ? ms(x.durationMs.p95) : "—"}</td>
                <td className="whitespace-nowrap text-[12.5px] text-muted-foreground">{x.lastAt ? <><time dateTime={x.lastAt}>{fmtDate(x.lastAt)}</time> {x.lastOk === false && <Pill tone="bad">failed</Pill>}</> : "never"}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            Personal sweep: {num(j.personal.withWork)} of {num(j.personal.runs)} runs had work · {num(j.personal.owners)} owner refreshes · {num(j.personal.features)} feature rows written · {num(j.personal.skipped)} owners skipped for no plan and no consent.{sharedJob?.lastError ? ` Shared rebuild last error: ${sharedJob.lastError}` : ""}{personalJob?.lastError ? ` Personal sweep last error: ${personalJob.lastError}` : ""}
          </p>
        </Card>
      </div>

      {/* 5. Privacy & security */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi i={0} label="Consent audit trail" value={num(m.privacy.decisions.total)} sub={`${num(m.privacy.decisions.last30d.granted + m.privacy.decisions.last30d.withdrawn)} decisions in 30 days · last ${m.privacy.decisions.lastAt ? fmtDate(m.privacy.decisions.lastAt) : "—"}`} hint="Every consent decision ever recorded (append-only; a row is never edited). Each carries its timestamp, policy version, categories and source." />
        <AdminKpi i={1} label="Deletion requests" value={`${num(m.privacy.deletions.open)} open`} sub={`${num(m.privacy.deletions.done)} completed${m.privacy.deletions.oldestOpenAt ? ` · oldest open ${fmtDate(m.privacy.deletions.oldestOpenAt)}` : ""}`} hint="A request is completed when the shared document has been rebuilt without the account's rows and its lineage references cleared, usually within the next sweep tick." />
        <AdminKpi i={2} label="Unauthorized attempts" value={num(m.denials.total)} sub={m.denials.total ? `${num(m.denials.owners)} accounts in 30 days · ${num(m.denials.last7d)} in 7 days` : "None in 30 days"} hint="Requests for a paid Intelligence capability that the server refused (402). Counted once per account, capability and UTC day." />
        <AdminKpi i={3} label="Data isolation" value={m.privacy.isolation.verdict} sub={`${m.privacy.isolation.checks.filter((x) => x.ok === true).length} of ${m.privacy.isolation.checks.length} checks passed`} hint="Checks this page can run against the live data right now; see the list below. 'attention' means a check failed." />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="What the engine keeps and for how long, against the oldest row actually on record. Personal data (profiles, forecasts, learning log) belongs to the account and goes with it; the shared lineage is cleared on a deletion request.">Retention</CardTitle>
          <Table label="Retention" head={["Data", "Keep", "Oldest row", "Status"]} lead={1} minWidth={480}>
            {m.privacy.retention.map((r) => (
              <tr key={r.key}>
                <td className="font-medium">{r.label}</td>
                <td className="tabular-nums">{r.days} days</td>
                <td className="whitespace-nowrap text-[12.5px] text-muted-foreground">{r.oldestAt ? <>{fmtDate(r.oldestAt)} ({r.oldestAgeDays} d)</> : "—"}</td>
                <td><Pill tone={r.status === "ok" ? "ok" : r.status === "overdue" ? "bad" : "muted"}>{r.status}</Pill></td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardTitle hint="Isolation checks run against the live rows when this page loads. A failed check is a bug to chase, not a number to watch.">Data isolation <Pill tone={verdictTone}>{m.privacy.isolation.verdict}</Pill></CardTitle>
          <ul className="space-y-2 text-[13px]">
            {m.privacy.isolation.checks.map((x) => (
              <li key={x.key} className="flex items-start gap-2">
                <Pill tone={x.ok === true ? "ok" : x.ok === false ? "bad" : "muted"}>{x.ok === true ? "pass" : x.ok === false ? "fail" : "n/a"}</Pill>
                <span><span className="font-medium">{x.label}.</span> <span className="text-muted-foreground">{x.detail}</span></span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

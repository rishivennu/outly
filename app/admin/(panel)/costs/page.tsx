import { requireAdmin } from "@/lib/admin/guard";
import { aiBreakdown, overview, topUsers, type AiBreakdown, type UsersBreakdown } from "@/lib/costs/overview";
import { COST_SOURCES, SOURCE_BLURB, SOURCE_LABEL, fmtInr, pctOf, providerLabel, type CostSource } from "@/lib/costs/core";
import { Card, CardTitle, Empty, PageHead, Pill, Table, fmtDate } from "@/components/admin/ui";
import { AdminKpi } from "@/components/admin/motion/AdminKpi";
import { DateFilter, FilterChips } from "@/components/admin/SearchBox";
import { AlertsCard, BillsCard, BudgetsCard, ConnectionsCard, ImportBillsCard, PricesCard, RecurringCard, SweepNowButton } from "@/components/admin/costs/CostsPanel";

export const metadata = { title: "Infrastructure & Costs" };
export const dynamic = "force-dynamic";

type Params = { from?: string; to?: string; view?: string };
const VIEWS = [{ value: "", label: "Overview" }, { value: "ai", label: "AI usage" }, { value: "users", label: "People" }];
const SOURCE_TONE: Record<CostSource, "ok" | "info" | "warn" | "muted"> = { billed: "ok", reported: "info", estimate: "warn", manual: "muted", forecast: "muted" };

/**
 * R1314 Phase 1: one page for what Outlly pays. Every rupee here is a ledger row with its source labelled; nothing
 * is invented for days before tracking started, and the forecast says it is an estimate.
 * R1315 Phase 2: ?view=ai (tokens by model and feature) and ?view=users (who costs what) share the date range.
 */
export default async function Costs(props: { searchParams: Promise<Params> }) {
  const sp = await props.searchParams;
  await requireAdmin("costs");
  const view = sp.view === "ai" || sp.view === "users" ? sp.view : "";
  const o = await overview({ from: sp.from, to: sp.to });
  const [ai, people] = await Promise.all([view === "ai" ? aiBreakdown({ from: o.range.from, to: o.range.to }) : null, view === "users" ? topUsers({ from: o.range.from, to: o.range.to, limit: 50 }) : null]);
  const change = o.previousMinor != null && o.previousMinor > 0 ? Math.round(((o.totalMinor - o.previousMinor) / o.previousMinor) * 100) : null;
  const open = o.alerts.filter((a) => a.status === "open");
  const spark = o.series.map((p) => p.inrMinor / 100);
  const exportQs = `from=${o.range.from}&to=${o.range.to}`;
  const sourceTotal = Object.values(o.bySource).reduce((s, v) => s + v, 0);

  return (
    <>
      <PageHead eyebrow="Run" title="Infrastructure & Costs" body="What Outlly pays its providers, by provider, category and feature, with bills, budgets and alerts."
        actions={<div className="flex flex-wrap gap-2"><a className="inline-flex h-9 items-center rounded-full px-3.5 text-[13px] hairline hover:bg-secondary" href={`/api/admin/costs/export?kind=daily&${exportQs}`}>Export daily CSV</a><a className="inline-flex h-9 items-center rounded-full px-3.5 text-[13px] hairline hover:bg-secondary" href={`/api/admin/costs/export?kind=events&${exportQs}`}>Export ledger CSV</a><SweepNowButton /></div>} />

      <Card className="mb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div role="group" aria-label="Date range" className="grid grid-cols-2 gap-2.5 sm:flex sm:items-end">
            <DateFilter param="from" label="From" current={o.range.from} max={o.range.to} />
            <DateFilter param="to" label="To" current={o.range.to} />
          </div>
          <p className="text-[12.5px] text-muted-foreground">{o.trackingSince ? <>Tracking since <time dateTime={o.trackingSince}>{fmtDate(o.trackingSince)}</time>. Earlier months were not recorded and are not shown.</> : "Nothing recorded yet. The ledger starts with the first metered AI call, bill or renewal."}</p>
        </div>
        <div className="mt-3"><FilterChips param="view" options={VIEWS} current={view} label="View" /></div>
      </Card>

      {ai && <AiView ai={ai} />}
      {people && <PeopleView p={people} />}
      {view === "" && (<>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi i={0} label="Spend in range" value={fmtInr(o.totalMinor)} change={change} invert compare="the previous period of the same length" compareNote={o.previousMinor == null ? "No earlier period on record yet." : undefined} spark={spark} hint="Ledger rows in the range, in INR at the FX recorded when each was written." />
        <AdminKpi i={1} label="This month so far" value={fmtInr(o.month.variableMtdMinor + o.month.recurringBookedMinor)} sub={`${o.month.dayOfMonth} of ${o.month.daysInMonth} days`} hint="Variable usage plus renewals already booked this calendar month (UTC)." />
        <AdminKpi i={2} label="Month-end forecast" value={fmtInr(o.month.forecast.projectedTotalMinor)} sub={`Estimate, ${o.month.forecast.confidence} confidence`} hint="Variable spend so far at its average daily rate for the whole month, plus recurring commitments not yet booked. A projection, not a bill." />
        <AdminKpi i={3} label="Recurring commitments" value={`${fmtInr(o.month.recurringMonthlyMinor)}/mo`} sub={`${o.recurring.filter((r) => r.active).length} active · ${open.length} open alert${open.length === 1 ? "" : "s"}`} hint="Active subscriptions normalised to a month at today's FX." />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Breakdown title="By provider" rows={o.byProvider} unitLabel="events" />
        <Breakdown title="By category" rows={o.byCategory} unitLabel="events" />
        <Breakdown title="By feature" rows={o.byFeature} unitLabel="events" hint="Attribution from the usage record that caused the cost (which feature, which person). Platform-level bills are 'Platform'." />
      </div>

      <Card className="mb-4">
        <CardTitle hint="Where each number came from. Billed is a real invoice; estimates are Outlly's own calculation from usage and the unit price on file.">How sure are these numbers?</CardTitle>
        {sourceTotal === 0 ? <Empty title="No rows in this range" /> : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {COST_SOURCES.filter((s) => s !== "forecast").map((s) => (
              <li key={s} className="rounded-2xl bg-secondary/40 p-3">
                <div className="flex items-center justify-between gap-2"><Pill tone={SOURCE_TONE[s]}>{SOURCE_LABEL[s]}</Pill><span className="text-[13px] tabular-nums">{pctOf(o.bySource[s], sourceTotal)}%</span></div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{fmtInr(o.bySource[s])}</div>
                <p className="text-[12px] text-muted-foreground">{SOURCE_BLURB[s]}</p>
              </li>
            ))}
          </ul>
        )}
        {o.supersededMinor > 0 && <p className="mt-3 text-[12.5px] text-muted-foreground">{fmtInr(o.supersededMinor)} of estimates in this range is set aside from the totals because the provider's invoice for that month is on file. The invoice counts; the estimates stay in the ledger for comparison.</p>}
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <AlertsCard items={o.alerts} />
        <BudgetsCard items={o.budgets} />
      </div>
      <div className="mb-4 grid gap-4">
        <ConnectionsCard items={o.connections} />
        <RecurringCard items={o.recurring} />
        <BillsCard items={o.bills} />
        <ImportBillsCard />
        <PricesCard items={o.prices} />
      </div>
      </>)}
    </>
  );
}

const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : Math.round(n).toLocaleString("en-IN"));

/** R1315: tokens in and out per model and per feature, with the rupee cost of a thousand requests. */
function AiView({ ai }: { ai: AiBreakdown }) {
  const spark = ai.byDay.map((d) => d.inrMinor / 100);
  const unpriced = ai.byModel.filter((m) => m.unpriced);
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi i={0} label="AI spend in range" value={fmtInr(ai.totalMinor)} spark={spark} hint="Token rows booked at the unit price on file when each call finished (source: reported by the model API)." />
        <AdminKpi i={1} label="Model calls" value={ai.calls.toLocaleString("en-IN")} sub={ai.calls ? `${fmtInr(Math.round((ai.totalMinor / ai.calls) * 1000))} per 1k calls` : undefined} hint="One call is one request to a model, including hedged and cancelled ones; their prompt tokens were still billed." />
        <AdminKpi i={2} label="Tokens in" value={fmtTokens(ai.tokensIn)} hint="Prompt tokens, as reported by the provider." />
        <AdminKpi i={3} label="Tokens out" value={fmtTokens(ai.tokensOut)} hint="Answer tokens plus thinking tokens, which Gemini bills at the output rate." />
      </div>
      {unpriced.length > 0 && <Card className="mb-4" tone="flat"><p className="text-[13px]"><span className="font-medium">{unpriced.length} model{unpriced.length === 1 ? "" : "s"} without a unit price:</span> {unpriced.map((m) => `${providerLabel(m.provider)} ${m.model}`).join(", ")}. Tokens are counted, cost shows as ₹0. Add <code>{unpriced[0].model}:input</code> and <code>{unpriced[0].model}:output</code> under Unit prices on the Overview.</p></Card>}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="Grouped by model id. A hedged call that was cancelled still shows here because its prompt was sent and billed.">By model</CardTitle>
          {ai.byModel.length === 0 ? <Empty title="No metered AI calls in this range" body="Every Gemini, NVIDIA and Kimi call books its tokens as it finishes; the first one starts this table." /> : (
            <Table label="AI by model" head={["Model", "Calls", "In", "Out", "INR", "Per 1k calls"]} lead={1} align={[undefined, "right", "right", "right", "right", "right"]} minWidth={640}>
              {ai.byModel.map((m) => (
                <tr key={m.key}>
                  <td><div className="font-medium">{m.model}</div><div className="text-[12px] text-muted-foreground">{providerLabel(m.provider)}{m.unpriced && <> · <Pill tone="warn">no price</Pill></>}</div></td>
                  <td className="text-right tabular-nums">{m.calls.toLocaleString("en-IN")}</td>
                  <td className="text-right tabular-nums">{fmtTokens(m.tokensIn)}</td>
                  <td className="text-right tabular-nums">{fmtTokens(m.tokensOut)}</td>
                  <td className="text-right tabular-nums">{fmtInr(m.inrMinor)}</td>
                  <td className="text-right tabular-nums">{fmtInr(m.perThousandCallsMinor)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <CardTitle hint="The Outlly feature that made the call. 'AI (unattributed)' is a call path that has not been tagged yet.">By feature</CardTitle>
          {ai.byFeature.length === 0 ? <Empty title="Nothing in this range" /> : (
            <Table label="AI by feature" head={["Feature", "Calls", "Tokens", "INR", "Share"]} lead={1} align={[undefined, "right", "right", "right", "right"]} minWidth={520}>
              {ai.byFeature.map((f) => (
                <tr key={f.key || "ai"}>
                  <td><div className="font-medium">{f.label}</div><div className="text-[12px] text-muted-foreground">{fmtInr(f.perThousandCallsMinor)} per 1k calls</div></td>
                  <td className="text-right tabular-nums">{f.calls.toLocaleString("en-IN")}</td>
                  <td className="text-right tabular-nums">{fmtTokens(f.tokensIn)} in · {fmtTokens(f.tokensOut)} out</td>
                  <td className="text-right tabular-nums">{fmtInr(f.inrMinor)}</td>
                  <td className="text-right tabular-nums">{f.pct}%</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

/** R1315: who costs what. Attributed rows per person with their plan and a per-feature split; platform rows shown once so the halves add up. */
function PeopleView({ p }: { p: UsersBreakdown }) {
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi i={0} label="Attributed to people" value={fmtInr(p.attributedMinor)} hint="Ledger rows that carry a user id: AI calls, captions, posts and other usage someone caused." />
        <AdminKpi i={1} label="Platform-level" value={fmtInr(p.platformMinor)} hint="Rows with no person: hosting, database, domains, invoices, renewals." />
        <AdminKpi i={2} label="People with usage" value={p.distinctUsers.toLocaleString("en-IN")} sub={p.distinctUsers ? `${fmtInr(Math.round(p.attributedMinor / p.distinctUsers))} each on average` : undefined} />
        <AdminKpi i={3} label="Top person's share" value={p.users[0] ? `${p.users[0].pct}%` : "0%"} sub={p.users[0] ? (p.users[0].name || p.users[0].email || "Deleted account") : undefined} />
      </div>
      <Card className="mb-4">
        <CardTitle hint="Sorted by cost in the range. Plan is what the account holds today, not at the time of use. 'free' means no active paid subscription.">People by cost</CardTitle>
        {p.users.length === 0 ? <Empty title="No attributed usage in this range" body="Metered calls carry the signed-in person; the first one starts this table." /> : (
          <Table label="People by cost" head={["Person", "Plan", "Events", "INR", "Share", "Where it went"]} lead={1} align={[undefined, undefined, "right", "right", "right", undefined]} minWidth={820}>
            {p.users.map((u) => (
              <tr key={u.userId}>
                <td><div className="font-medium">{u.name || u.email || "Deleted account"}</div>{u.email && <div className="text-[12px] text-muted-foreground">{u.email}</div>}</td>
                <td><Pill tone={u.tier && u.tier !== "free" ? "ok" : "muted"}>{u.tier || "unknown"}</Pill></td>
                <td className="text-right tabular-nums">{u.count.toLocaleString("en-IN")}</td>
                <td className="text-right tabular-nums">{fmtInr(u.inrMinor)}</td>
                <td className="text-right tabular-nums">{u.pct}%</td>
                <td className="text-[12.5px] text-muted-foreground">{u.features.slice(0, 4).map((f) => `${f.label} ${fmtInr(f.inrMinor)}`).join(" · ")}{u.features.length > 4 ? ` · +${u.features.length - 4} more` : ""}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function Breakdown({ title, rows, unitLabel, hint }: { title: string; rows: { key: string; label: string; inrMinor: number; count: number; pct: number }[]; unitLabel: string; hint?: string }) {
  return (
    <Card>
      <CardTitle hint={hint}>{title}</CardTitle>
      {rows.length === 0 ? <Empty title="Nothing in this range" /> : (
        <Table label={title} head={["Name", "INR", "Share"]} align={[undefined, "right", "right"]} minWidth={240}>
          {rows.slice(0, 12).map((r) => (
            <tr key={r.key || "platform"}>
              <td><div className="font-medium">{r.label}</div><div className="text-[12px] text-muted-foreground">{r.count.toLocaleString("en-IN")} {unitLabel}</div></td>
              <td className="text-right tabular-nums">{fmtInr(r.inrMinor)}</td>
              <td className="text-right tabular-nums">{r.pct}%</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

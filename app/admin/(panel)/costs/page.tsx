import { requireAdmin } from "@/lib/admin/guard";
import { overview } from "@/lib/costs/overview";
import { COST_SOURCES, SOURCE_BLURB, SOURCE_LABEL, fmtInr, pctOf, type CostSource } from "@/lib/costs/core";
import { Card, CardTitle, Empty, PageHead, Pill, Table, fmtDate } from "@/components/admin/ui";
import { AdminKpi } from "@/components/admin/motion/AdminKpi";
import { DateFilter } from "@/components/admin/SearchBox";
import { AlertsCard, BillsCard, BudgetsCard, PricesCard, RecurringCard, SweepNowButton } from "@/components/admin/costs/CostsPanel";

export const metadata = { title: "Infrastructure & Costs" };
export const dynamic = "force-dynamic";

type Params = { from?: string; to?: string };
const SOURCE_TONE: Record<CostSource, "ok" | "info" | "warn" | "muted"> = { billed: "ok", reported: "info", estimate: "warn", manual: "muted", forecast: "muted" };

/**
 * R1314 Phase 1: one page for what Outlly pays. Every rupee here is a ledger row with its source labelled; nothing
 * is invented for days before tracking started, and the forecast says it is an estimate.
 */
export default async function Costs(props: { searchParams: Promise<Params> }) {
  const sp = await props.searchParams;
  await requireAdmin("costs");
  const o = await overview({ from: sp.from, to: sp.to });
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
      </Card>

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
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <AlertsCard items={o.alerts} />
        <BudgetsCard items={o.budgets} />
      </div>
      <div className="mb-4 grid gap-4">
        <RecurringCard items={o.recurring} />
        <BillsCard items={o.bills} />
        <PricesCard items={o.prices} />
      </div>
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

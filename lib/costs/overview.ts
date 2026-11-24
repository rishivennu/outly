import "server-only";
import { db } from "../db";
import { CATEGORY_LABEL, COST_SOURCES, crossedThresholds, dayKey, daysInMonth, featureLabel, forecastMonth, monthKey, monthStartUtc, monthlyShare, nextMonthUtc, parseThresholds, pctOf, providerLabel, type CostCategoryId, type CostSource } from "./core";
import { trackingSince } from "./ledger";

/** R1314 read side: everything the dashboard shows, from the daily rollup plus the manual tables. */
export interface Slice { key: string; label: string; inrMinor: number; units: number; count: number; pct: number }
export interface DayPoint { day: string; inrMinor: number }
export interface Overview {
  range: { from: string; to: string };
  trackingSince: string | null;
  totalMinor: number;
  previousMinor: number | null;
  bySource: Record<CostSource, number>;
  byProvider: Slice[];
  byCategory: Slice[];
  byFeature: Slice[];
  series: DayPoint[];
  month: { key: string; variableMtdMinor: number; recurringMonthlyMinor: number; recurringBookedMinor: number; forecast: ReturnType<typeof forecastMonth>; dayOfMonth: number; daysInMonth: number };
  recurring: RecurringView[];
  bills: BillView[];
  budgets: BudgetView[];
  alerts: AlertView[];
  prices: PriceView[];
}
export interface RecurringView { id: string; name: string; provider: string; category: string; amountMinor: number; currency: string; cadence: string; startsAt: string; endsAt: string | null; nextRenewal: string; autoRenew: boolean; active: boolean; note: string; monthlyInrMinor: number }
export interface BillView { id: string; provider: string; invoiceId: string; category: string; periodStart: string; periodEnd: string; amountMinor: number; currency: string; fxToInr: number; inrMinor: number; status: string; source: string; note: string; createdAt: string }
export interface BudgetView { id: string; name: string; scope: string; key: string; inrMinor: number; thresholds: string; active: boolean; spentMinor: number; pct: number; crossed: number[] }
export interface AlertView { id: string; key: string; kind: string; severity: string; title: string; body: string; href: string; status: string; createdAt: string; ackedAt: string | null; ackedBy: string | null }
export interface PriceView { id: string; provider: string; sku: string; unit: string; price: number; currency: string; effectiveFrom: string; effectiveTo: string | null; source: string; sourceUrl: string; note: string; current: boolean }

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const addDays = (day: string, n: number) => dayKey(new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400_000));

function slices(rows: { key: string; inrMinor: number; units: number; count: number }[], label: (k: string) => string, total: number): Slice[] {
  const m = new Map<string, Slice>();
  for (const r of rows) {
    const s = m.get(r.key) ?? { key: r.key, label: label(r.key), inrMinor: 0, units: 0, count: 0, pct: 0 };
    s.inrMinor += r.inrMinor;
    s.units += r.units;
    s.count += r.count;
    m.set(r.key, s);
  }
  return [...m.values()].map((s) => ({ ...s, pct: pctOf(s.inrMinor, total) })).sort((a, b) => b.inrMinor - a.inrMinor);
}

export async function spentInScope(scope: string, key: string, from: string, to: string) {
  const where = { day: { gte: from, lte: to }, ...(scope === "provider" ? { provider: key } : scope === "category" ? { category: key } : scope === "feature" ? { feature: key } : {}) };
  const agg = await db.costDaily.aggregate({ where, _sum: { inrMinor: true } });
  return agg._sum.inrMinor ?? 0;
}

export async function budgetViews(now = new Date()): Promise<BudgetView[]> {
  const budgets = await db.costBudget.findMany({ orderBy: [{ active: "desc" }, { createdAt: "asc" }] });
  const from = dayKey(monthStartUtc(now)), to = dayKey(now);
  return Promise.all(budgets.map(async (b) => {
    const spent = await spentInScope(b.scope, b.key, from, to);
    const pct = pctOf(spent, b.inrMinor);
    return { id: b.id, name: b.name, scope: b.scope, key: b.key, inrMinor: b.inrMinor, thresholds: b.thresholds, active: b.active, spentMinor: spent, pct, crossed: crossedThresholds(pct, parseThresholds(b.thresholds)) };
  }));
}

export async function overview(o: { from?: string; to?: string; now?: Date } = {}): Promise<Overview> {
  const now = o.now ?? new Date();
  const to = o.to && /^\d{4}-\d{2}-\d{2}$/.test(o.to) ? o.to : dayKey(now);
  const from = o.from && /^\d{4}-\d{2}-\d{2}$/.test(o.from) && o.from <= to ? o.from : addDays(to, -29);
  const span = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400_000) + 1;
  const prevFrom = addDays(from, -span), prevTo = addDays(from, -1);
  const mFrom = dayKey(monthStartUtc(now)), mTo = dayKey(now);

  const [rows, prev, monthRows, since, recurringRows, billRows, budgets, alertRows, priceRows] = await Promise.all([
    db.costDaily.findMany({ where: { day: { gte: from, lte: to } } }),
    db.costDaily.aggregate({ where: { day: { gte: prevFrom, lte: prevTo } }, _sum: { inrMinor: true }, _count: true }),
    db.costDaily.findMany({ where: { day: { gte: mFrom, lte: mTo } }, select: { inrMinor: true, source: true, category: true } }),
    trackingSince(),
    db.recurringExpense.findMany({ orderBy: [{ active: "desc" }, { nextRenewal: "asc" }] }),
    db.billingRecord.findMany({ orderBy: { periodStart: "desc" }, take: 100 }),
    budgetViews(now),
    db.costAlert.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 50 }),
    import("./prices").then((m) => m.listPrices()),
  ]);

  const total = rows.reduce((s, r) => s + r.inrMinor, 0);
  const bySource = Object.fromEntries(COST_SOURCES.map((s) => [s, 0])) as Record<CostSource, number>;
  for (const r of rows) bySource[(r.source as CostSource) in bySource ? (r.source as CostSource) : "estimate"] += r.inrMinor;
  const seriesMap = new Map<string, number>();
  for (let d = from; d <= to; d = addDays(d, 1)) seriesMap.set(d, 0);
  for (const r of rows) seriesMap.set(r.day, (seriesMap.get(r.day) ?? 0) + r.inrMinor);

  const recurring: RecurringView[] = recurringRows.map((r) => ({ id: r.id, name: r.name, provider: r.provider, category: r.category, amountMinor: r.amountMinor, currency: r.currency, cadence: r.cadence, startsAt: r.startsAt.toISOString(), endsAt: iso(r.endsAt), nextRenewal: r.nextRenewal.toISOString(), autoRenew: r.autoRenew, active: r.active, note: r.note, monthlyInrMinor: 0 }));
  // Monthly commitments at today's FX (a view, not a booking; the ledger rows keep their own FX).
  const econ = await import("../subscriptions/policy").then((m) => m.getEconomics());
  for (const r of recurring) r.monthlyInrMinor = Math.round(monthlyShare(r.amountMinor, r.cadence) * (r.currency === "INR" ? 1 : econ.fx[r.currency] ?? 0));
  const recurringMonthlyMinor = recurring.filter((r) => r.active).reduce((s, r) => s + r.monthlyInrMinor, 0);
  const recurringBookedMinor = monthRows.filter((r) => r.source === "manual").reduce((s, r) => s + r.inrMinor, 0);
  const variableMtdMinor = monthRows.filter((r) => r.source !== "manual" && r.source !== "billed").reduce((s, r) => s + r.inrMinor, 0);
  const dom = now.getUTCDate(), dim = daysInMonth(now);
  const forecast = forecastMonth({ variableMtdMinor, recurringRemainingMinor: Math.max(0, recurringMonthlyMinor - recurringBookedMinor), dayOfMonth: dom, daysInMonth: dim });

  const seen = new Set<string>();
  const prices: PriceView[] = priceRows.map((p) => {
    const k = `${p.provider}/${p.sku}`;
    const current = !seen.has(k) && p.effectiveFrom <= now && (!p.effectiveTo || p.effectiveTo > now);
    if (current) seen.add(k);
    return { id: p.id, provider: p.provider, sku: p.sku, unit: p.unit, price: p.price, currency: p.currency, effectiveFrom: p.effectiveFrom.toISOString(), effectiveTo: iso(p.effectiveTo), source: p.source, sourceUrl: p.sourceUrl, note: p.note, current };
  });

  return {
    range: { from, to },
    trackingSince: since,
    totalMinor: total,
    previousMinor: since && prevTo >= since ? prev._sum.inrMinor ?? 0 : null,
    bySource,
    byProvider: slices(rows.map((r) => ({ key: r.provider, inrMinor: r.inrMinor, units: r.units, count: r.count })), providerLabel, total),
    byCategory: slices(rows.map((r) => ({ key: r.category, inrMinor: r.inrMinor, units: r.units, count: r.count })), (k) => CATEGORY_LABEL[k as CostCategoryId] ?? k, total),
    byFeature: slices(rows.map((r) => ({ key: r.feature, inrMinor: r.inrMinor, units: r.units, count: r.count })), featureLabel, total),
    series: [...seriesMap.entries()].map(([day, inrMinor]) => ({ day, inrMinor })),
    month: { key: monthKey(now), variableMtdMinor, recurringMonthlyMinor, recurringBookedMinor, forecast, dayOfMonth: dom, daysInMonth: dim },
    recurring,
    bills: billRows.map((b) => ({ id: b.id, provider: b.provider, invoiceId: b.invoiceId, category: b.category, periodStart: b.periodStart.toISOString(), periodEnd: b.periodEnd.toISOString(), amountMinor: b.amountMinor, currency: b.currency, fxToInr: b.fxToInr, inrMinor: b.inrMinor, status: b.status, source: b.source, note: b.note, createdAt: b.createdAt.toISOString() })),
    budgets,
    alerts: alertRows.map((a) => ({ id: a.id, key: a.key, kind: a.kind, severity: a.severity, title: a.title, body: a.body, href: a.href, status: a.status, createdAt: a.createdAt.toISOString(), ackedAt: iso(a.ackedAt), ackedBy: a.ackedBy })),
    prices,
  };
}

/** Rows for the CSV export: the ledger (one line per event) or the daily rollup. */
export async function exportRows(kind: "events" | "daily", from: string, to: string) {
  if (kind === "daily") {
    const rows = await db.costDaily.findMany({ where: { day: { gte: from, lte: to } }, orderBy: [{ day: "asc" }, { provider: "asc" }] });
    return { head: ["day", "provider", "category", "feature", "source", "units", "count", "inr"], rows: rows.map((r) => [r.day, r.provider, r.category, r.feature, r.source, r.units, r.count, (r.inrMinor / 100).toFixed(2)]) };
  }
  const rows = await db.costEvent.findMany({ where: { day: { gte: from, lte: to } }, orderBy: { at: "asc" }, take: 50_000 });
  return { head: ["at", "provider", "category", "feature", "userId", "model", "units", "unit", "amount", "currency", "fxToInr", "inr", "source", "ref", "note"], rows: rows.map((r) => [r.at.toISOString(), r.provider, r.category, r.feature, r.userId ?? "", r.model, r.units, r.unit, (r.amountMinor / 100).toFixed(2), r.currency, r.fxToInr, (r.inrMinor / 100).toFixed(2), r.source, r.ref ?? "", r.note]) };
}

export const monthBounds = (now: Date) => ({ from: dayKey(monthStartUtc(now)), to: dayKey(new Date(nextMonthUtc(now).getTime() - 1)) });

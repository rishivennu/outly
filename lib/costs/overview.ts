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
  /** Estimate/reported INR in the range set aside because the provider's invoice for that month is on file. */
  supersededMinor: number;
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
  /** R1316 */
  connections: import("./connections").ConnectionView[];
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

type DailyRow = { day: string; provider: string; category: string; feature: string; source: string; units: number; inrMinor: number; count: number };

/**
 * A provider's invoice for a month supersedes Outlly's own estimates (and provider-reported usage) for that provider
 * in that month: the invoice is the truth, the estimates were the forecast of it. Both stay in the ledger; the totals
 * count the billed row only. Returns the rows that count and how much estimate was set aside.
 */
export function supersedeEstimates<T extends Pick<DailyRow, "day" | "provider" | "source" | "inrMinor">>(rows: T[]) {
  const billed = new Set(rows.filter((r) => r.source === "billed").map((r) => `${r.provider}/${r.day.slice(0, 7)}`));
  let supersededMinor = 0;
  const kept = rows.filter((r) => {
    const drop = (r.source === "estimate" || r.source === "reported") && billed.has(`${r.provider}/${r.day.slice(0, 7)}`);
    if (drop) supersededMinor += r.inrMinor;
    return !drop;
  });
  return { kept, supersededMinor };
}

export async function spentInScope(scope: string, key: string, from: string, to: string) {
  // Month-wide rows for the providers involved, so an invoice booked on the last day still supersedes the whole month's estimates.
  const monthFrom = `${from.slice(0, 7)}-01`;
  const where = { day: { gte: monthFrom, lte: to }, ...(scope === "provider" ? { provider: key } : scope === "category" ? { category: key } : scope === "feature" ? { feature: key } : {}) };
  const { kept } = supersedeEstimates(await db.costDaily.findMany({ where, select: { day: true, provider: true, source: true, inrMinor: true } }));
  return kept.filter((r) => r.day >= from).reduce((s, r) => s + r.inrMinor, 0);
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

  const [allRows, prevRows, monthRowsAll, since, recurringRows, billRows, budgets, alertRows, priceRows, connections] = await Promise.all([
    db.costDaily.findMany({ where: { day: { gte: from, lte: to } } }),
    db.costDaily.findMany({ where: { day: { gte: prevFrom, lte: prevTo } }, select: { day: true, provider: true, source: true, inrMinor: true } }),
    db.costDaily.findMany({ where: { day: { gte: mFrom, lte: mTo } }, select: { day: true, provider: true, inrMinor: true, source: true, category: true } }),
    trackingSince(),
    db.recurringExpense.findMany({ orderBy: [{ active: "desc" }, { nextRenewal: "asc" }] }),
    db.billingRecord.findMany({ orderBy: { periodStart: "desc" }, take: 100 }),
    budgetViews(now),
    db.costAlert.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 50 }),
    import("./prices").then((m) => m.listPrices()),
    import("./connections").then((m) => m.listConnections()),
  ]);

  // Estimates are shown by source in full; the headline, breakdowns and series count a month's invoice instead of its estimates.
  const bySource = Object.fromEntries(COST_SOURCES.map((s) => [s, 0])) as Record<CostSource, number>;
  for (const r of allRows) bySource[(r.source as CostSource) in bySource ? (r.source as CostSource) : "estimate"] += r.inrMinor;
  const { kept: rows, supersededMinor } = supersedeEstimates(allRows);
  const total = rows.reduce((s, r) => s + r.inrMinor, 0);
  const prev = supersedeEstimates(prevRows).kept.reduce((s, r) => s + r.inrMinor, 0);
  const monthRows = supersedeEstimates(monthRowsAll).kept;
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
    previousMinor: since && prevTo >= since ? prev : null,
    bySource,
    supersededMinor,
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
    connections,
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

/* ---------------------------------------------------------------- R1315 drilldowns ---------------------------------------------------------------- */

export interface AiModelRow { key: string; provider: string; model: string; calls: number; tokensIn: number; tokensOut: number; inrMinor: number; perThousandCallsMinor: number; unpriced: boolean }
export interface AiFeatureRow { key: string; label: string; calls: number; tokensIn: number; tokensOut: number; inrMinor: number; perThousandCallsMinor: number; pct: number }
export interface AiBreakdown { range: { from: string; to: string }; totalMinor: number; calls: number; tokensIn: number; tokensOut: number; byModel: AiModelRow[]; byFeature: AiFeatureRow[]; byDay: { day: string; tokens: number; inrMinor: number }[] }

/**
 * The AI drilldown: token rows (unit token-in / token-out, R1315) grouped by model and by feature. A "call" is one
 * input row: every model request books its prompt tokens even when the answer was empty, so this counts requests,
 * not rows. Cost per 1k calls is the plain ratio and is only meaningful once a model has a price on file.
 */
export async function aiBreakdown(o: { from?: string; to?: string; now?: Date } = {}): Promise<AiBreakdown> {
  const now = o.now ?? new Date();
  const to = o.to && /^\d{4}-\d{2}-\d{2}$/.test(o.to) ? o.to : dayKey(now);
  const from = o.from && /^\d{4}-\d{2}-\d{2}$/.test(o.from) && o.from <= to ? o.from : addDays(to, -29);
  const where = { day: { gte: from, lte: to }, category: "ai", unit: { in: ["token-in", "token-out"] } };
  const [grouped, unpricedRows, dayRows] = await Promise.all([
    db.costEvent.groupBy({ by: ["provider", "model", "feature", "unit"], where, _sum: { units: true, inrMinor: true }, _count: { _all: true } }),
    db.costEvent.groupBy({ by: ["provider", "model"], where: { ...where, unitPriceId: null }, _count: { _all: true } }),
    db.costEvent.groupBy({ by: ["day"], where, _sum: { units: true, inrMinor: true } }),
  ]);
  const unpriced = new Set(unpricedRows.map((r) => `${r.provider}/${r.model}`));
  const models = new Map<string, AiModelRow>();
  const features = new Map<string, AiFeatureRow>();
  let totalMinor = 0, calls = 0, tokensIn = 0, tokensOut = 0;
  for (const g of grouped) {
    const units = g._sum.units ?? 0, inr = g._sum.inrMinor ?? 0, isIn = g.unit === "token-in";
    const mk = `${g.provider}/${g.model}`;
    const m = models.get(mk) ?? { key: mk, provider: g.provider, model: g.model, calls: 0, tokensIn: 0, tokensOut: 0, inrMinor: 0, perThousandCallsMinor: 0, unpriced: unpriced.has(mk) };
    const f = features.get(g.feature) ?? { key: g.feature, label: featureLabel(g.feature), calls: 0, tokensIn: 0, tokensOut: 0, inrMinor: 0, perThousandCallsMinor: 0, pct: 0 };
    for (const r of [m, f]) {
      r.inrMinor += inr;
      if (isIn) { r.calls += g._count._all; r.tokensIn += units; } else r.tokensOut += units;
    }
    models.set(mk, m);
    features.set(g.feature, f);
    totalMinor += inr;
    if (isIn) { calls += g._count._all; tokensIn += units; } else tokensOut += units;
  }
  const per1k = (r: { inrMinor: number; calls: number }) => (r.calls ? Math.round((r.inrMinor / r.calls) * 1000) : 0);
  const byModel = [...models.values()].map((r) => ({ ...r, perThousandCallsMinor: per1k(r) })).sort((a, b) => b.inrMinor - a.inrMinor || b.calls - a.calls);
  const byFeature = [...features.values()].map((r) => ({ ...r, perThousandCallsMinor: per1k(r), pct: pctOf(r.inrMinor, totalMinor) })).sort((a, b) => b.inrMinor - a.inrMinor || b.calls - a.calls);
  const byDay = dayRows.map((d) => ({ day: d.day, tokens: d._sum.units ?? 0, inrMinor: d._sum.inrMinor ?? 0 })).sort((a, b) => (a.day < b.day ? -1 : 1));
  return { range: { from, to }, totalMinor, calls, tokensIn, tokensOut, byModel, byFeature, byDay };
}

export interface UserCostRow { userId: string; name: string; email: string; tier: string; inrMinor: number; count: number; pct: number; features: { key: string; label: string; inrMinor: number }[] }
export interface UsersBreakdown { range: { from: string; to: string }; attributedMinor: number; platformMinor: number; users: UserCostRow[]; distinctUsers: number }

/**
 * Who costs what: ledger rows with a userId, grouped per person with a per-feature split, joined to the account
 * (name, email) and the paid tier they hold today. Platform-level rows (no user) are reported as one figure so the
 * two halves add up to the headline. Accounts that were deleted keep their rows under "Deleted account".
 */
export async function topUsers(o: { from?: string; to?: string; limit?: number; now?: Date } = {}): Promise<UsersBreakdown> {
  const now = o.now ?? new Date();
  const to = o.to && /^\d{4}-\d{2}-\d{2}$/.test(o.to) ? o.to : dayKey(now);
  const from = o.from && /^\d{4}-\d{2}-\d{2}$/.test(o.from) && o.from <= to ? o.from : addDays(to, -29);
  const limit = Math.min(200, Math.max(1, o.limit ?? 25));
  const [grouped, platform] = await Promise.all([
    db.costEvent.groupBy({ by: ["userId", "feature"], where: { day: { gte: from, lte: to }, userId: { not: null } }, _sum: { inrMinor: true }, _count: { _all: true } }),
    db.costEvent.aggregate({ where: { day: { gte: from, lte: to }, userId: null }, _sum: { inrMinor: true } }),
  ]);
  const per = new Map<string, UserCostRow>();
  let attributed = 0;
  for (const g of grouped) {
    if (!g.userId) continue;
    const inr = g._sum.inrMinor ?? 0;
    const u = per.get(g.userId) ?? { userId: g.userId, name: "", email: "", tier: "", inrMinor: 0, count: 0, pct: 0, features: [] };
    u.inrMinor += inr;
    u.count += g._count._all;
    u.features.push({ key: g.feature, label: featureLabel(g.feature), inrMinor: inr });
    per.set(g.userId, u);
    attributed += inr;
  }
  const top = [...per.values()].sort((a, b) => b.inrMinor - a.inrMinor || b.count - a.count).slice(0, limit);
  const ids = top.map((u) => u.userId);
  const [users, subs] = ids.length ? await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }),
    db.subscription.findMany({ where: { userId: { in: ids }, status: "active", currentPeriodEnd: { gt: now } }, select: { userId: true, priceTier: true, plan: { select: { slug: true } } }, orderBy: { currentPeriodEnd: "desc" } }),
  ]) : [[], []];
  const byId = new Map(users.map((u) => [u.id, u]));
  const tier = new Map<string, string>();
  for (const s of subs) if (!tier.has(s.userId)) tier.set(s.userId, `${s.plan.slug}${s.priceTier && s.priceTier !== "legacy" ? ` · ${s.priceTier}` : ""}`);
  for (const u of top) {
    const acct = byId.get(u.userId);
    u.name = acct?.name || (acct ? "" : "Deleted account");
    u.email = acct?.email ?? "";
    u.tier = tier.get(u.userId) ?? (acct ? "free" : "");
    u.pct = pctOf(u.inrMinor, attributed);
    u.features.sort((a, b) => b.inrMinor - a.inrMinor);
  }
  return { range: { from, to }, attributedMinor: attributed, platformMinor: platform._sum.inrMinor ?? 0, users: top, distinctUsers: per.size };
}

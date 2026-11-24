import "server-only";
import { z } from "zod";
import { db } from "../db";
import { HttpError } from "../http";
import { adminEvent } from "../admin/route";
import { COST_CATEGORIES, CURRENCIES, PROVIDER_IDS, dayKey, parseThresholds, toInrMinor } from "./core";
import { fxToInr, recordCostEvent } from "./ledger";
import { addPrice } from "./prices";

/** R1314 manual expense management: bills, recurring subscriptions, budgets, unit prices and alert acks. Every write is an admin action and lands in the admin event feed. */
const money = z.number().int().min(0).max(1_000_000_000);
const provider = z.enum(PROVIDER_IDS as [string, ...string[]]);
const category = z.enum(COST_CATEGORIES as unknown as [string, ...string[]]);
const currency = z.enum(CURRENCIES);
const isoDate = z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform((s) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s));

export const BillBody = z.object({
  provider, invoiceId: z.string().trim().min(1).max(80), category: category.default("hosting"), periodStart: isoDate, periodEnd: isoDate, amountMinor: money, currency: currency.default("USD"),
  status: z.enum(["paid", "due", "disputed"]).default("paid"), note: z.string().trim().max(500).default(""),
});
export const RecurringBody = z.object({
  name: z.string().trim().min(1).max(80), provider, category: category.default("tooling"), amountMinor: money, currency: currency.default("USD"), cadence: z.enum(["monthly", "yearly"]).default("monthly"),
  startsAt: isoDate, endsAt: isoDate.nullable().optional(), nextRenewal: isoDate.optional(), autoRenew: z.boolean().default(true), active: z.boolean().default(true), note: z.string().trim().max(500).default(""),
});
export const BudgetBody = z.object({
  name: z.string().trim().min(1).max(80), scope: z.enum(["total", "provider", "category", "feature"]).default("total"), key: z.string().trim().max(40).default(""), inrMinor: money.min(100),
  thresholds: z.string().trim().max(60).default("50,75,90,100").refine((s) => parseThresholds(s).length > 0, "Give at least one percent step, like 50,75,90,100"), active: z.boolean().default(true),
});
export const PriceBody = z.object({
  provider, sku: z.string().trim().min(1).max(80).regex(/^[a-z0-9.:_-]+$/i, "Letters, numbers, dots, colons and dashes only"), unit: z.string().trim().min(1).max(20), price: z.number().min(0).max(1_000_000), currency: currency.default("USD"),
  effectiveFrom: isoDate, note: z.string().trim().max(300).default(""), sourceUrl: z.string().trim().url().max(300).or(z.literal("")).default(""),
});

type Actor = { login: string };

const periodOk = (a: Date, b: Date) => { if (b <= a) throw new HttpError(400, "The period's end must be after its start.", "VALIDATION"); };

export async function createBill(input: unknown, by: Actor) {
  const b = BillBody.parse(input);
  periodOk(b.periodStart, b.periodEnd);
  if (await db.billingRecord.findUnique({ where: { provider_invoiceId: { provider: b.provider, invoiceId: b.invoiceId } } })) throw new HttpError(409, `Invoice ${b.invoiceId} from ${b.provider} is already recorded.`, "DUPLICATE");
  const fx = await fxToInr(b.currency);
  const inrMinor = toInrMinor(b.amountMinor, fx);
  const row = await db.billingRecord.create({ data: { ...b, fxToInr: fx, inrMinor, source: "manual", createdBy: by.login } });
  // The bill is also a ledger fact (source "billed") on the day the period ended, so the overview shows it.
  await recordCostEvent({ provider: b.provider, category: b.category as never, feature: "platform", amountMinor: b.amountMinor, currency: b.currency, source: "billed", ref: `bill:${row.id}`, note: `Invoice ${b.invoiceId}`, at: b.periodEnd, meta: { invoiceId: b.invoiceId, periodStart: b.periodStart.toISOString(), periodEnd: b.periodEnd.toISOString(), status: b.status } });
  await adminEvent("costs", `Bill recorded: ${b.provider} ${b.invoiceId}`, `${by.login}`, "/admin/costs");
  return row;
}

export async function updateBill(id: string, input: unknown, by: Actor) {
  const b = BillBody.partial().parse(input);
  const cur = await db.billingRecord.findUnique({ where: { id } });
  if (!cur) throw new HttpError(404, "That bill is gone.", "NOT_FOUND");
  // Only status and note can change: money, provider, period and category are what the ledger row was booked with. Delete and re-enter to correct those.
  const row = await db.billingRecord.update({ where: { id }, data: { ...(b.status ? { status: b.status } : {}), ...(b.note !== undefined ? { note: b.note } : {}) } });
  await adminEvent("costs", `Bill updated: ${cur.provider} ${cur.invoiceId}`, by.login, "/admin/costs");
  return row;
}

export async function deleteBill(id: string, by: Actor) {
  const cur = await db.billingRecord.findUnique({ where: { id } });
  if (!cur) return;
  await db.$transaction(async (tx) => {
    const ev = await tx.costEvent.findUnique({ where: { ref: `bill:${id}` } });
    if (ev) {
      await tx.costEvent.delete({ where: { id: ev.id } });
      await tx.costDaily.updateMany({ where: { day: ev.day, provider: ev.provider, category: ev.category, feature: ev.feature, source: ev.source }, data: { inrMinor: { decrement: ev.inrMinor }, units: { decrement: ev.units }, count: { decrement: 1 } } });
    }
    await tx.billingRecord.delete({ where: { id } });
  });
  await adminEvent("costs", `Bill removed: ${cur.provider} ${cur.invoiceId}`, by.login, "/admin/costs");
}

export async function createRecurring(input: unknown, by: Actor) {
  const r = RecurringBody.parse(input);
  const nextRenewal = r.nextRenewal ?? r.startsAt;
  return db.recurringExpense.create({ data: { ...r, endsAt: r.endsAt ?? null, nextRenewal, createdBy: by.login } }).then(async (row) => {
    await adminEvent("costs", `Recurring expense added: ${row.name}`, by.login, "/admin/costs");
    return row;
  });
}

export async function updateRecurring(id: string, input: unknown, by: Actor) {
  const r = RecurringBody.partial().parse(input);
  const cur = await db.recurringExpense.findUnique({ where: { id } });
  if (!cur) throw new HttpError(404, "That expense is gone.", "NOT_FOUND");
  const row = await db.recurringExpense.update({ where: { id }, data: { ...r, endsAt: r.endsAt === undefined ? undefined : r.endsAt } });
  await adminEvent("costs", `Recurring expense updated: ${row.name}`, by.login, "/admin/costs");
  return row;
}

export async function deleteRecurring(id: string, by: Actor) {
  const cur = await db.recurringExpense.findUnique({ where: { id } });
  if (!cur) return;
  await db.recurringExpense.delete({ where: { id } }); // booked renewals stay in the ledger: they were paid
  await adminEvent("costs", `Recurring expense removed: ${cur.name}`, by.login, "/admin/costs");
}

export async function createBudget(input: unknown, by: Actor) {
  const b = BudgetBody.parse(input);
  const key = b.scope === "total" ? "" : b.key;
  if (b.scope !== "total" && !key) throw new HttpError(400, "Pick which provider, category or feature this budget is for.", "VALIDATION");
  if (await db.costBudget.findUnique({ where: { scope_key: { scope: b.scope, key } } })) throw new HttpError(409, "There is already a budget for that scope. Edit it instead.", "DUPLICATE");
  const row = await db.costBudget.create({ data: { ...b, key, createdBy: by.login } });
  await adminEvent("costs", `Budget set: ${row.name}`, by.login, "/admin/costs");
  return row;
}

export async function updateBudget(id: string, input: unknown, by: Actor) {
  const b = BudgetBody.partial().parse(input);
  const cur = await db.costBudget.findUnique({ where: { id } });
  if (!cur) throw new HttpError(404, "That budget is gone.", "NOT_FOUND");
  const { scope: _s, key: _k, ...rest } = b; // scope is identity; make a new budget for a new scope
  void _s; void _k;
  const row = await db.costBudget.update({ where: { id }, data: rest });
  await adminEvent("costs", `Budget updated: ${row.name}`, by.login, "/admin/costs");
  return row;
}

export async function deleteBudget(id: string, by: Actor) {
  const cur = await db.costBudget.findUnique({ where: { id } });
  if (!cur) return;
  await db.costBudget.delete({ where: { id } });
  await adminEvent("costs", `Budget removed: ${cur.name}`, by.login, "/admin/costs");
}

export async function createPrice(input: unknown, by: Actor) {
  const p = PriceBody.parse(input);
  const row = await addPrice({ ...p, by: by.login });
  await adminEvent("costs", `Unit price set: ${p.provider} ${p.sku}`, by.login, "/admin/costs");
  return row;
}

export async function ackAlert(id: string, by: Actor) {
  const cur = await db.costAlert.findUnique({ where: { id } });
  if (!cur) throw new HttpError(404, "That alert is gone.", "NOT_FOUND");
  return db.costAlert.update({ where: { id }, data: { status: "acked", ackedAt: new Date(), ackedBy: by.login } });
}

/** Creates an alert once per key. Returns true when it was new. */
export async function raiseAlert(a: { key: string; kind: string; severity?: "info" | "warn" | "critical"; title: string; body?: string; href?: string }) {
  if (await db.costAlert.findUnique({ where: { key: a.key }, select: { id: true } })) return false; // same key: already raised
  try {
    await db.costAlert.create({ data: { key: a.key, kind: a.kind, severity: a.severity ?? "warn", title: a.title, body: a.body ?? "", href: a.href ?? "/admin/costs" } });
    await adminEvent("costs", a.title, a.body, a.href ?? "/admin/costs");
    return true;
  } catch {
    return false; // raced with another sweep
  }
}

const addCadence = (d: Date, cadence: string) => {
  const n = new Date(d);
  if (cadence === "yearly") n.setUTCFullYear(n.getUTCFullYear() + 1);
  else n.setUTCMonth(n.getUTCMonth() + 1);
  return n;
};

/**
 * Housekeeping, from the sweep: books due renewals into the ledger (idempotent on recurring:<id>:<day>), moves
 * nextRenewal forward, warns 7 days before a renewal, and raises each budget threshold once per month.
 */
export async function sweepCosts(now = new Date()) {
  let booked = 0, alerts = 0;
  const due = await db.recurringExpense.findMany({ where: { active: true, nextRenewal: { lte: now } } });
  for (const r of due) {
    let next = r.nextRenewal;
    let guard = 0;
    while (next <= now && guard++ < 60) {
      if (r.endsAt && next > r.endsAt) break;
      const ev = await recordCostEvent({ provider: r.provider, category: r.category as never, feature: "platform", units: 1, unit: r.cadence === "yearly" ? "year" : "month", amountMinor: r.amountMinor, currency: r.currency, source: "manual", ref: `recurring:${r.id}:${dayKey(next)}`, note: r.name, at: next, meta: { recurringId: r.id, cadence: r.cadence } });
      if (ev) booked++;
      next = addCadence(next, r.cadence);
    }
    const ended = !!r.endsAt && next > r.endsAt;
    await db.recurringExpense.update({ where: { id: r.id }, data: { nextRenewal: next, ...(ended || !r.autoRenew ? { active: false } : {}) } });
  }
  const soon = await db.recurringExpense.findMany({ where: { active: true, nextRenewal: { gt: now, lte: new Date(now.getTime() + 7 * 86400_000) } } });
  for (const r of soon) {
    const day = dayKey(r.nextRenewal);
    if (await raiseAlert({ key: `renewal:${r.id}:${day}`, kind: "renewal", severity: "info", title: `${r.name} renews on ${day}`, body: `${r.provider}, ${(r.amountMinor / 100).toFixed(2)} ${r.currency} ${r.cadence}.${r.autoRenew ? "" : " Auto-renew is off: pay it by hand or let it lapse."}` })) alerts++;
  }
  const { budgetViews } = await import("./overview");
  const month = now.toISOString().slice(0, 7);
  for (const b of await budgetViews(now)) {
    if (!b.active) continue;
    for (const t of b.crossed) {
      if (await raiseAlert({ key: `budget:${b.id}:${month}:${t}`, kind: "budget", severity: t >= 100 ? "critical" : t >= 90 ? "warn" : "info", title: `${b.name}: ${b.pct}% of this month's budget used`, body: `Spent ₹${(b.spentMinor / 100).toFixed(0)} of ₹${(b.inrMinor / 100).toFixed(0)} (${t}% step).` })) alerts++;
    }
  }
  return { booked, alerts, due: due.length };
}

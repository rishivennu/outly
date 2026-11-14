import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { GIFT_PROVIDERS } from "../billing/access-core";
import { getEconomics, getPolicy, type BudgetMode } from "./policy";
import { bucketOf, budgetMinor, costMinor, feeInrMinor, netRevenueInrMinor, COST_BUCKETS, type CostBucket, type CostCategory, type Economics } from "./economics";

/**
 * 1147 metering. Every costly call adds its cost (INR paise, from the economics rates) to the paying
 * subscriber's SubscriberMonth. The month's budget = net revenue x (1 - target margin) - fees, plus what any
 * packs bought this month add. Past it, only the costly features pause (AI, transcription, X posts) when the
 * policy is on and budget.mode is "enforce". Never for Free, trials, legacy or founding subscribers.
 */
export type BudgetFeature = "ai" | "transcription" | "x";
export const BLOCKING: Partial<Record<CostCategory, BudgetFeature>> = { ai: "ai", ai_reply: "ai", ai_assist: "ai", transcription: "transcription", x_post: "x" };
const BUDGETED_TIERS = ["intro", "standard"];

export const monthKey = (now = new Date()) => now.toISOString().slice(0, 7);
export const nextMonthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

const activePaidSub = (userId: string, now: Date) =>
  db.subscription.findFirst({
    where: { userId, status: "active", currentPeriodEnd: { gt: now }, priceMinor: { gt: 0 }, sample: false, provider: { notIn: [...GIFT_PROVIDERS] } },
    include: { plan: { select: { slug: true } } },
    orderBy: { currentPeriodEnd: "desc" },
  });
type PaidSub = NonNullable<Awaited<ReturnType<typeof activePaidSub>>>;

/** Who pays for this person's usage: their own paid plan, else the workspace owner they hold a seat for, else their trial. */
export async function payerFor(userId: string, now = new Date()): Promise<{ payerId: string; sub: PaidSub | null; tier: string } | null> {
  const own = await activePaidSub(userId, now);
  if (own) return { payerId: userId, sub: own, tier: own.priceTier };
  const seat = await db.teamMember.findFirst({ where: { userId, status: "active" }, select: { ownerId: true } });
  if (seat) {
    const owner = await activePaidSub(seat.ownerId, now);
    if (owner) return { payerId: seat.ownerId, sub: owner, tier: owner.priceTier };
  }
  const trial = await db.trial.findFirst({ where: { userId, status: "active", endsAt: { gt: now } }, select: { id: true } });
  return trial ? { payerId: userId, sub: null, tier: "trial" } : null;
}

/** Revenue, fees and budget for one month: the subscription's monthly share plus packs bought this month. */
async function monthFigures(payerId: string, sub: PaidSub | null, econ: Economics, target: number, now: Date) {
  let revenue = 0;
  let fee = 0;
  let budget = 0;
  if (sub) {
    const monthly = sub.interval === "year" ? Math.round(sub.priceMinor / 12) : sub.priceMinor;
    revenue += netRevenueInrMinor({ priceMinor: monthly, currency: sub.currency, econ });
    fee += feeInrMinor({ priceMinor: monthly, currency: sub.currency, econ });
    budget += budgetMinor({ priceMinor: sub.priceMinor, currency: sub.currency, interval: sub.interval === "year" ? "year" : "month", econ, target });
  }
  const packs = await db.payment.findMany({ where: { userId: payerId, purpose: "topup", status: "succeeded", sample: false, createdAt: { gte: monthStart(now), lt: nextMonthStart(now) } }, select: { amountMinor: true, currency: true } });
  for (const p of packs) {
    revenue += netRevenueInrMinor({ priceMinor: p.amountMinor, currency: p.currency, econ });
    fee += feeInrMinor({ priceMinor: p.amountMinor, currency: p.currency, econ });
    budget += budgetMinor({ priceMinor: p.amountMinor, currency: p.currency, econ, target });
  }
  return { revenue, fee, budget };
}

const parseBreakdown = (raw: string | null | undefined): Record<CostBucket, number> => {
  const out = Object.fromEntries(COST_BUCKETS.map((b) => [b, 0])) as Record<CostBucket, number>;
  try {
    const o = JSON.parse(raw || "{}");
    for (const b of COST_BUCKETS) if (Number.isFinite(o?.[b])) out[b] = Math.round(o[b]);
  } catch {
    /* a broken breakdown restarts at zero; costMinor keeps the total */
  }
  return out;
};

/**
 * Recomputes the month's revenue, fees and budget for this payer (after a payment, refund or pack) and creates
 * the row with the plan's fixed allocation the first time. Costs already recorded are kept. Idempotent.
 */
export async function refreshMonth(payerId: string, now = new Date(), known?: { sub: PaidSub | null; tier: string }) {
  const [econ, policy] = await Promise.all([getEconomics(), getPolicy()]);
  const sub = known ? known.sub : await activePaidSub(payerId, now);
  const tier = known?.tier ?? sub?.priceTier ?? "";
  const f = await monthFigures(payerId, sub, econ, policy.targetMargin, now);
  const fixed = sub ? Math.round((econ.fixedMonthly[sub.plan.slug] ?? 0) * 100) : 0;
  const month = monthKey(now);
  return db.subscriberMonth.upsert({
    where: { userId_month: { userId: payerId, month } },
    create: { userId: payerId, month, tier, revenueMinor: f.revenue, feeMinor: f.fee, budgetMinor: f.budget, costMinor: fixed, costBreakdown: JSON.stringify({ ...parseBreakdown(null), fixed }) },
    update: { tier, revenueMinor: f.revenue, feeMinor: f.fee, budgetMinor: f.budget },
  });
}

async function rowFor(payerId: string, now: Date, known: { sub: PaidSub | null; tier: string }) {
  return (await db.subscriberMonth.findUnique({ where: { userId_month: { userId: payerId, month: monthKey(now) } } })) ?? (await refreshMonth(payerId, now, known));
}

/** Adds the cost of `units` to the payer's month. Never throws: metering must not break the feature. */
export async function recordCost(o: { userId: string; category: CostCategory; units: number; now?: Date }): Promise<{ costMinor: number; payerId: string } | null> {
  try {
    if (!(await getPolicy()).enabled) return null; // policy off: nothing is metered, exactly as before 1147
    const now = o.now ?? new Date();
    const c = costMinor(o.category, o.units, await getEconomics());
    if (c <= 0) return null;
    const payer = await payerFor(o.userId, now);
    if (!payer) return null;
    const row = await rowFor(payer.payerId, now, payer);
    const bucket = bucketOf(o.category);
    await db.$transaction(async (tx) => {
      const cur = await tx.subscriberMonth.findUniqueOrThrow({ where: { id: row.id }, select: { costBreakdown: true } });
      const b = parseBreakdown(cur.costBreakdown);
      b[bucket] += c;
      await tx.subscriberMonth.update({ where: { id: row.id }, data: { costMinor: { increment: c }, costBreakdown: JSON.stringify(b) } });
    });
    return { costMinor: c, payerId: payer.payerId };
  } catch (e) {
    console.error("[costs] record", o.category, e);
    return null;
  }
}

export interface BudgetState {
  mode: BudgetMode;
  /** Whether the budget applies to this account at all (paid intro / standard subscribers, policy on). */
  applies: boolean;
  tier: string;
  budgetMinor: number;
  spentMinor: number;
  /** 0..100+, whole percent. */
  pct: number;
  warn: boolean;
  blocked: boolean;
  resetsAt: string;
}

export async function budgetState(userId: string, now = new Date()): Promise<BudgetState> {
  const policy = await getPolicy();
  const off = (tier = "", mode: BudgetMode = "off"): BudgetState => ({ mode, applies: false, tier, budgetMinor: 0, spentMinor: 0, pct: 0, warn: false, blocked: false, resetsAt: nextMonthStart(now).toISOString() });
  if (!policy.enabled) return off();
  const mode = policy.budget.mode;
  const payer = await payerFor(userId, now);
  if (!payer) return off("free", mode);
  if (mode === "off" || !BUDGETED_TIERS.includes(payer.tier)) return off(payer.tier, mode);
  const row = await rowFor(payer.payerId, now, payer);
  const pct = row.budgetMinor > 0 ? Math.floor((row.costMinor / row.budgetMinor) * 100) : 100;
  return {
    mode, applies: true, tier: payer.tier, budgetMinor: row.budgetMinor, spentMinor: row.costMinor, pct,
    warn: pct >= policy.budget.warnPct, blocked: mode === "enforce" && row.costMinor >= row.budgetMinor, resetsAt: nextMonthStart(now).toISOString(),
  };
}

const FEATURE_WORDS: Record<BudgetFeature, string> = { ai: "AI writing", transcription: "AI captions", x: "posts to X" };

/**
 * Call BEFORE a costly feature runs. Throws 402 BUDGET_REACHED (like PLAN_LIMIT) once this month's budget is
 * used; scheduling, publishing, calendar, inbox and analytics never call it. No-op while the policy is off.
 */
export async function assertBudget(userId: string, category: CostCategory, now = new Date()) {
  const feature = BLOCKING[category];
  if (!feature) return;
  const policy = await getPolicy();
  if (!policy.enabled || policy.budget.mode !== "enforce") return;
  const s = await budgetState(userId, now);
  if (!s.blocked) return;
  const day = new Date(s.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  throw new HttpError(402, `You've used this month's allowance for ${FEATURE_WORDS[feature]} on your plan. It comes back on ${day}, or add a pack to keep going now.`, "BUDGET_REACHED", { feature, upgrade: "/billing", resetsAt: s.resetsAt });
}

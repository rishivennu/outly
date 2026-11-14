/**
 * 1147 unit economics. Pure and client-safe: the admin policy editor, checkout and the tests all compute the
 * same numbers. Money is integer minor units; costs are INR (the workbook's unit), converted at `fx`.
 * Margin = (net revenue - payment fees - variable cost) / net revenue. Net revenue: INR sticker / (1 + GST);
 * other currencies are export (no GST). Fees are a share of the sticker price.
 * Seed values: Outlly-Unit-Economics-Model-2026-11.xlsx (RATES, UNITECONOMICS "Live price, after fixes", USAGE PTYP).
 */
export type CostCategory = "ai" | "ai_reply" | "ai_assist" | "transcription" | "x_post" | "x_read" | "storage" | "egress";
export type CostBucket = "ai" | "transcription" | "x" | "storage" | "egress" | "fixed";
export type Interval = "month" | "year";

export const COST_CATEGORIES: readonly CostCategory[] = ["ai", "ai_reply", "ai_assist", "transcription", "x_post", "x_read", "storage", "egress"];
export const COST_BUCKETS: readonly CostBucket[] = ["ai", "transcription", "x", "storage", "egress", "fixed"];
export const bucketOf = (c: CostCategory): CostBucket =>
  c === "ai" || c === "ai_reply" || c === "ai_assist" ? "ai" : c === "transcription" ? "transcription" : c === "x_post" || c === "x_read" ? "x" : c;

export interface PlanUsage {
  posts: number;
  xPosts: number;
  videos: number;
  audioMinPerVideo: number;
  writes: number;
  replies: number;
  assists: number;
  storageGb: number;
}

export interface Economics {
  /** INR per one unit of each currency. */
  fx: Record<string, number>;
  gstRate: number;
  /** Share of the sticker price lost to gateway fees + reserve. */
  feeShare: { domestic: number; international: number };
  /** INR per unit: ai = one AI request (writing session, hedged), transcription = audio minute, x_post = post, storage = GB-month, egress = GB. */
  rates: Record<CostCategory, number>;
  /** INR per subscriber per month by plan slug: hosting, database, email and support allocation. */
  fixedMonthly: Record<string, number>;
  /** Typical monthly variable cost (INR) by plan slug. Drives the 60% floor. */
  typicalCost: Record<string, number>;
  /** Full-allowance monthly variable cost (INR) by plan slug (heavy user, for the admin view). */
  fullCost: Record<string, number>;
  typicalUsage: Record<string, PlanUsage>;
}

export const DEFAULT_ECONOMICS: Economics = {
  fx: { INR: 1, USD: 94.71, EUR: 94.71, GBP: 115, CAD: 69.13, AUD: 62.31, SGD: 70.16, AED: 25.81 },
  gstRate: 0.18,
  feeShare: { domestic: 0.0441, international: 0.079 },
  rates: { ai: 0.6135, ai_reply: 0.1184, ai_assist: 0.2983, transcription: 1.2374, x_post: 2.2967, x_read: 0.4735, storage: 1.4206, egress: 0 },
  fixedMonthly: { free: 0, starter: 18.92, creator: 31.18, "pro-manager": 84.53 },
  typicalCost: { starter: 76.5, creator: 226.45, "pro-manager": 798.58 },
  fullCost: { starter: 217.29, creator: 573.34, "pro-manager": 1748.17 },
  typicalUsage: {
    starter: { posts: 20, xPosts: 6, videos: 10, audioMinPerVideo: 1.3, writes: 30, replies: 0, assists: 5, storageGb: 1.5 },
    creator: { posts: 50, xPosts: 20, videos: 35, audioMinPerVideo: 1.3, writes: 75, replies: 60, assists: 10, storageGb: 6 },
    "pro-manager": { posts: 180, xPosts: 80, videos: 110, audioMinPerVideo: 1.3, writes: 270, replies: 250, assists: 30, storageGb: 25 },
  },
};

export const TARGET_MARGIN = 0.6;

const fxOf = (currency: string, econ: Economics) => (currency === "INR" ? 1 : econ.fx[currency] ?? 0);
const domestic = (currency: string) => currency === "INR";
/** Net revenue kept per unit of sticker price. */
export const netShare = (currency: string, econ: Economics) => (domestic(currency) ? 1 / (1 + econ.gstRate) : 1);
export const feeShare = (currency: string, econ: Economics) => (domestic(currency) ? econ.feeShare.domestic : econ.feeShare.international);

/** Net revenue (ex GST) in INR paise for a sticker price in its own minor units. */
export function netRevenueInrMinor(o: { priceMinor: number; currency: string; econ: Economics }) {
  return Math.round(o.priceMinor * fxOf(o.currency, o.econ) * netShare(o.currency, o.econ));
}

/** Payment fees + reserve in INR paise. */
export function feeInrMinor(o: { priceMinor: number; currency: string; econ: Economics }) {
  return Math.round(o.priceMinor * fxOf(o.currency, o.econ) * feeShare(o.currency, o.econ));
}

/** Typical monthly cost of `plan` in INR paise (0 when the model has no figure for it). */
export const typicalCostInrMinor = (plan: string, econ: Economics) => Math.round((econ.typicalCost[plan] ?? 0) * 100);

/**
 * The lowest sticker price (minor units of `currency`) that still keeps `target` margin for a typical user.
 * Rounded UP to a whole currency unit. 0 when the plan has no cost figure or the currency no rate.
 */
export function floorMinor(o: { plan: string; currency: string; interval: Interval; econ: Economics; target?: number }) {
  const t = o.target ?? TARGET_MARGIN;
  const cost = (o.econ.typicalCost[o.plan] ?? 0) * (o.interval === "year" ? 12 : 1);
  const fx = fxOf(o.currency, o.econ);
  if (cost <= 0 || fx <= 0) return 0;
  const n = netShare(o.currency, o.econ);
  const keep = n - feeShare(o.currency, o.econ) - t * n;
  if (keep <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.ceil(cost / fx / keep - 1e-9) * 100;
}

/** Margin of one billing period. `costMinorInr` is the MONTHLY variable cost in INR paise (scaled by 12 for a year). */
export function marginFor(o: { priceMinor: number; currency: string; interval: Interval; costMinorInr: number; econ: Economics }) {
  const net = netRevenueInrMinor(o);
  const fee = feeInrMinor(o);
  const cost = o.costMinorInr * (o.interval === "year" ? 12 : 1);
  const profit = net - fee - cost;
  return { netMinorInr: net, feeMinorInr: fee, costMinorInr: cost, profitMinorInr: profit, margin: net > 0 ? profit / net : 0 };
}

/**
 * The monthly cost budget (INR paise) that keeps `target` margin: net revenue x (1 - target) - fees.
 * A yearly price is spread over 12 months. Never negative.
 */
export function budgetMinor(o: { priceMinor: number; currency: string; econ: Economics; interval?: Interval; target?: number }) {
  const t = o.target ?? TARGET_MARGIN;
  if (o.priceMinor <= 0) return 0;
  const monthly = (o.interval === "year" ? o.priceMinor / 12 : o.priceMinor) * fxOf(o.currency, o.econ);
  const net = monthly * netShare(o.currency, o.econ);
  const fee = monthly * feeShare(o.currency, o.econ);
  return Math.max(0, Math.round(net * (1 - t) - fee));
}

/** Cost of `units` of a category, INR paise. */
export const costMinor = (category: CostCategory, units: number, econ: Economics) => Math.max(0, Math.round((econ.rates[category] ?? 0) * Math.max(0, units) * 100));

/** Yearly price that respects both rules: at least 10 x monthly and never under the yearly floor. */
export function yearlyFromMonthly(o: { plan: string; currency: string; monthlyMinor: number; econ: Economics; target?: number }) {
  return Math.max(o.monthlyMinor * 10, floorMinor({ plan: o.plan, currency: o.currency, interval: "year", econ: o.econ, target: o.target }));
}

/** Keeps every number finite and in range; unknown keys dropped. Missing values fall back to the defaults. */
export function normalizeEconomics(raw: unknown): Economics {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Economics>;
  const d = DEFAULT_ECONOMICS;
  const num = (v: unknown, fb: number, max = 1e7) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : fb);
  const map = (v: unknown, fb: Record<string, number>, max?: number) => {
    const out: Record<string, number> = { ...fb };
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (/^[\w-]{1,40}$/.test(k)) out[k] = num(x, fb[k] ?? 0, max);
    return out;
  };
  const rates = {} as Record<CostCategory, number>;
  for (const c of COST_CATEGORIES) rates[c] = num((r.rates as Record<string, unknown> | undefined)?.[c], d.rates[c]);
  const usage: Record<string, PlanUsage> = { ...d.typicalUsage };
  if (r.typicalUsage && typeof r.typicalUsage === "object")
    for (const [k, u] of Object.entries(r.typicalUsage)) {
      if (!/^[\w-]{1,40}$/.test(k) || !u || typeof u !== "object") continue;
      const base = d.typicalUsage[k] ?? { posts: 0, xPosts: 0, videos: 0, audioMinPerVideo: 0, writes: 0, replies: 0, assists: 0, storageGb: 0 };
      usage[k] = Object.fromEntries(Object.keys(base).map((f) => [f, num((u as unknown as Record<string, unknown>)[f], base[f as keyof PlanUsage])])) as unknown as PlanUsage;
    }
  const fx = map(r.fx, d.fx);
  fx.INR = 1;
  return {
    fx,
    gstRate: num(r.gstRate, d.gstRate, 1),
    feeShare: { domestic: num(r.feeShare?.domestic, d.feeShare.domestic, 0.5), international: num(r.feeShare?.international, d.feeShare.international, 0.5) },
    rates,
    fixedMonthly: map(r.fixedMonthly, d.fixedMonthly),
    typicalCost: map(r.typicalCost, d.typicalCost),
    fullCost: map(r.fullCost, d.fullCost),
    typicalUsage: usage,
  };
}

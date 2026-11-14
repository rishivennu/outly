import "server-only";
import { db } from "../db";
import { CURRENCIES, type Currency } from "../billing/money";
import { localPrice, parsePrices } from "../billing/currency";
import { DEFAULT_ECONOMICS, floorMinor, normalizeEconomics, TARGET_MARGIN, type Economics } from "./economics";

/**
 * 1147 subscription policy (Setting "subs.policy") and the cost model (Setting "subs.economics").
 * DISABLED by default: until an admin enables it, checkout, renewals and billing behave exactly as before.
 * Prices are monthly minor units per plan slug and currency. The returning price is the plan's live price
 * (Plan.priceMinor / Plan.prices); only the first-time (intro) prices live here.
 */
export type BudgetMode = "off" | "alert" | "enforce";

export interface RiskWeights {
  device: number;
  payment: number;
  email: number;
  netUa: number;
  burst: number;
  ip: number;
  ipCap: number;
  phoneNew: number;
  tenure: number;
  high: number;
  medium: number;
}

export interface SubsPolicy {
  enabled: boolean;
  version: string;
  enabledAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Monthly first-time price per plan slug and currency (minor units). Yearly = max(10 x monthly, yearly floor). */
  intro: Record<string, Partial<Record<Currency, number>>>;
  /** Days after currentPeriodEnd before a subscription counts as lapsed. */
  graceDays: number;
  trialDays: number;
  trialPlanSlug: string;
  budget: { mode: BudgetMode; warnPct: number };
  risk: RiskWeights;
  targetMargin: number;
  refundWindowDays: number;
  /** An official pause never counts as a lapse; while the policy is on it is capped at this many months. */
  maxPauseMonths: number;
}

export const DEFAULT_RISK: RiskWeights = { device: 60, payment: 70, email: 70, netUa: 25, burst: 15, ip: 5, ipCap: 10, phoneNew: -30, tenure: -10, high: 70, medium: 40 };

export const DEFAULT_POLICY: SubsPolicy = {
  enabled: false,
  version: "0",
  enabledAt: null,
  updatedAt: null,
  updatedBy: null,
  intro: {
    starter: { INR: 27900, USD: 500, EUR: 500, GBP: 400 },
    creator: { INR: 79900, USD: 1000, EUR: 1000, GBP: 800 },
    "pro-manager": { INR: 279900, USD: 2700, EUR: 2700, GBP: 2200 },
  },
  graceDays: 7,
  trialDays: 7,
  trialPlanSlug: "creator",
  budget: { mode: "enforce", warnPct: 80 },
  risk: DEFAULT_RISK,
  targetMargin: TARGET_MARGIN,
  refundWindowDays: 30,
  maxPauseMonths: 1,
};

export const POLICY_KEY = "subs.policy";
export const POLICY_PREV_KEY = "subs.policy.prev";
export const ECONOMICS_KEY = "subs.economics";

/** code "below_floor" marks a price under its margin floor, so callers never match on message text. */
export type FieldError = { field: string; message: string; code?: "below_floor" | "risk" };
export type SaveResult<T> = { ok: true; value: T; warnings?: FieldError[] } | { ok: false; errors: FieldError[] };

const BUDGET_MODES: readonly BudgetMode[] = ["off", "alert", "enforce"];
const int = (v: unknown, fb: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fb);

/** Reads any stored shape safely; missing or broken fields fall back to the defaults. */
export function normalizePolicy(raw: unknown): SubsPolicy {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<SubsPolicy>;
  const d = DEFAULT_POLICY;
  const intro: SubsPolicy["intro"] = {};
  const src = r.intro && typeof r.intro === "object" ? r.intro : d.intro;
  for (const [slug, prices] of Object.entries(src)) if (/^[\w-]{1,40}$/.test(slug)) intro[slug] = parsePrices(prices);
  const risk = { ...DEFAULT_RISK };
  if (r.risk && typeof r.risk === "object") for (const k of Object.keys(DEFAULT_RISK) as (keyof RiskWeights)[]) risk[k] = int((r.risk as unknown as Record<string, unknown>)[k], DEFAULT_RISK[k], -100, 200);
  const tm = typeof r.targetMargin === "number" && Number.isFinite(r.targetMargin) ? Math.min(0.95, Math.max(TARGET_MARGIN, r.targetMargin)) : d.targetMargin;
  return {
    enabled: r.enabled === true,
    version: typeof r.version === "string" && r.version ? r.version.slice(0, 40) : d.version,
    enabledAt: typeof r.enabledAt === "string" ? r.enabledAt : null,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
    updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : null,
    intro,
    graceDays: int(r.graceDays, d.graceDays, 0, 30),
    trialDays: int(r.trialDays, d.trialDays, 0, 7),
    trialPlanSlug: typeof r.trialPlanSlug === "string" && /^[\w-]{1,40}$/.test(r.trialPlanSlug) ? r.trialPlanSlug : d.trialPlanSlug,
    budget: { mode: BUDGET_MODES.includes(r.budget?.mode as BudgetMode) ? (r.budget!.mode as BudgetMode) : d.budget.mode, warnPct: int(r.budget?.warnPct, d.budget.warnPct, 1, 99) },
    risk,
    targetMargin: tm,
    refundWindowDays: int(r.refundWindowDays, d.refundWindowDays, 0, 365),
    maxPauseMonths: int(r.maxPauseMonths, d.maxPauseMonths, 1, 3),
  };
}

// 15 s in-process cache, like lib/settings.ts: read on every checkout and AI call, written rarely.
const g = globalThis as unknown as { __subsCfg?: Map<string, { at: number; v: unknown }> };
const cache = (g.__subsCfg ??= new Map());
async function readSetting<T>(key: string, norm: (raw: unknown) => T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.v as T;
  const row = await db.setting.findUnique({ where: { key } });
  let raw: unknown = null;
  try {
    raw = row ? JSON.parse(row.value) : null;
  } catch {
    raw = null; // a corrupt row reads as the defaults (policy off), never a crash at checkout
  }
  const v = norm(raw);
  cache.set(key, { at: Date.now(), v });
  return v;
}
const writeSetting = async (key: string, value: unknown) => {
  const s = JSON.stringify(value);
  await db.setting.upsert({ where: { key }, create: { key, value: s }, update: { value: s } });
  cache.delete(key);
};
export const clearPolicyCache = () => cache.clear();

export const getPolicy = () => readSetting(POLICY_KEY, normalizePolicy);
export const getEconomics = () => readSetting(ECONOMICS_KEY, normalizeEconomics);

/** Every intro price checked against its plan's floor (at the target margin) and its returning price. */
export async function validatePolicy(p: SubsPolicy, econ: Economics): Promise<FieldError[]> {
  const errors: FieldError[] = [];
  const plans = await db.plan.findMany({ where: { slug: { in: Object.keys(p.intro) } } });
  for (const [slug, prices] of Object.entries(p.intro)) {
    const plan = plans.find((x) => x.slug === slug);
    for (const [cur, minor] of Object.entries(prices) as [Currency, number][]) {
      const field = `intro.${slug}.${cur}`;
      if (!Number.isInteger(minor) || minor <= 0) {
        errors.push({ field, message: "Enter a price above zero." });
        continue;
      }
      const floor = floorMinor({ plan: slug, currency: cur, interval: "month", econ, target: p.targetMargin });
      if (floor > 0 && minor < floor) errors.push({ field, code: "below_floor", message: `Below the ${Math.round(p.targetMargin * 100)}% margin floor of ${(floor / 100).toFixed(2)} ${cur}.` });
      if (plan && plan.priceMinor > 0) {
        const std = localPrice({ ...plan, prices: parsePrices(plan.prices) }, cur).priceMinor;
        if (minor > std) errors.push({ field, message: `Higher than the returning price (${(std / 100).toFixed(2)} ${cur}).` });
        // With the policy on, the returning price must clear the floor too (quote() also clamps it, as a backstop).
        if (p.enabled && floor > 0 && std < floor) errors.push({ field: `standard.${slug}.${cur}`, code: "below_floor", message: `The returning price ${(std / 100).toFixed(2)} ${cur} is under the ${Math.round(p.targetMargin * 100)}% margin floor of ${(floor / 100).toFixed(2)} ${cur}. Raise it in Plans first.` });
      }
    }
  }
  if (p.trialDays < 0 || p.trialDays > 7) errors.push({ field: "trialDays", message: "A trial is 0 to 7 days." });
  // IP evidence must never decide on its own: capped IP, even with a signup burst, stays under "verify".
  const w = p.risk;
  if (w.ipCap < 0) errors.push({ field: "risk.ipCap", code: "risk", message: "The IP cap can't be negative." });
  if (w.medium < 1 || w.high <= w.medium) errors.push({ field: "risk.high", code: "risk", message: "The deny score has to be higher than the verify score, and both above zero." });
  if (w.ipCap + Math.max(0, w.burst) >= w.medium) errors.push({ field: "risk.ipCap", code: "risk", message: `IP address and network evidence alone (${w.ipCap + Math.max(0, w.burst)}) would reach the verify score (${w.medium}). Lower the IP cap or the burst weight.` });
  return errors;
}

const parseAny = (raw: unknown) => (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

/**
 * Saves the policy. Refuses (and changes nothing) when any intro price is under its floor. The version bumps
 * on every save; existing subscribers keep the price and tier snapshotted on their subscription.
 * The previous policy is kept for undoPolicy().
 */
export async function savePolicy(next: Partial<SubsPolicy>, adminId: string): Promise<SaveResult<SubsPolicy>> {
  const cur = await getPolicy();
  const n = parseAny(next);
  const intro = n.intro && typeof n.intro === "object" ? (n.intro as SubsPolicy["intro"]) : cur.intro;
  const merged = normalizePolicy({ ...cur, ...n, intro, budget: { ...cur.budget, ...parseAny(n.budget) }, risk: { ...cur.risk, ...parseAny(n.risk) } });
  const errors: FieldError[] = [];
  if (n.trialDays !== undefined && (typeof n.trialDays !== "number" || n.trialDays < 0 || n.trialDays > 7)) errors.push({ field: "trialDays", message: "A trial is 0 to 7 days." });
  if (n.targetMargin !== undefined && (typeof n.targetMargin !== "number" || n.targetMargin < TARGET_MARGIN)) errors.push({ field: "targetMargin", message: `The margin target can't go under ${TARGET_MARGIN * 100}%.` });
  if (n.budget && !BUDGET_MODES.includes(parseAny(n.budget).mode as BudgetMode) && parseAny(n.budget).mode !== undefined) errors.push({ field: "budget.mode", message: "Pick off, alert or enforce." });
  errors.push(...(await validatePolicy(merged, await getEconomics())));
  if (errors.length) return { ok: false, errors };
  const now = new Date().toISOString();
  const value: SubsPolicy = {
    ...merged,
    version: String((Number(cur.version) || 0) + 1),
    enabledAt: merged.enabled ? cur.enabledAt ?? now : cur.enabledAt,
    updatedAt: now,
    updatedBy: adminId.slice(0, 120),
  };
  await writeSetting(POLICY_PREV_KEY, cur);
  await writeSetting(POLICY_KEY, value);
  return { ok: true, value };
}

/** Puts the policy saved before the last save back (as a new version). */
export async function undoPolicy(adminId: string): Promise<SaveResult<SubsPolicy>> {
  const row = await db.setting.findUnique({ where: { key: POLICY_PREV_KEY } });
  if (!row) return { ok: false, errors: [{ field: "", message: "Nothing to undo." }] };
  let prev: unknown = null;
  try {
    prev = JSON.parse(row.value);
  } catch {
    return { ok: false, errors: [{ field: "", message: "The saved copy can't be read." }] };
  }
  return savePolicy(normalizePolicy(prev), adminId);
}

/** Saves the cost model. Bad numbers, and rates that would put any price under its floor, are refused. */
export async function saveEconomics(next: Partial<Economics>, adminId: string): Promise<SaveResult<Economics>> {
  const cur = await getEconomics();
  const n = parseAny(next);
  const errors: FieldError[] = [];
  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined) return;
    if (typeof v === "object") for (const [k, x] of Object.entries(v as object)) walk(x, path ? `${path}.${k}` : k);
    else if (typeof v !== "number" || !Number.isFinite(v) || v < 0) errors.push({ field: path, message: "Use a number of zero or more." });
  };
  walk(n, "");
  const fx = parseAny(n.fx);
  for (const [k, v] of Object.entries(fx)) if (v === 0) errors.push({ field: `fx.${k}`, message: "An exchange rate can't be zero." });
  if (errors.length) return { ok: false, errors };
  const merged = normalizeEconomics({
    ...cur, ...n,
    fx: { ...cur.fx, ...fx }, rates: { ...cur.rates, ...parseAny(n.rates) }, feeShare: { ...cur.feeShare, ...parseAny(n.feeShare) },
    fixedMonthly: { ...cur.fixedMonthly, ...parseAny(n.fixedMonthly) }, typicalCost: { ...cur.typicalCost, ...parseAny(n.typicalCost) },
    fullCost: { ...cur.fullCost, ...parseAny(n.fullCost) }, typicalUsage: { ...cur.typicalUsage, ...parseAny(n.typicalUsage) },
  });
  // Rates that would put any price under its margin floor are refused here, not only in the admin route.
  const checked = await validatePolicy(await getPolicy(), merged);
  const under = checked.filter((e) => e.code === "below_floor");
  if (under.length) return { ok: false, errors: under };
  await writeSetting(ECONOMICS_KEY, { ...merged, updatedBy: adminId.slice(0, 120), updatedAt: new Date().toISOString() });
  const warnings = checked.filter((e) => e.code !== "below_floor");
  return { ok: true, value: merged, ...(warnings.length ? { warnings } : {}) };
}

export { DEFAULT_ECONOMICS, CURRENCIES };

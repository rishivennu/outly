/**
 * 1096 step 4: price split tests, the Van Westendorp price survey and the keep-or-change rule.
 * Pure and client-safe, so the admin results, checkout and the tests compute the same numbers.
 */

export interface PriceVariant {
  id: string;
  priceMinor: number;
  weight: number;
}

/** One live price test at a time. `name` keys the results, so a new test needs a new name. */
export interface PriceExperiment {
  enabled: boolean;
  name: string;
  plan: string; // plan slug
  currency: string; // only visitors paying in this currency are in the test; everyone else sees the plan price
  variants: PriceVariant[];
}

export interface ExperimentsConfig {
  price: PriceExperiment;
}

export const EXPERIMENTS_DEFAULT: ExperimentsConfig = {
  price: {
    enabled: false,
    name: "starter-price-2026-11",
    plan: "starter",
    currency: "INR",
    variants: [
      { id: "a", priceMinor: 29900, weight: 50 },
      { id: "b", priceMinor: 39900, weight: 50 },
    ],
  },
};

/** FNV-1a, 32 bit. Stable across processes and releases, so a person always sees the same price. */
export function hash32(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Which variant this person is in. Same userId + experiment = same answer, every time. */
export function assignVariant<V extends { id: string; weight?: number }>(userId: string, experiment: string, variants: readonly V[]): V | null {
  const usable = variants.filter((v) => (v.weight ?? 1) > 0);
  if (!usable.length) return null;
  const total = usable.reduce((s, v) => s + (v.weight ?? 1), 0);
  let at = (hash32(`${experiment}:${userId}`) / 0x1_0000_0000) * total;
  for (const v of usable) {
    at -= v.weight ?? 1;
    if (at < 0) return v;
  }
  return usable[usable.length - 1];
}

/** Cleans what an admin saved: at most 4 variants, unique ids, positive prices. */
export function normalizeExperiments(raw: unknown): ExperimentsConfig {
  const r = (raw ?? {}) as Partial<ExperimentsConfig>;
  const p = (r.price ?? {}) as Partial<PriceExperiment>;
  const seen = new Set<string>();
  const variants = (Array.isArray(p.variants) ? p.variants : EXPERIMENTS_DEFAULT.price.variants)
    .map((v) => ({ id: String(v?.id ?? "").trim().slice(0, 12), priceMinor: Math.round(Number(v?.priceMinor)), weight: Math.max(0, Math.round(Number(v?.weight ?? 50))) }))
    .filter((v) => v.id && Number.isFinite(v.priceMinor) && v.priceMinor > 0 && !seen.has(v.id) && seen.add(v.id))
    .slice(0, 4);
  return {
    price: {
      enabled: !!p.enabled && variants.length >= 2,
      name: String(p.name ?? EXPERIMENTS_DEFAULT.price.name).trim().slice(0, 60) || EXPERIMENTS_DEFAULT.price.name,
      plan: String(p.plan ?? EXPERIMENTS_DEFAULT.price.plan).trim().slice(0, 30),
      currency: String(p.currency ?? "INR").toUpperCase().slice(0, 3),
      variants,
    },
  };
}

/** The test price for this person on this plan in this currency, or null when they aren't in a test. */
export function priceVariant(cfg: ExperimentsConfig, planSlug: string, userId: string, currency: string) {
  const x = cfg.price;
  if (!x.enabled || x.plan !== planSlug || x.currency !== currency || x.variants.length < 2) return null;
  const v = assignVariant(userId, x.name, x.variants);
  return v ? { experiment: x.name, variant: v.id, priceMinor: v.priceMinor } : null;
}

export interface VariantCounts {
  variant: string;
  exposures: number;
  checkouts: number;
  paid: number;
  revenueMinor: number;
}

/** Conversion per variant plus a two-proportion z-test of each variant against the first. |z| >= 1.96 ~ 95%. */
export function experimentResults(rows: VariantCounts[]) {
  const base = rows[0];
  return rows.map((r) => {
    const rate = r.exposures ? r.paid / r.exposures : 0;
    let z = 0;
    if (base && r !== base && r.exposures && base.exposures) {
      const p = (r.paid + base.paid) / (r.exposures + base.exposures);
      const se = Math.sqrt(p * (1 - p) * (1 / r.exposures + 1 / base.exposures));
      z = se > 0 ? (rate - base.paid / base.exposures) / se : 0;
    }
    return { ...r, rate, revenuePerVisitor: r.exposures ? r.revenueMinor / r.exposures : 0, z: Math.round(z * 100) / 100, significant: Math.abs(z) >= 1.96 };
  });
}

// ---------------------------------------------------------------- Van Westendorp

export interface PriceAnswers {
  tooCheap: number;
  cheap: number;
  expensive: number;
  tooExpensive: number;
}

/** null when the four answers make sense (too cheap < cheap < expensive < too expensive), else the problem. */
export function surveyProblem(a: PriceAnswers) {
  const v = [a.tooCheap, a.cheap, a.expensive, a.tooExpensive];
  if (v.some((n) => !Number.isFinite(n) || n < 0 || n > 100_000_000)) return "Enter a price for each question.";
  if (!(a.tooCheap < a.cheap && a.cheap < a.expensive && a.expensive < a.tooExpensive)) return "Each answer should be higher than the one before it.";
  return null;
}

/** Where curve a - b changes sign, interpolated between the two price points. */
function crossing(prices: number[], a: number[], b: number[]) {
  for (let i = 1; i < prices.length; i++) {
    const d0 = a[i - 1] - b[i - 1];
    const d1 = a[i] - b[i];
    if (d0 === 0) return prices[i - 1];
    if (Math.sign(d0) !== Math.sign(d1)) {
      const t = d0 / (d0 - d1);
      return Math.round(prices[i - 1] + t * (prices[i] - prices[i - 1]));
    }
  }
  return null;
}

/**
 * Van Westendorp price sensitivity. Returns the acceptable range (PMC to PME), the optimal price (OPP, too
 * cheap = too expensive) and the indifference price (IPP, cheap = expensive). Null points when the curves
 * don't cross in the answers given; `n` is how many answers it rests on (under ~30 is a hint, not a result).
 */
export function vanWestendorp(answers: PriceAnswers[]) {
  const ok = answers.filter((a) => !surveyProblem(a));
  const n = ok.length;
  if (n === 0) return { n, opp: null, ipp: null, pmc: null, pme: null };
  const prices = [...new Set(ok.flatMap((a) => [a.tooCheap, a.cheap, a.expensive, a.tooExpensive]))].sort((x, y) => x - y);
  const share = (f: (a: PriceAnswers) => boolean) => ok.filter(f).length / n;
  const tooCheap = prices.map((p) => share((a) => a.tooCheap >= p));
  const cheap = prices.map((p) => share((a) => a.cheap >= p));
  const expensive = prices.map((p) => share((a) => a.expensive <= p));
  const tooExpensive = prices.map((p) => share((a) => a.tooExpensive <= p));
  const notCheap = cheap.map((c) => 1 - c);
  const notExpensive = expensive.map((e) => 1 - e);
  return {
    n,
    opp: crossing(prices, tooCheap, tooExpensive),
    ipp: crossing(prices, cheap, expensive),
    pmc: crossing(prices, tooCheap, notCheap),
    pme: crossing(prices, tooExpensive, notExpensive),
  };
}

// ---------------------------------------------------------------- decision rule

export const KEEP_RULE = { freeToPaid60: 0.04, churn: 0.06 };

/** The strategy's rule: keep the four-plan structure while 60-day free-to-paid >= 4% and monthly churn <= 6%. */
export function keepStructure(m: { freeToPaid60: number; churn: number }) {
  return m.freeToPaid60 >= KEEP_RULE.freeToPaid60 && m.churn <= KEEP_RULE.churn;
}

export const CANCEL_REASONS = ["too-expensive", "not-using", "missing-feature", "bugs", "switched", "temporary", "other"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
export const CANCEL_REASON_LABEL: Record<CancelReason, string> = {
  "too-expensive": "It costs too much",
  "not-using": "I'm not posting enough to need it",
  "missing-feature": "It's missing something I need",
  bugs: "Something kept breaking",
  switched: "I moved to another tool",
  temporary: "Just pausing for now",
  other: "Something else",
};

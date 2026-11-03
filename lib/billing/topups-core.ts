/**
 * Top-up packs (1096). Client-safe and pure: the billing page, checkout and the admin editor price them the same way.
 * ai packs are AI captions (one unit = one video captioned; Outlly does not generate videos). ai / x packs are spent one unit at a time, only after the plan's own monthly allowance is used up, and keep
 * for `days`. brand / seat packs add room for `days` from the purchase. Off until an admin turns them on.
 */
import { CURRENCIES, type Currency } from "./money";
import { localPrice, type Priced } from "./currency";

export const TOPUP_KINDS = ["ai", "x", "brand", "seat"] as const;
export type TopUpKind = (typeof TOPUP_KINDS)[number];

export interface TopUpPack {
  id: string;
  kind: TopUpKind;
  units: number;
  /** Price in INR minor units. */
  priceMinor: number;
  /** Exact prices in other currencies (minor units); missing ones are converted. */
  prices: Partial<Record<Currency, number>>;
  days: number;
  label: string;
  /** Plan slugs that may buy it; [] = any plan allowed by `paidOnly`. */
  plans: string[];
}

export interface TopUpConfig {
  enabled: boolean;
  /** Only people on a paid plan can buy packs (Free upgrades instead). */
  paidOnly: boolean;
  packs: TopUpPack[];
}

export const TOPUP_DEFAULT: TopUpConfig = {
  enabled: false,
  paidOnly: true,
  packs: [
    { id: "ai-20", kind: "ai", units: 20, priceMinor: 9900, prices: { USD: 200, EUR: 200, GBP: 200 }, days: 90, label: "AI captions on 20 more videos", plans: [] },
    { id: "x-100", kind: "x", units: 100, priceMinor: 19900, prices: { USD: 300, EUR: 300, GBP: 300 }, days: 90, label: "100 more X posts", plans: [] },
    { id: "brand-1", kind: "brand", units: 1, priceMinor: 29900, prices: { USD: 500, EUR: 500, GBP: 400 }, days: 30, label: "1 extra brand for 30 days", plans: ["pro-manager"] },
    { id: "seat-1", kind: "seat", units: 1, priceMinor: 19900, prices: { USD: 400, EUR: 400, GBP: 300 }, days: 30, label: "1 extra team seat for 30 days", plans: ["pro-manager"] },
  ],
};

const int = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
};

function normalizePack(v: unknown): TopUpPack | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const id = typeof o.id === "string" && /^[a-z0-9-]{2,30}$/.test(o.id) ? o.id : null;
  const kind = (TOPUP_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as TopUpKind) : null;
  if (!id || !kind) return null;
  const prices: Partial<Record<Currency, number>> = {};
  if (o.prices && typeof o.prices === "object")
    for (const [k, n] of Object.entries(o.prices as Record<string, unknown>)) if ((CURRENCIES as readonly string[]).includes(k) && Number.isInteger(n) && (n as number) > 0) prices[k as Currency] = n as number;
  const units = int(o.units, 1, 10_000, 1);
  return {
    id, kind,
    units,
    priceMinor: int(o.priceMinor, 100, 10_000_000, 9900),
    prices,
    days: int(o.days, 1, 365, kind === "brand" || kind === "seat" ? 30 : 90),
    label: typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 60) : (kind === "ai" ? `AI captions on ${units} more videos` : `${units} more ${kind === "x" ? "X posts" : kind === "brand" ? "brands" : "seats"}`),
    plans: Array.isArray(o.plans) ? o.plans.filter((s): s is string => typeof s === "string" && /^[a-z0-9-]{2,30}$/.test(s)).slice(0, 10) : [],
  };
}

export function normalizeTopups(v: unknown): TopUpConfig {
  const o = (v && typeof v === "object" ? v : {}) as Partial<TopUpConfig>;
  const packs = Array.isArray(o.packs) ? o.packs.map(normalizePack).filter((p): p is TopUpPack => !!p) : TOPUP_DEFAULT.packs;
  const seen = new Set<string>();
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : TOPUP_DEFAULT.enabled,
    paidOnly: typeof o.paidOnly === "boolean" ? o.paidOnly : TOPUP_DEFAULT.paidOnly,
    packs: packs.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true))).slice(0, 12),
  };
}

/** Price of a pack for one visitor currency. */
export const packPrice = (p: Pick<TopUpPack, "priceMinor" | "prices">, target: Currency): Priced => localPrice({ priceMinor: p.priceMinor, currency: "INR", prices: p.prices }, target);

/** The plan limits a pack adds to. Unknown (undefined) = don't second-guess the admin's plan list. */
export type PackPlanLimits = { xPostLimit: number; captionVideos: number; aiCaptions: boolean; brandLimit: number };

/** Why this person can't buy `pack` right now, or null. */
export function packBlock(cfg: TopUpConfig, pack: TopUpPack | undefined, planSlug: string, paid: boolean, plan?: PackPlanLimits): string | null {
  if (!cfg.enabled) return "Top-ups aren't on sale yet.";
  if (!pack) return "That pack isn't on sale.";
  if (pack.plans.length && !pack.plans.includes(planSlug)) return "That pack is for a different plan. Upgrade to buy it.";
  if (cfg.paidOnly && !paid) return "Top-ups are for paid plans. Upgrade first; it includes more than a pack would.";
  // Never take money for units the plan can't use, or doesn't need.
  if (plan && pack.kind === "x" && plan.xPostLimit < 0) return "Your plan doesn't post to X. Upgrade to get X posts.";
  if (plan && pack.kind === "x" && plan.xPostLimit <= 0) return "Your plan already posts to X without a monthly limit.";
  if (plan && pack.kind === "ai" && !plan.aiCaptions) return "Your plan doesn't include AI captions. Upgrade to get them.";
  if (plan && pack.kind === "ai" && plan.captionVideos <= 0) return "Your plan already has AI captions without a monthly limit.";
  if (plan && pack.kind === "brand" && plan.brandLimit <= 0) return "Your plan doesn't count brands, so an extra brand wouldn't add anything.";
  return null;
}

export const packExpiry = (p: Pick<TopUpPack, "days">, now = new Date()) => new Date(now.getTime() + p.days * 86_400_000);

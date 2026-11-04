/**
 * 1122: promo offers (flash sales), the pure rules. Shared by the popup endpoint, the billing page and checkout, so
 * the number on the sheet, the number on the plan card and the number charged are always the same number.
 *
 * Rules that keep an offer honest:
 * - the "was" price is the price this person would really pay today without the offer (list price, or their price
 *   test), never a made-up anchor;
 * - an offer that has ended, not started, been switched off or sold out is never shown and never applied;
 * - offers don't stack with the founding discount: the buyer gets whichever price is lower, and the offer is only
 *   shown when it actually beats what they already pay;
 * - it applies once, to the first payment; renewals bill the regular price (shown on the billing page);
 * - the price never drops under the gateway minimum (MIN_CHARGE_MINOR), so it is never zero or negative.
 */
import { MIN_CHARGE_MINOR } from "./founding-config";
import { formatMoney } from "./billing/money";

export const CAMPAIGN_KINDS = ["pct", "fixed"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];
export const ELIGIBILITY = ["all", "free", "new", "lapsed"] as const;
export type Eligibility = (typeof ELIGIBILITY)[number];
export const ELIGIBILITY_LABEL: Record<Eligibility, string> = {
  all: "Everyone not already on the plan",
  free: "People on Free (never paid, or not paying now)",
  new: "New accounts (joined in the last 14 days, never paid)",
  lapsed: "Lapsed (paid before, not paying now)",
};
export const EVENT_KINDS = ["impression", "dismiss", "click", "conversion"] as const;
export type CampaignEventKind = (typeof EVENT_KINDS)[number];
/** The client may report these; a conversion only comes from a confirmed payment on the server. */
export const CLIENT_EVENTS = ["impression", "dismiss", "click"] as const;

export const NEW_ACCOUNT_DAYS = 14;
export const MAX_PCT = 90;
export const LIMITS = { title: 60, badge: 24, headline: 40, body: 160, benefit: 60, benefits: 4, terms: 240, cta: 28, href: 120 } as const;

export interface Banner {
  badge: string;
  headline: string;
  body: string;
  benefits: string[];
  terms: string;
}

export interface CampaignLike {
  id: string;
  title: string;
  kind: string;
  value: number;
  currency: string;
  planSlugs: string;
  startsAt: Date;
  endsAt: Date;
  banner: string;
  ctaText: string;
  ctaHref: string;
  eligibility: string;
  active: boolean;
  maxRedemptions: number;
  redemptions: number;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function parseBanner(raw: string | null | undefined): Banner {
  let o: Record<string, unknown> = {};
  try {
    const v = JSON.parse(raw || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) o = v;
  } catch {}
  const benefits = Array.isArray(o.benefits) ? o.benefits.map((b) => str(b, LIMITS.benefit)).filter(Boolean).slice(0, LIMITS.benefits) : [];
  return { badge: str(o.badge, LIMITS.badge), headline: str(o.headline, LIMITS.headline), body: str(o.body, LIMITS.body), benefits, terms: str(o.terms, LIMITS.terms) };
}

export function parseSlugs(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === "string" && /^[a-z0-9-]{2,30}$/.test(s)))] : [];
  } catch {
    return [];
  }
}

export type LiveState = "live" | "off" | "scheduled" | "ended" | "sold-out" | "invalid";

/** Whether an offer may be shown or applied right now. Anything but "live" means no. */
export function liveState(c: Pick<CampaignLike, "active" | "startsAt" | "endsAt" | "maxRedemptions" | "redemptions" | "kind" | "value" | "planSlugs">, now: Date = new Date()): LiveState {
  if (!validOffer(c)) return "invalid";
  if (now.getTime() >= c.endsAt.getTime()) return "ended";
  if (c.maxRedemptions > 0 && c.redemptions >= c.maxRedemptions) return "sold-out";
  if (!c.active) return "off";
  if (now.getTime() < c.startsAt.getTime()) return "scheduled";
  return "live";
}

export const isLive = (c: Parameters<typeof liveState>[0], now?: Date) => liveState(c, now) === "live";

function validOffer(c: Pick<CampaignLike, "kind" | "value" | "planSlugs" | "startsAt" | "endsAt">) {
  if (c.kind === "pct" && !(Number.isInteger(c.value) && c.value >= 1 && c.value <= MAX_PCT)) return false;
  if (c.kind === "fixed" && !(Number.isInteger(c.value) && c.value > 0)) return false;
  if (c.kind !== "pct" && c.kind !== "fixed") return false;
  if (!(c.endsAt.getTime() > c.startsAt.getTime())) return false;
  return parseSlugs(c.planSlugs).length > 0;
}

export interface Who {
  /** Has a paid (non-gift) subscription that is active right now. */
  paying: boolean;
  /** Has ever had a succeeded plan payment. */
  everPaid: boolean;
  joinedAt: Date;
}

export function eligible(rule: string, who: Who, now: Date = new Date()): boolean {
  if (rule === "all") return true;
  if (rule === "free") return !who.paying;
  if (rule === "new") return !who.everPaid && now.getTime() - who.joinedAt.getTime() <= NEW_ACCOUNT_DAYS * 86_400_000;
  if (rule === "lapsed") return who.everPaid && !who.paying;
  return false; // an unknown rule never matches
}

/**
 * The offer price for `originalMinor` (what this buyer pays today in `currency`), or null when the offer doesn't
 * apply in this currency or wouldn't lower the price. Percent offers round down to a whole unit, like founding.
 */
export function offerPrice(c: Pick<CampaignLike, "kind" | "value" | "currency">, originalMinor: number, currency: string): number | null {
  if (!(originalMinor > MIN_CHARGE_MINOR)) return null;
  let p: number;
  if (c.kind === "pct") {
    if (!(c.value >= 1 && c.value <= MAX_PCT)) return null;
    p = Math.floor(Math.floor((originalMinor * (100 - c.value)) / 100) / 100) * 100;
  } else if (c.kind === "fixed") {
    if (c.currency !== currency || !(c.value > 0)) return null;
    p = originalMinor - c.value;
  } else return null;
  p = Math.max(MIN_CHARGE_MINOR, p);
  return p < originalMinor ? p : null;
}

/**
 * Founding and offer don't stack: the lower price wins. `foundingMinor` is the founding price (or the plain price
 * when there is no founding discount). Returns the offer price only when it beats it.
 */
export function bestOffer(c: Pick<CampaignLike, "kind" | "value" | "currency">, originalMinor: number, foundingMinor: number, currency: string): number | null {
  const p = offerPrice(c, originalMinor, currency);
  return p !== null && p < foundingMinor ? p : null;
}

/** The big "46% OFF": the campaign's own wording, unless the struck price is a founding price, then the real saving off it. */
export function savingLabel(c: Pick<CampaignLike, "kind" | "value" | "currency">, q: { originalMinor: number; listMinor: number; finalMinor: number; currency: string }) {
  if (q.originalMinor === q.listMinor) return offerLabel(c);
  const off = q.originalMinor - q.finalMinor;
  return c.kind === "pct" ? `${Math.floor((off * 100) / q.originalMinor)}% OFF` : `${formatMoney(off, q.currency).replace(/\.00$/, "")} OFF`;
}

/** "46% OFF" or "₹200 OFF": the big number on the sheet. */
export function offerLabel(c: Pick<CampaignLike, "kind" | "value" | "currency">) {
  return c.kind === "pct" ? `${c.value}% OFF` : `${formatMoney(c.value, c.currency).replace(/\.00$/, "")} OFF`;
}

/** What the invoice line says. */
export const discountLabel = (c: Pick<CampaignLike, "title" | "kind" | "value" | "currency">) =>
  `Offer: ${c.title} (${c.kind === "pct" ? `${c.value}%` : `${formatMoney(c.value, c.currency)} off`})`;

/** Only a path inside the app, never another site; the offer and plan ride along so the claim can be checked. */
export function claimHref(href: string, id: string, plan: string) {
  const h = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&]*$/.test(href || "") ? href : "/billing";
  const u = new URL(h, "https://x.invalid");
  u.searchParams.set("campaign", id);
  u.searchParams.set("plan", plan);
  if (u.pathname === "/billing" || u.pathname.startsWith("/billing/")) u.hash = "plans";
  return `${u.pathname}${u.search}${u.hash}`;
}

/** Where the popup must never appear: paying, signing in, billing settings, the first-run flow. */
export const QUIET_PATHS = [/^\/billing(\/|$)/, /^\/checkout/, /^\/settings\/?(billing|payments|security)/, /^\/(login|signup|register|auth|app-auth|verify|reset|forgot|2fa|onboarding|welcome)(\/|$)/];
export const quietPath = (path: string, hash = "") => QUIET_PATHS.some((r) => r.test(path)) || (/^\/settings/.test(path) && /^#(billing|plan|payments)/.test(hash));

/** sessionStorage key: one try per fresh app entry (a new tab, a cold PWA launch). */
export const PROMO_SESSION_KEY = "outlly:promo-tried";

/** Time left, for the sheet ("Ends in 2 days", "Ends today"). */
export function endsIn(endsAt: Date, now: Date = new Date()) {
  const ms = endsAt.getTime() - now.getTime();
  if (ms <= 0) return "Ended";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "Ends in under an hour";
  if (h < 24) return `Ends in ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  return `Ends in ${d} day${d === 1 ? "" : "s"}`;
}

/** Per-campaign funnel for the admin table. */
export function funnel(counts: Partial<Record<CampaignEventKind, number>>) {
  const imp = counts.impression ?? 0, click = counts.click ?? 0, conv = counts.conversion ?? 0;
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  return { impressions: imp, dismissals: counts.dismiss ?? 0, clicks: click, conversions: conv, ctr: pct(click, imp), cvr: pct(conv, click) };
}

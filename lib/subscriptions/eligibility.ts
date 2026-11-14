import "server-only";
import type { Plan } from "@prisma/client";
import { db } from "../db";
import { HttpError } from "../http";
import { getConfig } from "../settings";
import { buyerPrice } from "../billing/buyer-price";
import { normalizeDisplay } from "../billing/display";
import { hasYearly, type Cycle } from "../billing/cycle";
import { formatMoney, type Currency } from "../billing/money";
import { GIFT_PROVIDERS } from "../billing/access-core";
import { getEconomics, getPolicy, type SubsPolicy } from "./policy";
import { floorMinor, marginFor, typicalCostInrMinor, yearlyFromMonthly } from "./economics";
import { ledgerKeysForUser } from "./keys";

/**
 * 1147: the one place that decides what a person pays for a plan. Checkout, the billing page and the public
 * pricing section all read it, so nobody ever sees one price and pays another. Never trusts the client.
 */
export type PriceTier = "intro" | "standard" | "legacy" | "founding";
export type QuoteReason = "first_time" | "returning" | "legacy" | "founding" | "policy_off" | "risk_denied" | "needs_verification";

export interface Quote {
  planSlug: string;
  planName: string;
  tier: PriceTier;
  reason: QuoteReason;
  /** What checkout charges now, minor units of `currency`, for one `interval`. */
  priceMinor: number;
  currency: Currency;
  interval: Cycle;
  /** The first-time price for this plan/currency/cycle, null when there is none. */
  introMinor: number | null;
  /** The returning price (the plan's live price). */
  standardMinor: number;
  /** What it renews at while renewals stay continuous (prices are snapshotted on the subscription). */
  renewMinor: number;
  floorMinor: number;
  /** Margin for a typical user at priceMinor (0..1). */
  marginTypical: number;
  graceDays: number;
  policyVersion: string | null;
  label: string;
  detail: string;
}

const per = (i: Cycle) => (i === "year" ? " a year" : " a month");
const DAY = 86_400_000;

/**
 * The paid subscription this person is continuing, if any: live, paused, or ended less than `graceDays` ago,
 * and never refunded. A lapse (none found) means any new subscription is "standard".
 */
export async function continuingSubscription(userId: string, graceDays: number, now = new Date()) {
  const subs = await db.subscription.findMany({
    where: { userId, sample: false, priceMinor: { gt: 0 }, provider: { notIn: [...GIFT_PROVIDERS] }, OR: [{ status: { in: ["active", "past_due"] } }, { status: "canceled", cancelAtPeriodEnd: true }] },
    include: { payments: { select: { status: true } } },
    orderBy: { currentPeriodEnd: "desc" },
    take: 10,
  });
  for (const s of subs) {
    if (s.payments.some((p) => p.status === "refunded")) continue;
    const end = Math.max(s.currentPeriodEnd.getTime(), s.pausedUntil?.getTime() ?? 0);
    if (end + graceDays * DAY >= now.getTime()) return s;
  }
  return null;
}

/** Has this person (any of their keys, or this account) paid for a plan before? Refunded payments count: the offer was used. */
export async function hasPaidBefore(userId: string, extra: { deviceId?: string | null } = {}) {
  const keys = await ledgerKeysForUser(userId, extra);
  if (keys.length && (await db.offerLedger.findFirst({ where: { firstPaidAt: { not: null }, OR: keys.map((k) => ({ kind: k.kind, keyHash: k.keyHash })) }, select: { id: true } }))) return true;
  return (await db.payment.count({ where: { userId, sample: false, status: { in: ["succeeded", "refunded"] }, purpose: { in: ["plan", "renewal"] } } })) > 0;
}

export async function openRiskAction(userId: string): Promise<"deny_offer" | "verify" | null> {
  const flags = await db.riskFlag.findMany({ where: { userId, OR: [{ status: { in: ["open", "confirmed"] }, action: "deny_offer" }, { status: "open", action: "verify" }] }, select: { action: true } });
  if (flags.some((f) => f.action === "deny_offer")) return "deny_offer";
  return flags.length ? "verify" : null;
}

const introFor = (policy: SubsPolicy, slug: string, currency: Currency) => {
  const v = policy.intro[slug]?.[currency];
  return typeof v === "number" && v > 0 ? v : null;
};

export interface QuoteInput {
  userId: string;
  planSlug: string;
  currency?: Currency;
  interval?: Cycle;
  /** The gateway checkout will use (decides the charge currency). Default: the active gateway. */
  provider?: string;
  deviceId?: string | null;
  now?: Date;
}

/** quote() plus the steps behind it, for checkout (the price test and founding figures it records). */
export async function quoteDetailed(o: QuoteInput) {
  const now = o.now ?? new Date();
  const plan: Plan | null = await db.plan.findUnique({ where: { slug: o.planSlug } });
  if (!plan) throw new HttpError(404, "That plan isn't available right now.", "PLAN_UNAVAILABLE");
  const display = normalizeDisplay(await getConfig("pricing"));
  const want: Cycle = o.interval === "year" && (plan.interval === "year" || hasYearly(plan, display.yearly)) ? "year" : plan.interval === "year" ? "year" : "month";
  const provider = o.provider ?? (await import("../billing/service").then((m) => m.activeGateway())).provider;
  const [policy, econ] = await Promise.all([getPolicy(), getEconomics()]);
  const base = await buyerPrice(o.userId, plan, provider, o.currency, want, display.freeMonths);
  const currency = base.tested.currency;
  const interval = base.tested.interval;
  const floor = floorMinor({ plan: plan.slug, currency, interval, econ, target: policy.targetMargin });
  const cost = typicalCostInrMinor(plan.slug, econ);
  const margin = (priceMinor: number) => (priceMinor > 0 ? marginFor({ priceMinor, currency, interval, costMinorInr: cost, econ }).margin : 0);
  // With the policy on, no standard price (monthly, yearly or a price test) is ever under its floor.
  const standard = policy.enabled && plan.priceMinor > 0 ? Math.max(base.tested.priceMinor, floor) : base.tested.priceMinor;
  const introMonthly = introFor(policy, plan.slug, currency);
  const intro = introMonthly == null || plan.priceMinor <= 0 ? null : Math.min(standard, interval === "year" ? yearlyFromMonthly({ plan: plan.slug, currency, monthlyMinor: introMonthly, econ, target: policy.targetMargin }) : introMonthly);
  const fmt = (m: number) => formatMoney(m, currency);
  const make = (tier: PriceTier, reason: QuoteReason, priceMinor: number, label: string, detail: string): Quote => ({
    planSlug: plan.slug, planName: plan.name, tier, reason, priceMinor, currency, interval, introMinor: intro, standardMinor: standard, renewMinor: priceMinor,
    floorMinor: floor, marginTypical: margin(priceMinor), graceDays: policy.graceDays, policyVersion: policy.enabled ? policy.version : null, label, detail,
  });
  const done = (quote: Quote) => ({ quote, base, plan, policy });

  if (!policy.enabled) return done({ ...make("legacy", "policy_off", base.foundingMinor, "", ""), standardMinor: base.tested.priceMinor });
  if (base.fpct) return done(make("founding", "founding", base.foundingMinor, "Founding member price", `Your ${base.fpct}% founding discount stays for life.`));

  const introLine = (p: number) => `${fmt(p)}${per(interval)} for as long as you keep renewing. If your plan lapses for more than ${policy.graceDays} days, it returns at ${fmt(standard)}${per(interval)}.`;
  const cont = await continuingSubscription(o.userId, policy.graceDays, now);
  if (cont?.priceTier === "legacy") return done(make("legacy", "legacy", base.tested.priceMinor, "Your current price", "You keep the pricing you joined with while your plan continues."));
  if (cont?.priceTier === "founding") return done(make("founding", "founding", base.foundingMinor, "Founding member price", "Your founding discount stays for life."));
  if (cont?.priceTier === "intro" && intro != null) return done(make("intro", "first_time", intro, "First-time subscriber offer", introLine(intro)));
  if (cont?.priceTier === "standard") return done(make("standard", "returning", standard, "Returning subscriber price", "You've subscribed before, so this is the regular price."));

  const risk = await openRiskAction(o.userId);
  if (risk === "deny_offer") return done(make("standard", "risk_denied", standard, "Standard price", "The first-time offer isn't available on this account. If that looks wrong, ask for a review."));
  if (await hasPaidBefore(o.userId, { deviceId: o.deviceId })) {
    const lapsed = await db.subscription.count({ where: { userId: o.userId, sample: false, priceMinor: { gt: 0 }, provider: { notIn: [...GIFT_PROVIDERS] } } });
    return done(make("standard", "returning", standard, "Returning subscriber price", lapsed ? `Your earlier plan ended more than ${policy.graceDays} days ago, so the first-time offer no longer applies.` : "The first-time offer has already been used for this account."));
  }
  if (risk === "verify") return done(make("standard", "needs_verification", standard, "Verify to get the first-time offer", `Confirm your phone number to get ${intro != null ? fmt(intro) + per(interval) : "the first-time price"}, or subscribe now at ${fmt(standard)}${per(interval)}.`));
  if (intro == null || intro >= standard) return done(make("standard", "first_time", standard, "Standard price", `${fmt(standard)}${per(interval)}.`));
  return done(make("intro", "first_time", intro, "First-time subscriber offer", introLine(intro)));
}

export async function quote(o: QuoteInput): Promise<Quote> {
  return (await quoteDetailed(o)).quote;
}

/**
 * 1147: the words for first-time / returning pricing, the trial, the monthly allowance and the checkout summary.
 * Client-safe and pure, so the billing page, the cards and the marketing pricing all say the same thing.
 * Numbers come from the server's quote; nothing here decides a price.
 */
import { formatMoney, intervalLabel } from "@/lib/billing/money";

export type OfferReason = "first_time" | "returning" | "legacy" | "founding" | "policy_off" | "risk_denied" | "needs_verification";
export type OfferTier = "intro" | "standard" | "legacy" | "founding";

export type QuoteView = {
  tier: OfferTier;
  reason: OfferReason;
  priceMinor: number;
  currency: string;
  interval: string;
  introMinor: number | null;
  standardMinor: number;
  /** What it renews at while renewals stay continuous; defaults to priceMinor. */
  renewMinor?: number;
  /** The server's own words for this quote; preferred over the defaults below when present. */
  label?: string;
  detail?: string;
};

export type TrialStatus = "none" | "active" | "converted" | "expired" | "canceled";
export type TrialBlock = "used" | "risk_denied" | "needs_verification" | "disabled" | "already_paid" | null;
export type TrialView = {
  status: TrialStatus;
  planName: string;
  days: number;
  endsAt: string | null;
  /** Why a trial can't start now; null when it can (or one is running). */
  block: TrialBlock;
};

export type BudgetView = { mode: "off" | "alert" | "enforce"; budgetMinor: number; spentMinor: number; pct: number; blocked: boolean; resetsAt: string; warn?: boolean; applies?: boolean };

/** The appeal form on Billing, and the WhatsApp verify card in Settings. */
export const REVIEW_HREF = "/billing?review=1#offer-review";
export const VERIFY_HREF = "/settings#ph-h";

const DAY = 86_400_000;
const per = (minor: number, currency: string, interval: string) => `${formatMoney(minor, currency)}${intervalLabel(interval)}`;
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Whole days left, counting a part day as a day, never below zero. */
export function daysLeft(endsAt: string | Date, now: Date = new Date()): number {
  const end = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY));
}

/** The line a plan card shows under its price. null = nothing to say (policy off, founding, legacy). */
export function offerLine(q: QuoteView | null | undefined, graceDays: number): { badge: string; text: string } | null {
  if (!q || q.reason === "policy_off" || q.reason === "founding" || q.reason === "legacy") return null;
  if (q.label && q.detail) return { badge: q.label, text: q.detail };
  if (q.tier === "intro") {
    const same = q.introMinor == null || q.standardMinor <= q.introMinor;
    return {
      badge: "First-time subscriber offer",
      text: same
        ? `${per(q.priceMinor, q.currency, q.interval)} for as long as you renew on time.`
        : `${per(q.priceMinor, q.currency, q.interval)} for as long as you renew on time. If your plan lapses for more than ${graceDays} days, it becomes ${per(q.standardMinor, q.currency, q.interval)}.`,
    };
  }
  return { badge: "Returning subscriber price", text: returningReason(q.reason) };
}

export function returningReason(reason: OfferReason): string {
  if (reason === "needs_verification") return "Verify your WhatsApp number to see if the first-time offer applies to you.";
  if (reason === "risk_denied") return "The first-time offer isn't available on this account. You can ask for a review.";
  return "You've subscribed before, so the first-time offer has been used.";
}

/** The price tier in words; null for a payment from before the policy (nothing new to say). */
export function tierLabel(tier: string | null | undefined): string | null {
  if (tier === "intro") return "First-time subscriber offer";
  if (tier === "standard") return "Returning subscriber price";
  if (tier === "founding") return "Founding member price";
  return null;
}

export type CheckoutSummary = { amount: string; tier: string; renewal: string; note: string | null };

/** What the summary says before any payment window opens: the exact amount, the tier and the renewal price. */
export function checkoutSummary(q: QuoteView, planName: string, graceDays: number): CheckoutSummary {
  const amount = formatMoney(q.priceMinor, q.currency);
  const period = q.interval === "year" ? "1 year" : "1 month";
  const tier = tierLabel(q.tier) ?? "Your current price";
  const renewsAt = q.renewMinor ?? (q.tier === "standard" ? q.standardMinor : q.priceMinor);
  const renewal = `${per(renewsAt, q.currency, q.interval)} each time you renew on time.`;
  const note = q.tier === "intro" && q.introMinor != null && q.standardMinor > q.introMinor
    ? `A gap of more than ${graceDays} days ends the offer; after that ${planName} is ${per(q.standardMinor, q.currency, q.interval)}.`
    : q.tier === "standard" && q.reason !== "returning"
      ? returningReason(q.reason)
      : null;
  return { amount: `${amount} for ${period}`, tier, renewal, note };
}

/** The marketing card's line under a first-time price: what returning subscribers pay. */
export function introThen(standardMinor: number, currency: string, interval: string, graceDays: number): string {
  return `Then ${per(standardMinor, currency, interval)} only if your plan lapses for more than ${graceDays} days.`;
}

/** null = no trial card at all. */
export function trialCopy(t: TrialView | null | undefined, now: Date = new Date()): { title: string; body: string; action: "start" | "cancel" | "verify" | "review" | null } | null {
  if (!t || t.days <= 0) return null;
  if (t.status === "active" && t.endsAt) {
    const left = daysLeft(t.endsAt, now);
    return {
      title: left <= 0 ? `Your ${t.planName} trial ends today` : `${left} day${left === 1 ? "" : "s"} left in your ${t.planName} trial`,
      body: `It ends on ${dateLabel(t.endsAt)} and you move back to Free. Nothing is charged. Subscribe any time to keep ${t.planName}.`,
      action: "cancel",
    };
  }
  if (t.status !== "none") return null;
  if (t.block === "needs_verification") return { title: `Try ${t.planName} free for ${t.days} days`, body: "Verify your WhatsApp number first. It keeps free trials to one per person.", action: "verify" };
  if (t.block === "risk_denied") return { title: "Free trial not available", body: "This account can't start a free trial. If that looks wrong, ask for a review and a person will check it.", action: "review" };
  if (t.block) return null;
  return { title: `Try ${t.planName} free for ${t.days} days`, body: `No card needed. When the trial ends you move back to Free unless you subscribe. One trial per person.`, action: "start" };
}

/** The allowance meter. null when it doesn't apply (mode off, Free plan, founding or legacy price). */
export function budgetCopy(b: BudgetView | null | undefined): { pct: number; tone: "ok" | "warn" | "bad"; title: string; body: string } | null {
  if (!b || b.applies === false || b.mode === "off" || b.budgetMinor <= 0) return null;
  const pct = Math.max(0, Math.min(100, Math.round(b.pct)));
  const resets = dateLabel(b.resetsAt);
  const safe = "Scheduling, publishing, the calendar, the inbox and analytics always keep working.";
  if (b.blocked && b.mode === "enforce") {
    return { pct: 100, tone: "bad", title: "This month's AI allowance is used up", body: `AI writing, captioned videos and posts to X are paused until ${resets}, or add a top-up to carry on now. ${safe}` };
  }
  if (b.warn ?? pct >= 80) {
    return { pct, tone: "warn", title: `${pct}% of this month's AI allowance used`, body: `${b.mode === "enforce" ? "When it runs out, AI writing, captioned videos and posts to X pause" : "Heavy use past it may be limited later"} until ${resets}. A top-up adds more. ${safe}` };
  }
  return { pct, tone: "ok", title: `${pct}% of this month's AI allowance used`, body: `It covers AI writing, captioned videos and posts to X, and resets on ${resets}.` };
}

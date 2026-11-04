import "server-only";
import type { Campaign, Plan } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./http";
import { getConfig } from "./settings";
import { normalizeDisplay } from "./billing/display";
import { hasYearly, type Cycle } from "./billing/cycle";
import type { Currency } from "./billing/money";
import { isGiftProvider, isPaidSub } from "./billing/access-core";
import { buyerPrice } from "./billing/buyer-price";
import { adminEvent } from "./admin/route";
import { bestOffer, claimHref, eligible, endsIn, funnel, isLive, liveState, offerLabel, parseBanner, savingLabel, parseSlugs, type CampaignEventKind, type Who } from "./campaign-core";

/** How long a checkout attempt holds an offer spot (the same window startCheckout reuses a pending payment in). */
export const OFFER_HOLD_MS = 20 * 60_000;

/** Who this person is, for the eligibility rules. */
export async function campaignWho(userId: string, now = new Date()): Promise<Who & { onPlans: Set<string>; converted: Set<string> }> {
  const [user, subs, paidOnce, used] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { createdAt: true } }),
    db.subscription.findMany({ where: { userId, status: { in: ["active", "past_due"] }, currentPeriodEnd: { gt: now } }, include: { plan: { select: { slug: true } } } }),
    db.payment.findFirst({ where: { userId, status: "succeeded", planId: { not: null }, purpose: { not: "topup" } }, select: { id: true } }),
    db.campaignEvent.findMany({ where: { userId, kind: "conversion" }, select: { campaignId: true } }),
  ]);
  const paid = subs.filter((s) => isPaidSub(s) && !isGiftProvider(s.provider));
  // onPlans is plan + cycle ("pro:month"): a monthly Pro member can still take an offer on Pro yearly, like checkout allows.
  // converted: offers this person already paid with (one redemption per person per offer).
  return { paying: paid.length > 0, everPaid: !!paidOnce, joinedAt: user.createdAt, onPlans: new Set(paid.map((s) => `${s.plan.slug}:${s.interval === "year" ? "year" : "month"}`)), converted: new Set(used.map((e) => e.campaignId)) };
}

export interface OfferQuote {
  campaign: Campaign;
  plan: Plan;
  cycle: Cycle;
  currency: string;
  /** The price they'd really pay today without the offer (list, price test or founding, the lowest): the struck-through number. */
  originalMinor: number;
  /** The list (or price-test) price the offer is taken off; the invoice starts from this. */
  listMinor: number;
  /** The price checkout will charge with the offer. */
  finalMinor: number;
  /** What renewals cost afterwards (founding price if they have one, else the regular price). */
  renewMinor: number;
}

/**
 * The offer price for one plan + cycle, or null when this offer doesn't apply to this person right now (ended, off,
 * sold out, not their group, not this plan, already on it, other currency, or founding already beats it).
 */
export async function quoteOffer(userId: string, c: Campaign, plan: Plan, cycle: Cycle, provider: string, wanted: Currency | undefined, who?: Awaited<ReturnType<typeof campaignWho>>, now = new Date()): Promise<OfferQuote | null> {
  if (!isLive(c, now)) return null;
  if (!parseSlugs(c.planSlugs).includes(plan.slug) || plan.state !== "available" || plan.priceMinor <= 0) return null;
  const w = who ?? (await campaignWho(userId, now));
  if (!eligible(c.eligibility, w, now) || w.converted.has(c.id)) return null;
  const display = normalizeDisplay(await getConfig("pricing"));
  const want: Cycle = plan.interval === "year" ? "year" : cycle === "year" && hasYearly(plan, display.yearly) ? "year" : "month";
  if (w.onPlans.has(`${plan.slug}:${want}`)) return null;
  const bp = await buyerPrice(userId, plan, provider, wanted, want, display.freeMonths);
  const finalMinor = bestOffer(c, bp.tested.priceMinor, bp.foundingMinor, bp.tested.currency);
  if (finalMinor === null) return null;
  // A founding member's real price is their founding price, so that is the honest "was" (bestOffer already beats it).
  return { campaign: c, plan, cycle: want, currency: bp.tested.currency, originalMinor: Math.min(bp.tested.priceMinor, bp.foundingMinor), listMinor: bp.tested.priceMinor, finalMinor, renewMinor: bp.foundingMinor };
}

const liveWhere = (now: Date) => ({ active: true, startsAt: { lte: now }, endsAt: { gt: now } });

/** The popup's offer: the first live campaign (ending soonest) that gives this person a real saving on its lead plan. */
export async function activeOffer(userId: string, provider: string, wanted: Currency | undefined, now = new Date()) {
  const list = await db.campaign.findMany({ where: liveWhere(now), orderBy: { endsAt: "asc" }, take: 10 });
  if (!list.length) return null;
  const who = await campaignWho(userId, now);
  for (const c of list) {
    const slugs = parseSlugs(c.planSlugs);
    const plans = await db.plan.findMany({ where: { slug: { in: slugs } } });
    for (const slug of slugs) {
      const plan = plans.find((p) => p.slug === slug);
      if (!plan) continue;
      const q = await quoteOffer(userId, c, plan, plan.interval === "year" ? "year" : "month", provider, wanted, who, now);
      if (q) return offerView(q, now);
    }
  }
  return null;
}

export function offerView(q: OfferQuote, now = new Date()) {
  const c = q.campaign;
  const b = parseBanner(c.banner);
  return {
    id: c.id,
    title: c.title,
    label: savingLabel(c, q),
    badge: b.badge || "Limited offer",
    headline: b.headline || c.title,
    body: b.body,
    benefits: b.benefits,
    terms: b.terms,
    ctaText: c.ctaText || "Claim Offer Now",
    href: claimHref(c.ctaHref, c.id, q.plan.slug),
    endsAt: c.endsAt.toISOString(),
    endsLabel: endsIn(c.endsAt, now),
    plan: { slug: q.plan.slug, name: q.plan.name },
    cycle: q.cycle,
    currency: q.currency,
    originalMinor: q.originalMinor,
    finalMinor: q.finalMinor,
    renewMinor: q.renewMinor,
    left: c.maxRedemptions > 0 ? Math.max(0, c.maxRedemptions - c.redemptions) : null,
  };
}
export type OfferView = ReturnType<typeof offerView>;

/** Checkout with an offer: it must still be valid for this person and plan, or checkout stops (never a surprise price). */
export async function checkoutOffer(userId: string, campaignId: string, plan: Plan, cycle: Cycle, provider: string, wanted: Currency | undefined) {
  const c = await db.campaign.findUnique({ where: { id: campaignId } });
  const q = c ? await quoteOffer(userId, c, plan, cycle, provider, wanted) : null;
  if (!q) throw new HttpError(409, "That offer has ended or doesn't apply to this plan. The regular price is on the card.", "OFFER_UNAVAILABLE");
  // A capped offer: checkouts other people have open right now hold a spot each, so 50 people can't all pay for the last one.
  if (q.campaign.maxRedemptions > 0) {
    const holding = await db.payment.count({ where: { status: "pending", userId: { not: userId }, createdAt: { gt: new Date(Date.now() - OFFER_HOLD_MS) }, meta: { contains: campaignTag(q.campaign.id) } } });
    if (q.campaign.redemptions + holding >= q.campaign.maxRedemptions) throw new HttpError(409, "That offer just sold out. The regular price is on the card.", "OFFER_UNAVAILABLE");
  }
  return q;
}

const today = (d = new Date()) => d.toISOString().slice(0, 10);

/** One impression / dismissal / click per person, per offer, per day: the counts are people, not page loads. */
export async function recordCampaignEvent(campaignId: string, userId: string, kind: Exclude<CampaignEventKind, "conversion">) {
  const c = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!c || !isLive(c)) return false; // only an offer that is actually showing can be seen, closed or clicked
  const day = today();
  const seen = await db.campaignEvent.findFirst({ where: { campaignId, userId, kind, day }, select: { id: true } });
  if (seen) return false;
  try {
    await db.campaignEvent.create({ data: { campaignId, userId, kind, day } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return false; // two tabs at once: the unique index keeps one
    throw e;
  }
  return true;
}

/**
 * A confirmed payment that used an offer: one conversion, one redemption. Never throws (the money is in).
 * Sample (test) payments count nothing. The money is already captured when this runs, so the price is honoured
 * even if the offer ended or sold out meanwhile (a gateway order paid late); the admin gets told when that happens.
 */
export async function convertCampaign(p: { id: string; userId: string; meta: string | null; sample: boolean }, now = new Date()) {
  try {
    const id = campaignIdOf(p.meta);
    if (!id || p.sample) return;
    if (await db.campaignEvent.findFirst({ where: { paymentId: p.id, kind: "conversion" }, select: { id: true } })) return;
    // A conversion's day carries its payment id: one row per payment, so two offer payments on one day both count
    // (the unique index is there for the once-a-day impression / dismissal / click rule).
    const [, c] = await db.$transaction([
      db.campaignEvent.create({ data: { campaignId: id, userId: p.userId, kind: "conversion", day: `${today(now)}#${p.id}`, paymentId: p.id } }),
      db.campaign.update({ where: { id }, data: { redemptions: { increment: 1 } } }),
    ]).catch((e) => {
      if ((e as { code?: string }).code === "P2002") return [null, null] as const; // a racing repeat for this payment already counted it
      throw e;
    });
    if (!c) return;
    // Late = paid after the offer's end as it stood at checkout (meta.campaign.until), or its end now if that's older meta.
    const until = untilOf(p.meta) ?? c.endsAt;
    const late = now.getTime() > until.getTime();
    const over = c.maxRedemptions > 0 && c.redemptions > c.maxRedemptions;
    if (late || over) await adminEvent("campaign", `Offer "${c.title}" was paid ${late ? "after it ended" : "past its limit"}`, `${c.redemptions}${c.maxRedemptions ? ` of ${c.maxRedemptions}` : ""} redeemed. The buyer had already paid, so the offer price stands.`, "/admin/campaigns");
  } catch (e) {
    console.error("[campaign] conversion", p.id, e);
  }
}

/** A refunded offer payment: its conversion and its redemption come back off (the spot is free again). Never throws. */
export async function releaseCampaign(paymentId: string) {
  try {
    const ev = await db.campaignEvent.findFirst({ where: { paymentId, kind: "conversion" }, select: { id: true, campaignId: true } });
    if (!ev) return;
    await db.$transaction([
      db.campaignEvent.delete({ where: { id: ev.id } }),
      db.campaign.updateMany({ where: { id: ev.campaignId, redemptions: { gt: 0 } }, data: { redemptions: { decrement: 1 } } }),
    ]);
  } catch (e) {
    console.error("[campaign] release", paymentId, e);
  }
}

/** The exact text priceMeta writes for an offer, so pending checkouts holding a spot can be counted. */
export const campaignTag = (id: string) => `"campaign":{"id":${JSON.stringify(id)}`;

/** The offer's end as it was when checkout started (meta.campaign.until), or null. */
export function untilOf(meta: string | null | undefined): Date | null {
  try {
    const u = JSON.parse(meta || "null")?.campaign?.until;
    const d = typeof u === "string" ? new Date(u) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

/** Payment.meta written by startCheckout: { price, campaign?: { id, until }, renewMinor? }. */
export function campaignIdOf(meta: string | null | undefined): string | null {
  try {
    const m = JSON.parse(meta || "null");
    return typeof m?.campaign?.id === "string" ? m.campaign.id : null;
  } catch {
    return null;
  }
}

/** Per-campaign counts for the admin table. */
export async function campaignStats(ids: string[]) {
  if (!ids.length) return {} as Record<string, Partial<Record<CampaignEventKind, number>>>;
  const rows = await db.campaignEvent.groupBy({ by: ["campaignId", "kind"], where: { campaignId: { in: ids } }, _count: { _all: true } });
  const out: Record<string, Partial<Record<CampaignEventKind, number>>> = {};
  for (const r of rows) (out[r.campaignId] ??= {})[r.kind as CampaignEventKind] = r._count._all;
  return out;
}

/** Admin > Offers: every campaign with its live state and funnel, newest first, plus the plans an offer can use. */
export async function campaignsState(now = new Date()) {
  const [list, plans] = await Promise.all([
    db.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.plan.findMany({ where: { priceMinor: { gt: 0 } }, orderBy: { sortOrder: "asc" }, select: { slug: true, name: true, priceMinor: true, currency: true, state: true } }),
  ]);
  const stats = await campaignStats(list.map((c) => c.id));
  return {
    plans,
    campaigns: list.map((c) => ({
      id: c.id, title: c.title, kind: c.kind, value: c.value, currency: c.currency, planSlugs: parseSlugs(c.planSlugs),
      startsAt: c.startsAt.toISOString(), endsAt: c.endsAt.toISOString(), banner: parseBanner(c.banner), ctaText: c.ctaText, ctaHref: c.ctaHref,
      eligibility: c.eligibility, active: c.active, maxRedemptions: c.maxRedemptions, redemptions: c.redemptions,
      state: liveState(c, now), label: offerLabel(c), funnel: funnel(stats[c.id] ?? {}), createdAt: c.createdAt.toISOString(),
    })),
  };
}
export type CampaignsState = Awaited<ReturnType<typeof campaignsState>>;
export type CampaignRow = CampaignsState["campaigns"][number];

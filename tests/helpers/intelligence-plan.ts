import { db } from "../../lib/db";

/**
 * R1334: the Personal Intelligence engine is a plan perk, so a test owner who is meant to have profiles, forecasts or
 * personal recommendations needs a paid plan that lists it. One hidden plan per test process, one active
 * subscription per owner. `withoutIntelligence` gives a paid plan that does NOT list the perk (plan-without-perk).
 */
const DAY = 864e5;
let plans: { with: string | null; without: string | null } = { with: null, without: null };

async function planId(perk: boolean) {
  const key = perk ? "with" : "without";
  if (plans[key]) return plans[key]!;
  const perks = perk ? '["weekly-digest","personal-intelligence"]' : '["weekly-digest"]';
  const p = await db.plan.create({ data: { slug: `t-intel-${perk ? "on" : "off"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: perk ? "Test Intelligence" : "Test Paid (no engine)", priceMinor: 100, state: "hidden", perks } });
  plans[key] = p.id;
  return p.id;
}

export async function withIntelligence<T extends { id: string }>(u: T): Promise<T> {
  await db.subscription.create({ data: { userId: u.id, planId: await planId(true), status: "active", priceMinor: 100, currency: "INR", interval: "month", provider: "mock", currentPeriodEnd: new Date(Date.now() + 30 * DAY), autoRenew: false } });
  return u;
}

export async function withoutIntelligence<T extends { id: string }>(u: T): Promise<T> {
  await db.subscription.create({ data: { userId: u.id, planId: await planId(false), status: "active", priceMinor: 100, currency: "INR", interval: "month", provider: "mock", currentPeriodEnd: new Date(Date.now() + 30 * DAY), autoRenew: false } });
  return u;
}

/** End the owner's paid access now (a downgrade): the subscription is canceled and its period is over. */
export async function downgrade(userId: string) {
  await db.subscription.updateMany({ where: { userId }, data: { status: "canceled", canceledAt: new Date(), currentPeriodEnd: new Date(Date.now() - DAY) } });
}

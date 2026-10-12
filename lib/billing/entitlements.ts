import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { ensurePlans } from "./plans";

export interface Entitlements {
  planSlug: string;
  planName: string;
  postLimit: number; // per calendar month (UTC); 0 = unlimited
  aiCaptions: boolean;
  seats: number;
}

/** What this account's plan allows: its active subscription's plan, else the Free plan, else no limits. */
export async function entitlements(userId: string): Promise<Entitlements> {
  const sub = await db.subscription.findFirst({ where: { userId, status: "active", currentPeriodEnd: { gt: new Date() } }, include: { plan: true }, orderBy: { createdAt: "desc" } });
  let plan = sub?.plan ?? null;
  if (!plan) {
    await ensurePlans();
    plan = await db.plan.findUnique({ where: { slug: "free" } });
  }
  if (!plan) return { planSlug: "free", planName: "Free", postLimit: 0, aiCaptions: true, seats: 0 };
  return { planSlug: plan.slug, planName: plan.name, postLimit: plan.postLimit, aiCaptions: plan.aiCaptions, seats: plan.seats };
}

export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Posts launched (published or scheduled) this month and what's left. Drafts are free. `left` is Infinity on unlimited plans. */
export async function postUsage(userId: string, now = new Date()) {
  const e = await entitlements(userId);
  const used = await db.post.count({ where: { userId, status: { not: "draft" }, createdAt: { gte: monthStart(now) } } });
  return { ...e, used, left: e.postLimit > 0 ? Math.max(0, e.postLimit - used) : Infinity };
}

/** Pure check, unit-tested: throws the upgrade message when the month's posts are used up. */
export function checkPostLimit(e: Pick<Entitlements, "postLimit" | "planName">, used: number) {
  if (e.postLimit > 0 && used >= e.postLimit)
    throw new HttpError(402, `You've used all ${e.postLimit} posts on ${e.planName} this month. Upgrade in Billing for more, or wait until the 1st.`, "PLAN_LIMIT");
}

export async function assertCanPost(userId: string) {
  const u = await postUsage(userId);
  checkPostLimit(u, u.used);
  return u;
}

export async function assertAiCaptions(userId: string) {
  const e = await entitlements(userId);
  if (!e.aiCaptions) throw new HttpError(402, `AI captions aren't part of ${e.planName}. Upgrade in Billing, or type your captions yourself.`, "PLAN_LIMIT");
  return e;
}

/** Seats: invited + active members must stay within the owner's plan. */
export function checkSeats(e: Pick<Entitlements, "seats" | "planName">, taken: number) {
  if (taken >= e.seats)
    throw new HttpError(402, e.seats === 0 ? `${e.planName} doesn't include team seats. Upgrade in Billing to invite people.` : `${e.planName} includes ${e.seats} seat${e.seats === 1 ? "" : "s"} and they're all taken. Remove someone or upgrade.`, "PLAN_LIMIT");
}

import "server-only";
import { db } from "./db";
import { env } from "./env";
import { HttpError } from "./http";
import { entitlements } from "./billing/entitlements";
import { noticeUsageLimit } from "./notify-events";
import { assertBudget, recordCost } from "./subscriptions/costs";
import type { CostCategory } from "./subscriptions/economics";
import type { AiFeature } from "./ai/features";
import { activeAiGrant, countFeatureUse, liveAiGrant } from "./ai/entitlements";

/**
 * Per-person caps on model calls. Gemini costs money, so one account (or one loop in a script) can't run up
 * the bill. The counter is a single row per person per UTC day per kind, incremented by an upsert, so it holds
 * across instances without Redis.
 *
 * 1112: "ai" calls follow the plan. `aiDaily` replaces the server default (AI_DAILY_LIMIT) when set, and
 * `aiMonthly` caps the calendar month (the sum of that month's day rows). Support chat keeps its own daily cap.
 *
 * A limit of 0 means no cap. Anonymous callers are not counted (no User row to hang the count on);
 * the IP rate limit in lib/http.ts covers them.
 *
 * Phase 3: every "ai" call names its feature (lib/ai/features.ts) and is counted in AiFeatureUsage. An admin
 * grant (lib/ai/entitlements.ts) covering that feature skips the daily/monthly caps and the plan's cost budget
 * and spends no AiUsage, but the cost is still recorded. Route rate limits, size limits and auth still apply.
 * "support" (help chat and Pip) is not a product feature: it keeps its own daily abuse cap, no grant lifts it,
 * and it is not counted in AiFeatureUsage.
 */
export type AiKind = "ai" | "support";

export const QUOTA_MESSAGE = "You've used today's AI help. It resets at midnight UTC.";
export const monthMessage = (n: number, plan: string) => `${plan} includes ${n} AI requests a month and you've used them. Upgrade for more, or they reset on the 1st.`;

/** YYYY-MM-DD in UTC, the key the counter is bucketed by. */
export const utcDay = (now: Date = new Date()) => now.toISOString().slice(0, 10);
const utcMonth = (now: Date) => now.toISOString().slice(0, 8); // "YYYY-MM-", a prefix of every day key that month

async function limitsFor(userId: string, kind: AiKind, feature: AiFeature | "all" = "all", now: Date = new Date()) {
  if (kind === "support") return { day: env.AI_SUPPORT_DAILY_LIMIT, month: 0, plan: "", unlimited: false, expiresAt: null as Date | null };
  const [e, grant] = await Promise.all([entitlements(userId), activeAiGrant(userId, feature, now)]);
  if (grant) return { day: 0, month: 0, plan: e.planName, unlimited: true, expiresAt: grant.expiresAt };
  return { day: e.aiDaily > 0 ? e.aiDaily : env.AI_DAILY_LIMIT, month: Math.max(0, e.aiMonthly), plan: e.planName, unlimited: false, expiresAt: null as Date | null };
}

const monthUsed = async (userId: string, kind: AiKind, now: Date) =>
  (await db.aiUsage.aggregate({ where: { userId, kind, day: { startsWith: utcMonth(now) } }, _sum: { count: true } }))._sum.count ?? 0;

/** Count one call and refuse once a cap is reached. Call it BEFORE the model, not after. */
/** 1147: `meter` is what this call costs the subscriber's monthly budget (a no-op while the policy is off). */
export async function chargeAi(userId: string, kind: AiKind = "ai", now: Date = new Date(), meter: { category: CostCategory; units: number } | null = kind === "ai" ? { category: "ai", units: 1 } : null, feature: AiFeature = "other") {
  const lim = await limitsFor(userId, kind, feature, now);
  if (lim.unlimited) {
    await countFeatureUse(userId, feature, true, now);
    if (meter) await recordCost({ userId, ...meter, now });
    return { used: 0, limit: 0, left: Infinity, unlimited: true };
  }
  if (meter) await assertBudget(userId, meter.category, now);
  const counted = () => (kind === "ai" ? countFeatureUse(userId, feature, false, now) : Promise.resolve());
  if (!lim.day && !lim.month) {
    await counted();
    return { used: 0, limit: 0, left: Infinity, unlimited: false };
  }
  const day = utcDay(now);
  const row = await db.aiUsage.upsert({
    where: { userId_day_kind: { userId, day, kind } },
    create: { userId, day, kind, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  // Give a refused call back, so the day rows (and the month total built from them) only count calls that ran.
  // Without this, clicks refused by the daily cap would quietly eat the plan's monthly allowance.
  const giveBack = () => db.aiUsage.update({ where: { userId_day_kind: { userId, day, kind } }, data: { count: { decrement: 1 } } }).catch(() => {});
  if (lim.day && row.count > lim.day) {
    await giveBack();
    throw new HttpError(429, QUOTA_MESSAGE, "AI_QUOTA");
  }
  if (lim.month) {
    const used = await monthUsed(userId, kind, now);
    if (used > lim.month) {
      await giveBack();
      await noticeUsageLimit(userId, lim.month, now); // 1118: once a month, never throws
      throw new HttpError(402, monthMessage(lim.month, lim.plan), "PLAN_LIMIT", { feature: "ai", upgrade: "/billing" });
    }
  }
  await counted();
  if (meter) await recordCost({ userId, ...meter, now });
  return { used: row.count, limit: lim.day, left: lim.day ? Math.max(0, lim.day - row.count) : Infinity, unlimited: false };
}

/**
 * Gives back the allowance a chargeAi call took when the model then sent nothing usable, so a failed call
 * doesn't use the creator's quota. Pass the same `now` and what chargeAi returned. The real cost stays recorded.
 */
export async function refundAi(userId: string, charged: { used: number }, kind: AiKind = "ai", now: Date = new Date()) {
  if (!charged.used) return; // unlimited, or a plan with no cap: nothing was counted
  await db.aiUsage.updateMany({ where: { userId, day: utcDay(now), kind, count: { gt: 0 } }, data: { count: { decrement: 1 } } }).catch(() => {});
}

/**
 * What's left today (and this month, when the plan caps it), without spending anything (for the UI).
 * `feature` "all" (default) reports unlimited only for a grant on every AI feature; pass one feature to ask about it.
 * `grant` is any live grant (features + expiry), so the UI can say which features are unlimited.
 */
export async function aiQuota(userId: string, kind: AiKind = "ai", now: Date = new Date(), feature: AiFeature | "all" = "all") {
  const lim = await limitsFor(userId, kind, feature, now);
  const row = lim.day ? await db.aiUsage.findUnique({ where: { userId_day_kind: { userId, day: utcDay(now), kind } }, select: { count: true } }) : null;
  const used = row?.count ?? 0;
  const month = lim.month ? await monthUsed(userId, kind, now) : 0;
  const dayLeft = lim.day ? Math.max(0, lim.day - used) : Infinity;
  const monthLeft = lim.month ? Math.max(0, lim.month - month) : Infinity;
  const grant = kind === "ai" ? await liveAiGrant(userId, now) : null;
  return { used, limit: lim.day, left: Math.min(dayLeft, monthLeft), monthUsed: month, monthLimit: lim.month, unlimited: lim.unlimited, expiresAt: lim.expiresAt, grant: grant ? { features: grant.features, expiresAt: grant.expiresAt } : null };
}

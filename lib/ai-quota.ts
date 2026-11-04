import "server-only";
import { db } from "./db";
import { env } from "./env";
import { HttpError } from "./http";
import { entitlements } from "./billing/entitlements";
import { noticeUsageLimit } from "./notify-events";

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
 */
export type AiKind = "ai" | "support";

export const QUOTA_MESSAGE = "You've used today's AI help. It resets at midnight UTC.";
export const monthMessage = (n: number, plan: string) => `${plan} includes ${n} AI requests a month and you've used them. Upgrade for more, or they reset on the 1st.`;

/** YYYY-MM-DD in UTC, the key the counter is bucketed by. */
export const utcDay = (now: Date = new Date()) => now.toISOString().slice(0, 10);
const utcMonth = (now: Date) => now.toISOString().slice(0, 8); // "YYYY-MM-", a prefix of every day key that month

async function limitsFor(userId: string, kind: AiKind) {
  if (kind === "support") return { day: env.AI_SUPPORT_DAILY_LIMIT, month: 0, plan: "" };
  const e = await entitlements(userId);
  return { day: e.aiDaily > 0 ? e.aiDaily : env.AI_DAILY_LIMIT, month: Math.max(0, e.aiMonthly), plan: e.planName };
}

const monthUsed = async (userId: string, kind: AiKind, now: Date) =>
  (await db.aiUsage.aggregate({ where: { userId, kind, day: { startsWith: utcMonth(now) } }, _sum: { count: true } }))._sum.count ?? 0;

/** Count one call and refuse once a cap is reached. Call it BEFORE the model, not after. */
export async function chargeAi(userId: string, kind: AiKind = "ai", now: Date = new Date()) {
  const lim = await limitsFor(userId, kind);
  if (!lim.day && !lim.month) return { used: 0, limit: 0, left: Infinity };
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
  return { used: row.count, limit: lim.day, left: lim.day ? Math.max(0, lim.day - row.count) : Infinity };
}

/** What's left today (and this month, when the plan caps it), without spending anything (for the UI). */
export async function aiQuota(userId: string, kind: AiKind = "ai", now: Date = new Date()) {
  const lim = await limitsFor(userId, kind);
  const row = lim.day ? await db.aiUsage.findUnique({ where: { userId_day_kind: { userId, day: utcDay(now), kind } }, select: { count: true } }) : null;
  const used = row?.count ?? 0;
  const month = lim.month ? await monthUsed(userId, kind, now) : 0;
  const dayLeft = lim.day ? Math.max(0, lim.day - used) : Infinity;
  const monthLeft = lim.month ? Math.max(0, lim.month - month) : Infinity;
  return { used, limit: lim.day, left: Math.min(dayLeft, monthLeft), monthUsed: month, monthLimit: lim.month };
}

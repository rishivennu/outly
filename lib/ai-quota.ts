import "server-only";
import { db } from "./db";
import { env } from "./env";
import { HttpError } from "./http";

/**
 * Daily per-person cap on model calls. Gemini costs money, so one account (or one loop in a script)
 * can't run up the bill. The counter is a single row per person per UTC day per kind, incremented by
 * an upsert, so it holds across instances without Redis.
 *
 * A limit of 0 means no cap. Anonymous callers are not counted (no User row to hang the count on);
 * the IP rate limit in lib/http.ts covers them.
 */
export type AiKind = "ai" | "support";

export const QUOTA_MESSAGE = "You've used today's AI help. It resets at midnight UTC.";

/** YYYY-MM-DD in UTC, the key the counter is bucketed by. */
export const utcDay = (now: Date = new Date()) => now.toISOString().slice(0, 10);

const limitFor = (kind: AiKind) => (kind === "support" ? env.AI_SUPPORT_DAILY_LIMIT : env.AI_DAILY_LIMIT);

/** Count one call and refuse once the cap is reached. Call it BEFORE the model, not after. */
export async function chargeAi(userId: string, kind: AiKind = "ai", now: Date = new Date()) {
  const limit = limitFor(kind);
  if (!limit) return { used: 0, limit: 0, left: Infinity };
  const day = utcDay(now);
  const row = await db.aiUsage.upsert({
    where: { userId_day_kind: { userId, day, kind } },
    create: { userId, day, kind, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  if (row.count > limit) throw new HttpError(429, QUOTA_MESSAGE, "AI_QUOTA");
  return { used: row.count, limit, left: Math.max(0, limit - row.count) };
}

/** What's left today, without spending anything (for the UI). */
export async function aiQuota(userId: string, kind: AiKind = "ai", now: Date = new Date()) {
  const limit = limitFor(kind);
  const row = limit ? await db.aiUsage.findUnique({ where: { userId_day_kind: { userId, day: utcDay(now), kind } }, select: { count: true } }) : null;
  const used = row?.count ?? 0;
  return { used, limit, left: limit ? Math.max(0, limit - used) : Infinity };
}

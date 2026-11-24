import "server-only";
import { db } from "../db";
import { utcDayKey } from "../ai/entitlements";
import { budgetVerdict, capFrom, type BudgetVerdict, type ClipperCap, type ClipperSpend } from "./budget-core";

/**
 * R1326: the clipper's daily AI budget. `calls` = this user's AI detection runs today (ClipEvent `detected` with
 * detector "ai", actorId = the person detecting; the event is written when a run ends). `inrMinor` = what today's
 * clipper model calls cost in the cost ledger (R1315 `recordTokens` books every call under feature "clipper" with the
 * caller's user id). The check runs before a run and the run is counted after it, so a day can overshoot by the
 * runs in flight at once (at most the owner's ACTIVE_JOBS_MAX jobs). Keyed by the user the ledger books, which is
 * the person detecting (an agency member spends their own day's budget, not the owner's).
 */
export const CLIPPER_FEATURE = "clipper";
const AI_RUN = '"detector":"ai"';

export const clipperCap = (): ClipperCap => capFrom({ CLIPPER_DAILY_CALLS: process.env.CLIPPER_DAILY_CALLS, CLIPPER_DAILY_INR: process.env.CLIPPER_DAILY_INR });

export async function clipperSpend(userId: string, now = new Date()): Promise<ClipperSpend> {
  const day = utcDayKey(now);
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const [calls, sum] = await Promise.all([
    db.clipEvent.count({ where: { actorId: userId, type: "detected", at: { gte: dayStart, lt: dayEnd }, data: { contains: AI_RUN } } }),
    db.costEvent.aggregate({ where: { userId, feature: CLIPPER_FEATURE, day }, _sum: { inrMinor: true } }),
  ]);
  return { calls, inrMinor: Math.round(sum._sum.inrMinor ?? 0) };
}

export async function clipperBudget(userId: string, now = new Date()): Promise<BudgetVerdict> {
  return budgetVerdict(await clipperSpend(userId, now), clipperCap());
}

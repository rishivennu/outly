import "server-only";
import { db } from "../db";
import { utcDayKey } from "../ai/entitlements";
import { TOKEN_UNIT } from "../costs/tokens";
import { budgetVerdict, capFrom, type BudgetVerdict, type ClipperCap, type ClipperSpend } from "./budget-core";

/**
 * R1326: the clipper's daily AI budget, read from the cost ledger (R1315 `recordTokens` books every clipper model
 * call under feature "clipper" with the caller's user id). The check runs before a call; the booking lands after
 * it, so one day can overshoot the cap by at most one call. Keyed by the user the ledger books, which is the
 * person detecting (an agency member spends their own day's budget, not the owner's).
 */
export const CLIPPER_FEATURE = "clipper";

export const clipperCap = (): ClipperCap => capFrom({ CLIPPER_DAILY_CALLS: process.env.CLIPPER_DAILY_CALLS, CLIPPER_DAILY_INR: process.env.CLIPPER_DAILY_INR });

export async function clipperSpend(userId: string, now = new Date()): Promise<ClipperSpend> {
  const day = utcDayKey(now);
  const where = { userId, feature: CLIPPER_FEATURE, day };
  const [calls, sum] = await Promise.all([db.costEvent.count({ where: { ...where, unit: TOKEN_UNIT.input } }), db.costEvent.aggregate({ where, _sum: { inrMinor: true } })]);
  return { calls, inrMinor: Math.round(sum._sum.inrMinor ?? 0) };
}

export async function clipperBudget(userId: string, now = new Date()): Promise<BudgetVerdict> {
  return budgetVerdict(await clipperSpend(userId, now), clipperCap());
}

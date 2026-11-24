/**
 * R1326 hardening, pure: the per-owner daily budget for the clipper's model calls. `budget.ts` reads the ledger;
 * this decides.
 *
 * Two caps, both per UTC day and per user, and the FIRST one hit wins:
 * - `calls`: AI detection RUNS today (`detected` events with detector "ai" by this user). Not model calls: one run
 *   can race two or three models (llmText hedging) and a timed-out call books no usage, so the ledger row count
 *   would both overstate and understate runs (R1328 review). This is the safety net when a model has no unit price
 *   on file, because then every call is booked at ₹0 and a money cap alone would never trip.
 * - `inrMinor`: what today's clipper model calls cost, in paise, from the cost ledger.
 * The cap never blocks the clipper: detection falls back to the rule detector and the response says so. A ledger
 * that cannot be read fails CLOSED to the rules too (`unavailableVerdict`), never to unlimited AI.
 * Days are UTC (`utcDayKey`), so "tomorrow" starts at 00:00 UTC, 05:30 IST; the lines say so.
 */
export interface ClipperCap { calls: number; inrMinor: number }
export interface ClipperSpend { calls: number; inrMinor: number }
export interface BudgetVerdict { allowed: boolean; reason: "ok" | "calls" | "money" | "unavailable"; spend: ClipperSpend; cap: ClipperCap; line: string }

export const DEFAULT_CLIPPER_CAP: ClipperCap = { calls: 30, inrMinor: 4000 };

/** Env overrides (`CLIPPER_DAILY_CALLS`, `CLIPPER_DAILY_INR` in rupees); anything unreadable keeps the default. */
export function capFrom(env: { CLIPPER_DAILY_CALLS?: string; CLIPPER_DAILY_INR?: string }, base: ClipperCap = DEFAULT_CLIPPER_CAP): ClipperCap {
  const n = (s: string | undefined) => {
    const v = Number(s);
    return s !== undefined && s !== "" && Number.isFinite(v) && v >= 0 ? v : null;
  };
  const calls = n(env.CLIPPER_DAILY_CALLS);
  const inr = n(env.CLIPPER_DAILY_INR);
  return { calls: calls === null ? base.calls : Math.floor(calls), inrMinor: inr === null ? base.inrMinor : Math.round(inr * 100) };
}

export const rupees = (minor: number) => `₹${(minor / 100).toFixed(minor % 100 === 0 ? 0 : 2)}`;

const RESET = "AI is back after 00:00 UTC (05:30 IST)";

export function budgetVerdict(spend: ClipperSpend, cap: ClipperCap): BudgetVerdict {
  if (spend.calls >= cap.calls) return { allowed: false, reason: "calls", spend, cap, line: `Today's AI detection is used up (${spend.calls} of ${cap.calls} runs). The rule detector ran instead; ${RESET}.` };
  if (spend.inrMinor >= cap.inrMinor) return { allowed: false, reason: "money", spend, cap, line: `Today's AI budget is used up (${rupees(spend.inrMinor)} of ${rupees(cap.inrMinor)}). The rule detector ran instead; ${RESET}.` };
  return { allowed: true, reason: "ok", spend, cap, line: `${spend.calls} of ${cap.calls} AI runs used today (${rupees(spend.inrMinor)} of ${rupees(cap.inrMinor)}).` };
}

/** The budget could not be read: the rules run this once, and the line says why (never a silent unlimited day). */
export const unavailableVerdict = (cap: ClipperCap): BudgetVerdict => ({
  allowed: false,
  reason: "unavailable",
  spend: { calls: 0, inrMinor: 0 },
  cap,
  line: "Today's AI budget could not be checked, so the rule detector ran this time. Try again in a minute for AI detection.",
});

/**
 * R1326 hardening, pure: the per-owner daily budget for the clipper's model calls. `budget.ts` reads the ledger;
 * this decides.
 *
 * Two caps, both per UTC day and per owner, and the FIRST one hit wins:
 * - `calls`: model calls today (the ledger books one `token-in` row per call). This is the safety net when a model
 *   has no unit price on file, because then every call is booked at ₹0 and a money cap alone would never trip.
 * - `inrMinor`: what today's calls cost, in paise, from the same ledger rows.
 * The cap never blocks the clipper: detection falls back to the rule detector and the response says so.
 */
export interface ClipperCap { calls: number; inrMinor: number }
export interface ClipperSpend { calls: number; inrMinor: number }
export interface BudgetVerdict { allowed: boolean; reason: "ok" | "calls" | "money"; spend: ClipperSpend; cap: ClipperCap; line: string }

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

export function budgetVerdict(spend: ClipperSpend, cap: ClipperCap): BudgetVerdict {
  if (spend.calls >= cap.calls) return { allowed: false, reason: "calls", spend, cap, line: `Today's AI detection is used up (${spend.calls} of ${cap.calls} runs). The rule detector ran instead; AI is back tomorrow.` };
  if (spend.inrMinor >= cap.inrMinor) return { allowed: false, reason: "money", spend, cap, line: `Today's AI budget is used up (${rupees(spend.inrMinor)} of ${rupees(cap.inrMinor)}). The rule detector ran instead; AI is back tomorrow.` };
  return { allowed: true, reason: "ok", spend, cap, line: `${spend.calls} of ${cap.calls} AI runs used today (${rupees(spend.inrMinor)} of ${rupees(cap.inrMinor)}).` };
}

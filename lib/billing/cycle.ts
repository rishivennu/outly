/**
 * Monthly vs yearly prices. Client-safe and pure, so the landing cards, the billing page, the admin
 * preview and checkout all agree on the yearly number to the cent.
 */
import { localPrice, nicePrice, isCurrency, type Priced } from "./currency";
import type { Currency } from "./money";

export type Cycle = "month" | "year";
export const isCycle = (v: unknown): v is Cycle => v === "month" || v === "year";

type PlanLike = { priceMinor: number; currency: string; interval: string; yearlyMinor?: number; prices?: Partial<Record<Currency, number>> };

/** Does this plan have a yearly option? Only monthly paid plans do (a yearly plan is already yearly). */
export const hasYearly = (p: { priceMinor: number; interval: string }, enabled: boolean) => enabled && p.interval === "month" && p.priceMinor > 0;

/** Yearly price in the plan's own currency: the admin's number, else monthly x (12 - free months). */
export function yearlyBase(p: PlanLike, freeMonths: number) {
  if (p.priceMinor <= 0) return 0;
  if (p.interval === "year") return p.priceMinor;
  return p.yearlyMinor && p.yearlyMinor > 0 ? p.yearlyMinor : p.priceMinor * Math.max(1, 12 - freeMonths);
}

/**
 * The price of `p` in `target` for one billing cycle. Monthly is the existing local price. Yearly in the
 * plan currency is exact; in another currency it is the local monthly price scaled by the same
 * yearly/monthly ratio, then rounded to a clean price point.
 */
export function priceFor(p: PlanLike, target: Currency, cycle: Cycle, freeMonths: number): Priced & { interval: Cycle } {
  const m = localPrice(p, target);
  if (cycle === "month" || p.interval === "year" || m.priceMinor <= 0) return { ...m, interval: p.interval === "year" ? "year" : "month" };
  const base = isCurrency(p.currency) ? p.currency : "INR";
  const y = yearlyBase(p, freeMonths);
  if (target === base) return { priceMinor: y, currency: base, converted: false, interval: "year" };
  return { priceMinor: nicePrice(Math.round((m.priceMinor * y) / p.priceMinor), target), currency: target, converted: true, interval: "year" };
}

/** Whole-percent saving of yearly against twelve monthly payments, or 0. */
export function yearlySaving(monthlyMinor: number, yearlyMinor: number) {
  if (monthlyMinor <= 0 || yearlyMinor <= 0) return 0;
  return Math.max(0, Math.round((1 - yearlyMinor / (monthlyMinor * 12)) * 100));
}

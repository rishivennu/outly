import "server-only";
import type { Plan } from "@prisma/client";
import { chargeCurrency, isCurrency, parsePrices } from "./currency";
import { priceFor, type Cycle } from "./cycle";
import type { Currency } from "./money";
import { experimentPrice } from "./experiments";
import { foundingPctFor } from "../founding";
import { foundingPrice } from "../founding-config";

/**
 * 1122: the price this buyer pays for `plan` on `cycle`, step by step, exactly as checkout charges it:
 * listed (in the gateway's currency) -> price test (the price this person was shown) -> founding discount.
 * `tested` is the honest "was" price for an offer; `founding` is what they would pay without one.
 */
export async function buyerPrice(userId: string, plan: Plan, provider: string, wanted: Currency | undefined, cycle: Cycle, freeMonths: number) {
  const listed = priceFor({ ...plan, prices: parsePrices(plan.prices), yearlyPrices: parsePrices(plan.yearlyPrices) }, chargeCurrency(provider, wanted ?? (isCurrency(plan.currency) ? plan.currency : "INR"), plan.currency), cycle, freeMonths);
  // 1096: a price test in this currency replaces the list price for the people in it (same yearly ratio).
  const test = listed.currency === plan.currency ? await experimentPrice(userId, plan.slug, listed.currency, { expose: false }) : null; // exposure is logged where the price is shown (billing page)
  const tested = test && plan.priceMinor > 0 ? { ...listed, priceMinor: Math.round((listed.priceMinor * test.priceMinor) / plan.priceMinor) } : listed;
  // Founding members (1036): the discount they claimed with, on every paid plan and cycle, for life.
  const fpct = await foundingPctFor(userId);
  return { listed, test, tested, fpct, foundingMinor: fpct ? foundingPrice(tested.priceMinor, fpct) : tested.priceMinor };
}

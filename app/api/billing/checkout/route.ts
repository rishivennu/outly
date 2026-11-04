import { z } from "zod";
import { json, route } from "@/lib/http";
import { startCheckout } from "@/lib/billing/service";
import { CURRENCIES } from "@/lib/billing/money";
import { requestCurrency } from "@/lib/billing/visitor";

const Body = z.object({ plan: z.string().trim().min(1).max(40), currency: z.enum(CURRENCIES).optional(), cycle: z.enum(["month", "year"]).optional(), campaign: z.string().trim().min(1).max(40).optional() });

export const POST = route(async (req, { user }) => {
  // `currency` is still accepted from older clients but ignored: the price is always in the location currency,
  // the same one the billing cards were priced in, so nobody can pick a cheaper currency at checkout.
  // 1122: `campaign` is a claimed offer; the server re-checks it and works out the price itself.
  const { plan, cycle, campaign } = Body.parse(await req.json());
  return json(await startCheckout(user.id, plan, requestCurrency(req).currency, cycle ?? "month", campaign ?? null));
}, { limit: [10, 60_000] });

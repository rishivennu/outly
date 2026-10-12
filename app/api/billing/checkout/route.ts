import { z } from "zod";
import { json, route } from "@/lib/http";
import { startCheckout } from "@/lib/billing/service";
import { CURRENCIES } from "@/lib/billing/money";
import { requestCurrency } from "@/lib/billing/visitor";

const Body = z.object({ plan: z.string().trim().min(1).max(40), currency: z.enum(CURRENCIES).optional() });

export const POST = route(async (req, { user }) => {
  const { plan, currency } = Body.parse(await req.json());
  // The currency the billing page showed wins, so the checkout amount always matches the card the user clicked.
  return json(await startCheckout(user.id, plan, currency ?? requestCurrency(req).currency));
}, { limit: [10, 60_000] });

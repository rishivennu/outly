import { z } from "zod";
import { revalidatePath } from "next/cache";
import { HttpError, json, route } from "@/lib/http";
import { setAutoRenew } from "@/lib/billing/autorenew";

const Body = z.object({ on: z.boolean(), replace: z.boolean().optional() }).strict();

/**
 * 1096: turn auto-renew on (Razorpay sends back a mandate link to approve) or off.
 * 1098: `replace` = Update payment method (a new mandate; the old one runs until the new one is approved).
 * Owner only: team members never change how the workspace pays.
 */
export const POST = route(async (req, { user }) => {
  if (user.actor) throw new HttpError(403, "Only the workspace owner can change billing.", "OWNER_ONLY");
  const { on, replace } = Body.parse(await req.json());
  const r = await setAutoRenew(user.id, on, { replace });
  revalidatePath("/billing");
  return json(r);
}, { limit: [10, 60_000] });

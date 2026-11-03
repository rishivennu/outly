import { HttpError, json, route } from "@/lib/http";
import { paymentMethodInfo } from "@/lib/billing/payment-method";

export const dynamic = "force-dynamic";

/** 1098: the payment method card on Billing. Read only, owner only (team members never see billing). */
export const GET = route(async (_req, { user }) => {
  if (user.actor) throw new HttpError(404, "Not found", "not_found");
  return json(await paymentMethodInfo(user.id));
}, { limit: [30, 60_000] });

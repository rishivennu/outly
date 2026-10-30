import { HttpError, json, route } from "@/lib/http";
import { paymentReceipt } from "@/lib/billing/receipt";

export const dynamic = "force-dynamic";

/**
 * A pending receipt checks back here until the payment settles (1053). Read only: it reports what the
 * database says, which the webhooks and the return handlers keep up to date. Owner only, like billing.
 */
export const GET = route<{ params: { id: string } }>(
  async (_req, { user, params }) => {
    if (user.actor) throw new HttpError(404, "Not found", "not_found");
    const r = await paymentReceipt(user.id, params.id.slice(0, 64));
    if (!r) throw new HttpError(404, "Not found", "not_found");
    return json({ receipt: r }, { headers: { "cache-control": "private, no-store" } });
  },
  { limit: [60, 60_000] },
);

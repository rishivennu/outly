import { json, route } from "@/lib/http";
import { activeGateway, mockAllowed } from "@/lib/billing/service";
import { requestCurrency } from "@/lib/billing/visitor";
import { activeOffer } from "@/lib/campaign";

export const dynamic = "force-dynamic";

/**
 * 1122: the promo offer for the signed-in person, priced on the server from the real plan price (or null).
 * Billing belongs to the workspace owner, so a teammate never sees one; nor does anyone while payments are closed.
 */
export const GET = route(
  async (req, { user }) => {
    if (user.actor) return json({ offer: null }, { headers: { "cache-control": "private, no-store" } });
    const { provider } = await activeGateway();
    if (provider === "mock" && !mockAllowed()) return json({ offer: null });
    const offer = await activeOffer(user.id, provider, requestCurrency(req).currency).catch((e) => {
      console.error("[campaign] active", e);
      return null;
    });
    return json({ offer }, { headers: { "cache-control": "private, no-store" } });
  },
  { limit: [30, 60_000] },
);

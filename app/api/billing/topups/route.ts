import { z } from "zod";
import { json, route } from "@/lib/http";
import { startTopUp, topUpOffer } from "@/lib/billing/service";
import { topUpsFor } from "@/lib/billing/topups";
import { packPrice } from "@/lib/billing/topups-core";
import { formatMoney } from "@/lib/billing/money";
import { requestCurrency } from "@/lib/billing/visitor";

/** 1096: packs on sale (priced in the visitor's currency) and the packs this person holds. */
export const GET = route(async (req, { user }) => {
  const [offer, held] = await Promise.all([topUpOffer(user.id), topUpsFor(user.id)]);
  const cur = requestCurrency(req).currency;
  const now = Date.now();
  return json({
    enabled: offer.cfg.enabled,
    packs: offer.packs.map((p) => {
      const price = packPrice(p, cur);
      return { id: p.id, kind: p.kind, units: p.units, days: p.days, label: p.label, price: formatMoney(price.priceMinor, price.currency), block: p.block };
    }),
    held: held.filter((t) => t.expiresAt.getTime() > now).map((t) => ({ id: t.id, kind: t.kind, units: t.units, remaining: t.remaining, expiresAt: t.expiresAt.toISOString() })),
  });
});

const Body = z.object({ pack: z.string().trim().min(2).max(30) });

export const POST = route(async (req, { user }) => {
  const { pack } = Body.parse(await req.json());
  return json(await startTopUp(user.id, pack, requestCurrency(req).currency));
}, { limit: [10, 60_000] });

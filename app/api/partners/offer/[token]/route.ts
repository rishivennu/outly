import { z } from "zod";
import { clientIp, HttpError, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { getOfferByToken, respondToOffer } from "@/lib/partners/offers";

export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };
const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };

/** The creator's offer, public-safe projection only (lib/partners/offers.ts PublicOffer). */
export const GET = route<Ctx>(
  async (_req, { params }) => {
    const offer = await getOfferByToken(params.token);
    if (!offer) throw new HttpError(404, "This offer link isn't valid. Check the link in your email.", "NOT_FOUND");
    return json({ offer }, { headers: NO_STORE });
  },
  { auth: false, limit: [60, 60_000] },
);

const Body = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("accept"), agree: z.literal(true, { message: "Tick the box to agree to the terms." }) }),
  z.object({ decision: z.literal("decline"), reason: z.string().trim().max(1000).optional() }),
]);

export const POST = route<Ctx>(
  async (req, { params }) => {
    if (!rateLimit(`partner-offer:${clientIp(req)}`, 20, 3_600_000).ok) throw new HttpError(429, "Too many tries from this network. Wait a while and try again.", "RATE_LIMITED");
    const b = Body.parse(await req.json());
    const r = await respondToOffer(params.token, b.decision, b.decision === "decline" ? { declineReason: b.reason } : {});
    return json(r, { headers: NO_STORE });
  },
  { auth: false, limit: [20, 60_000] },
);

import { z } from "zod";
import { assertSameOrigin, HttpError, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { realUserId } from "@/lib/auth";
import { respondOffer } from "@/lib/partners/mine";

export const dynamic = "force-dynamic";

const Body = z.object({ decision: z.enum(["accept", "decline"], { error: "Choose accept or decline." }), declineReason: z.string().max(1000).optional() });

/** Accept or decline an offer from the dashboard. Same path as the emailed link: terms snapshot, then the benefit. */
export const POST = route<{ params: { ref: string; offerId: string } }>(
  async (req, { params, user }) => {
    assertSameOrigin(req);
    if (!rateLimit(`partners:me:offer:${realUserId(user)}`, 20, 3_600_000).ok) throw new HttpError(429, "Too many attempts. Try again in a little while.", "RATE_LIMITED");
    const { decision, declineReason } = Body.parse(await req.json());
    const r = await respondOffer(user, params.ref, params.offerId, decision, declineReason);
    return json({ ok: true, state: r.state, app: r.app }, { headers: { "cache-control": "no-store" } });
  },
  { limit: [20, 60_000] },
);

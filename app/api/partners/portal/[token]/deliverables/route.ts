import { clientIp, HttpError, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { submitDeliverable } from "@/lib/partners/deliverables";

export const dynamic = "force-dynamic";

/** The creator submits a published link from the portal. The token must belong to an accepted offer of the same application. */
export const POST = route<{ params: { token: string } }>(
  async (req, { params }) => {
    if (!rateLimit(`partner-portal:${clientIp(req)}`, 30, 3_600_000).ok) throw new HttpError(429, "Too many submissions from this network. Wait a while and try again.", "RATE_LIMITED");
    const deliverable = await submitDeliverable(params.token, await req.json());
    return json({ deliverable }, { headers: { "cache-control": "no-store" } });
  },
  { auth: false, limit: [20, 60_000] },
);

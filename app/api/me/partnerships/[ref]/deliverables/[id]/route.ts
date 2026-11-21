import { assertSameOrigin, HttpError, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { realUserId } from "@/lib/auth";
import { submitMyDeliverable } from "@/lib/partners/mine";

export const dynamic = "force-dynamic";

/** Submit the published link for one agreed deliverable. */
export const POST = route<{ params: { ref: string; id: string } }>(
  async (req, { params, user }) => {
    assertSameOrigin(req);
    if (!rateLimit(`partners:me:deliverable:${realUserId(user)}`, 30, 3_600_000).ok) throw new HttpError(429, "Too many submissions. Try again in a little while.", "RATE_LIMITED");
    const deliverable = await submitMyDeliverable(user, params.ref, params.id, await req.json());
    return json({ ok: true, deliverable }, { headers: { "cache-control": "no-store" } });
  },
  { limit: [20, 60_000] },
);

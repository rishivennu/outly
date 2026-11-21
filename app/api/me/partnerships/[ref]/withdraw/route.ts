import { assertSameOrigin, HttpError, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { realUserId } from "@/lib/auth";
import { withdrawMine } from "@/lib/partners/mine";

export const dynamic = "force-dynamic";

/** Withdraw my own open application. */
export const POST = route<{ params: { ref: string } }>(
  async (req, { params, user }) => {
    assertSameOrigin(req);
    if (!rateLimit(`partners:me:withdraw:${realUserId(user)}`, 10, 3_600_000).ok) throw new HttpError(429, "Too many attempts. Try again in a little while.", "RATE_LIMITED");
    const r = await withdrawMine(user, params.ref);
    return json({ ok: true, already: r.already, app: r.app }, { headers: { "cache-control": "no-store" } });
  },
  { limit: [10, 60_000] },
);

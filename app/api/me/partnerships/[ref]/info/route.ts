import { assertSameOrigin, HttpError, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { realUserId } from "@/lib/auth";
import { respondInfo } from "@/lib/partners/mine";

export const dynamic = "force-dynamic";

/** The creator's answer to "more information required": message plus any updated accounts, numbers or files. */
export const POST = route<{ params: { ref: string } }>(
  async (req, { params, user }) => {
    assertSameOrigin(req);
    if (!rateLimit(`partners:me:info:${realUserId(user)}`, 20, 3_600_000).ok) throw new HttpError(429, "That's a lot of updates at once. Try again in a little while.", "RATE_LIMITED");
    const r = await respondInfo(user, params.ref, await req.json());
    return json({ ok: true, already: r.already, app: r.app }, { headers: { "cache-control": "no-store" } });
  },
  { limit: [20, 60_000] },
);

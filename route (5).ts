import { json, route } from "@/lib/http";
import { foundingPublic } from "@/lib/founding";

export const dynamic = "force-dynamic";

/** Public: how many founding seats are left, for the live counter on signup. Cached ~10 s server-side. */
export const GET = route(async () => json({ seats: await foundingPublic() }, { headers: { "cache-control": "no-store" } }), { auth: false, limit: [60, 60_000] });

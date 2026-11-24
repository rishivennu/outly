import { json, route } from "@/lib/http";
import { clipPerformance } from "@/lib/clipper/publish";

export const dynamic = "force-dynamic";

/** R1323: how the clip's post is doing, destination by destination. Numbers a platform never gave are null, not 0. */
export const GET = route(async (_req, { user, params }) => json(await clipPerformance(user.id, params.id), { headers: { "cache-control": "private, no-store" } }), { limit: [120, 60_000] });

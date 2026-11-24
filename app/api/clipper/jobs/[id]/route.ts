import { json, route } from "@/lib/http";
import { jobDetail } from "@/lib/clipper/jobs";

export const dynamic = "force-dynamic";

/** R1321: one job with its source media, transcript (cues), ranked candidates and clips. Owner-scoped. */
export const GET = route(async (_req, { user, params }) => json(await jobDetail(user.id, params.id), { headers: { "cache-control": "private, no-store" } }), { limit: [240, 60_000] });

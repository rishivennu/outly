import { json, route } from "@/lib/http";
import { jobDetail } from "@/lib/clipper/jobs";

export const dynamic = "force-dynamic";

/** R1321: one job with its source media, transcript (cues), ranked candidates and clips. Owner-scoped. */
/** `?transcript=1` includes the subtitle lines (the editor needs them once); polling leaves them out. */
export const GET = route(async (req, { user, params }) => json(await jobDetail(user.id, params.id, { transcript: new URL(req.url).searchParams.get("transcript") === "1" }), { headers: { "cache-control": "private, no-store" } }), { limit: [240, 60_000] });

import { json, route } from "@/lib/http";
import { clipForCreate } from "@/lib/clipper/publish";

export const dynamic = "force-dynamic";

/** R1323: what Create needs to start a post from this clip (rendered Media + words). 409 until the clip is rendered. */
export const GET = route(async (_req, { user, params }) => json(await clipForCreate(user.id, params.id), { headers: { "cache-control": "private, no-store" } }), { limit: [60, 60_000] });

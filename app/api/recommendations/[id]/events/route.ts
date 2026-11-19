import { json, route } from "@/lib/http";
import { eventsFor } from "@/lib/intelligence/planner";

export const dynamic = "force-dynamic";

/** R1240: the recommendation's audit trail, newest first, up to 50. */
export const GET = route(async (req, { user, params }) => json({ events: await eventsFor(user.id, params.id, Number(req.nextUrl.searchParams.get("limit")) || 50) }));

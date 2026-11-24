import { json, route } from "@/lib/http";
import { clipEvents } from "@/lib/clipper/jobs";

export const dynamic = "force-dynamic";

/** R1321: the audit trail of one clip (approved, edited, rendered, published), newest first. */
export const GET = route(
  async (req, { user, params }) => {
    const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50) || 50;
    return json({ events: await clipEvents(user.id, params.id, limit) });
  },
  { limit: [120, 60_000] },
);

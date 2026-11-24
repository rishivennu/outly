import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { regenerateCopy } from "@/lib/clipper/jobs";

export const dynamic = "force-dynamic";

/** R1321: redraft title, hook, caption and hashtags from the clip's own words (deterministic, no model). */
export const POST = route(
  async (_req, { user, params }) => json({ clip: await regenerateCopy(user.id, params.id, { id: realUserId(user), role: user.role }) }),
  { limit: [60, 60_000] },
);

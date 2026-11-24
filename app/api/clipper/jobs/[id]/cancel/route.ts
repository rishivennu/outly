import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { moveJob } from "@/lib/clipper/jobs";

export const dynamic = "force-dynamic";

/** R1321: stop a queued or running job. Clips already approved stay. */
export const POST = route(
  async (_req, { user, params }) => json({ job: await moveJob(user.id, params.id, "cancel", { id: realUserId(user), role: user.role }) }),
  { limit: [30, 60_000] },
);

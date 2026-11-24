import { z } from "zod";
import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { approveCandidate, rejectCandidate } from "@/lib/clipper/jobs";

export const dynamic = "force-dynamic";

const body = z.object({ action: z.enum(["approve", "reject"]) });

/** R1321: approve a moment (it becomes a clip, once) or reject it. */
export const POST = route(
  async (req, { user, params }) => {
    const b = body.parse(await req.json());
    const actor = { id: realUserId(user), role: user.role };
    if (b.action === "approve") {
      const r = await approveCandidate(user.id, params.id, actor);
      return json(r, { status: r.created ? 201 : 200 });
    }
    return json({ candidate: await rejectCandidate(user.id, params.id, actor) });
  },
  { limit: [60, 60_000] },
);

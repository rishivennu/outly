import { z } from "zod";
import { json, route } from "@/lib/http";
import { ownedPost, postView } from "@/lib/services";
import { notesFor, teamDecide } from "@/lib/collab";

export const dynamic = "force-dynamic";

const body = z.object({ decision: z.enum(["approved", "changes_requested"]), note: z.string().max(2000).optional().nullable() });

/** Approve (or send back) a draft from inside the team (1037). Owners and managers; editors are refused. */
export const POST = route(
  async (req, { user, params }) => {
    const { decision, note } = body.parse(await req.json());
    await teamDecide(user, params.id, decision, note);
    const [post, notes] = await Promise.all([ownedPost(user.id, params.id).then(postView), notesFor(user, params.id)]);
    return json({ post, notes });
  },
  { limit: [30, 60_000] },
);

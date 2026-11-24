import { z } from "zod";
import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { addTextCandidates } from "@/lib/clipper/jobs";

export const dynamic = "force-dynamic";

const body = z.object({ query: z.string().trim().min(2).max(300) });

/** R1321: cut by text. Every place the transcript says the phrase becomes a candidate (source "text"). */
export const POST = route(
  async (req, { user, params }) => {
    const { query } = body.parse(await req.json());
    return json(await addTextCandidates(user.id, params.id, query, { id: realUserId(user), role: user.role }));
  },
  { limit: [60, 60_000] },
);

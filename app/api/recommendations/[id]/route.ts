import { z } from "zod";
import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { act } from "@/lib/intelligence/planner";

export const dynamic = "force-dynamic";

const body = z.object({ action: z.string().max(20), payload: z.unknown().optional() });

/** R1240: accept, edit, reject, save, done or feedback. Every role may act: recommendations are drafts. */
export const POST = route(
  async (req, { user, params }) => {
    const b = body.parse(await req.json());
    return json(await act(user.id, params.id, b.action, b.payload, { id: realUserId(user), role: user.role }));
  },
  { limit: [60, 60_000] },
);

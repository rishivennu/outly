import { z } from "zod";
import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { act } from "@/lib/intelligence/planner";

export const dynamic = "force-dynamic";

const body = z.object({ id: z.string().min(1).max(64), action: z.string().max(20), payload: z.unknown().optional() });

/**
 * R1320: feedback on a recommendation (accept, edit, reject, save, done or feedback), the same planner transaction
 * as /api/recommendations/:id, written as a RecommendationEvent and a LearningEvent. Owner-scoped: a row from another
 * workspace is a 404.
 */
export const POST = route(
  async (req, { user }) => {
    const b = body.parse(await req.json());
    return json(await act(user.id, b.id, b.action, b.payload, { id: realUserId(user), role: user.role }));
  },
  { limit: [60, 60_000] },
);

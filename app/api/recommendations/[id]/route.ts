import { z } from "zod";
import { realUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { act } from "@/lib/intelligence/planner";
import { prefillOf } from "@/lib/intelligence/planner-core";

export const dynamic = "force-dynamic";

const body = z.object({ action: z.string().max(20), payload: z.unknown().optional() });

/** R1241: one recommendation and its composer prefill, in any status, for the owner's workspace only. */
export const GET = route(async (_req, { user, params }) => {
  const rec = await db.recommendation.findFirst({ where: { id: params.id, ownerId: user.id } });
  if (!rec) throw new HttpError(404, "We couldn't find that recommendation.");
  const { id, status, title, concept, why, platform, format, confidence, createdAt } = rec;
  return json({ recommendation: { id, status, title, concept, why, platform, format, confidence, createdAt: createdAt.toISOString() }, prefill: prefillOf(rec) });
});

/** R1240: accept, edit, reject, save, done or feedback. Every role may act: recommendations are drafts. */
export const POST = route(
  async (req, { user, params }) => {
    const b = body.parse(await req.json());
    return json(await act(user.id, params.id, b.action, b.payload, { id: realUserId(user), role: user.role }));
  },
  { limit: [60, 60_000] },
);

import { z } from "zod";
import { json, route, HttpError } from "@/lib/http";
import { db } from "@/lib/db";
import { SHARED_MIN_OWNERS, SHARED_MIN_POSTS, SHARED_WINDOW_DAYS } from "@/lib/intelligence/shared-core";

export const dynamic = "force-dynamic";

/**
 * R1324: whether this workspace's measured posts may join the anonymised cohort baselines. GET reads it; PATCH
 * { share } sets it. The posts belong to the workspace owner, so the setting is theirs: a team member reads it but
 * cannot flip it. Opting out takes effect at the next rebuild (hourly) and never changes the owner's own predictions.
 */
const body = z.object({ share: z.boolean() });

const view = (u: { shareLearning: boolean }) => ({ share: u.shareLearning, rules: { minOwners: SHARED_MIN_OWNERS, minPosts: SHARED_MIN_POSTS, windowDays: SHARED_WINDOW_DAYS } });

export const GET = route(
  async (_req, { user }) => {
    const u = await db.user.findUnique({ where: { id: user.id }, select: { shareLearning: true } });
    if (!u) throw new HttpError(404, "Account not found.");
    return json(view(u), { headers: { "cache-control": "private, no-store" } });
  },
  { limit: [60, 60_000] },
);

export const PATCH = route(
  async (req, { user }) => {
    if (user.role !== "owner") throw new HttpError(403, "Only the workspace owner can change this.", "OWNER_ONLY");
    const { share } = body.parse(await req.json());
    const u = await db.user.update({ where: { id: user.id }, data: { shareLearning: share }, select: { shareLearning: true } });
    return json(view(u));
  },
  { limit: [20, 60_000] },
);

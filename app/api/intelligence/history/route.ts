import { HttpError, json, route } from "@/lib/http";
import { db } from "@/lib/db";
import { eventsFor } from "@/lib/intelligence/planner";

export const dynamic = "force-dynamic";

const LIMIT_MAX = 100;
const parse = (s: string | null): unknown => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/**
 * R1320: what the engine has learned, newest first: the owner's LearningEvents (forecasts judged, profiles rebuilt,
 * recommendations acted on). ?type= narrows by event type, ?limit= up to 100. ?recommendation=<id> returns that
 * recommendation's own audit trail instead (owner-checked).
 */
export const GET = route(
  async (req, { user }) => {
    const q = req.nextUrl.searchParams;
    const raw = q.get("limit");
    const limit = raw === null ? 50 : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX) throw new HttpError(400, `Pick a limit from 1 to ${LIMIT_MAX}.`, "BAD_LIMIT");
    const recId = q.get("recommendation");
    if (recId) {
      if (recId.length > 64) throw new HttpError(400, "That recommendation id is not one of ours.", "BAD_ID");
      // One recommendation's trail is capped at 50 by eventsFor.
      return json({ events: await eventsFor(user.id, recId, Math.min(limit, 50)) }, { headers: { "cache-control": "private, no-store" } });
    }
    const type = q.get("type");
    if (type !== null && !/^[a-z_]{1,40}$/.test(type)) throw new HttpError(400, "That event type is not one we keep.", "BAD_TYPE");
    const rows = await db.learningEvent.findMany({ where: { ownerId: user.id, ...(type ? { type } : {}) }, orderBy: [{ at: "desc" }, { id: "desc" }], take: limit });
    return json(
      { events: rows.map((e) => ({ id: e.id, type: e.type, subjectType: e.subjectType, subjectId: e.subjectId, data: parse(e.data), at: e.at.toISOString() })) },
      { headers: { "cache-control": "private, no-store" } },
    );
  },
  { limit: [60, 60_000] },
);

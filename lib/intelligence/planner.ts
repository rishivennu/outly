import "server-only";
import type { Recommendation } from "@prisma/client";
import { db } from "../db";
import { HttpError } from "../http";
import { DEDUPE_MS, NOTHING_TO_CHANGE, applyAction, eventTypeOf, ideaTextOf, isPlannerAction, isPlannerError, prefillOf, type Prefill } from "./planner-core";
import { isExpired } from "./reco-core";

/**
 * R1240: the Growth Planner's actions on a recommendation, each one a single transaction that writes the change and
 * its RecommendationEvent. Recommendations are drafts, so the owner, managers and editors may all act on them.
 */

export interface ActResult {
  recommendation: Recommendation;
  deduped: boolean;
  prefill?: Prefill;
  ideaId?: string;
}

const CODE_STATUS = { ILLEGAL_TRANSITION: 400, BAD_PAYLOAD: 400, FEEDBACK_GIVEN: 409, UNKNOWN_ACTION: 400 } as const;
// Small by construction: edit fields are capped (title 120, concept 600), feedback notes at 300.
const json = (v: Record<string, unknown> | null) => (v ? JSON.stringify(v) : null);
const EXPIRED_MESSAGE = "This recommendation has expired: its numbers are too old to act on. Fresh ones appear on Content Intelligence.";

export async function act(ownerId: string, recId: string, action: string, payload: unknown, actor: { id: string; role: string }, now: number = Date.now()): Promise<ActResult> {
  if (!isPlannerAction(action)) throw new HttpError(400, "That isn't something you can do to a recommendation.", "UNKNOWN_ACTION");
  const type = eventTypeOf(action);
  const out = await db.$transaction(async (tx): Promise<ActResult | "expired"> => {
    const rec = await tx.recommendation.findFirst({ where: { id: recId, ownerId } });
    if (!rec) throw new HttpError(404, "We couldn't find that recommendation.");
    // R1244: an expired row only takes feedback. One the sweep has not marked yet is marked here, in this
    // transaction, so the row stays truthful; the 400 is thrown after commit so that write is kept.
    if (action !== "feedback" && (rec.status === "expired" || isExpired(rec, now))) {
      if (rec.status !== "expired") {
        const n = await tx.recommendation.updateMany({ where: { id: rec.id, ownerId, status: rec.status }, data: { status: "expired" } });
        if (n.count) await tx.recommendationEvent.create({ data: { recommendationId: rec.id, actorId: actor.id, type: "expired", data: json({ by: "act", action, role: actor.role }) } });
      }
      return "expired";
    }
    const history = await tx.recommendationEvent.findMany({ where: { recommendationId: rec.id }, orderBy: [{ at: "desc" }, { id: "desc" }], select: { type: true, actorId: true, at: true, data: true } });
    const last = history[0];
    const withPrefill = (r: Recommendation, deduped: boolean, ideaId?: string): ActResult => ({ recommendation: r, deduped, ...(action === "accept" ? { prefill: prefillOf(r) } : {}), ...(ideaId ? { ideaId } : {}) });
    // A double click: the same action by the same person moments ago answers with the row as it is. An edit is only a
    // repeat when it changes nothing (a different edit that soon is a real second change).
    const recent = !!last && last.type === type && last.actorId === actor.id && Date.now() - last.at.getTime() < DEDUPE_MS;
    if (recent && action !== "edit") return withPrefill(rec, true);

    const r = applyAction(rec, action, payload, actor.id, history);
    if (isPlannerError(r)) {
      if (recent && r.error === "BAD_PAYLOAD" && r.message === NOTHING_TO_CHANGE) return withPrefill(rec, true);
      throw new HttpError(CODE_STATUS[r.error], r.message, r.error);
    }

    // Conditional on the status read above: a concurrent action that moved it first makes this one a 409.
    const n = await tx.recommendation.updateMany({ where: { id: rec.id, ownerId, status: rec.status }, data: r.next });
    if (!n.count) throw new HttpError(409, "Someone else just changed this recommendation. Refresh to see it.", "CONFLICT");

    let ideaId: string | undefined;
    if (action === "save") {
      const earlier = history.find((h) => h.type === "saved");
      if (!earlier) ideaId = (await tx.idea.create({ data: { userId: ownerId, text: ideaTextOf({ title: r.next.title ?? rec.title, concept: r.next.concept ?? rec.concept }), source: "suggestion", sourceRef: rec.id } })).id;
    }
    await tx.recommendationEvent.create({ data: { recommendationId: rec.id, actorId: actor.id, type, data: json(ideaId ? { ...(r.event.data ?? {}), ideaId, role: actor.role } : { ...(r.event.data ?? {}), role: actor.role }) } });
    const after = await tx.recommendation.findUniqueOrThrow({ where: { id: rec.id } });
    return withPrefill(after, false, ideaId);
  });
  if (out === "expired") throw new HttpError(400, EXPIRED_MESSAGE, "EXPIRED");
  return out;
}

export interface RecoEventView {
  id: string;
  type: string;
  actorId: string | null;
  data: unknown;
  at: string;
}

const parseData = (s: string | null): unknown => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** The recommendation's audit trail, newest first. 404 when it is not the owner's. */
export async function eventsFor(ownerId: string, recId: string, limit = 50): Promise<RecoEventView[]> {
  const rec = await db.recommendation.findFirst({ where: { id: recId, ownerId }, select: { id: true } });
  if (!rec) throw new HttpError(404, "We couldn't find that recommendation.");
  const rows = await db.recommendationEvent.findMany({ where: { recommendationId: rec.id }, orderBy: [{ at: "desc" }, { id: "desc" }], take: Math.min(50, Math.max(1, Math.floor(limit) || 50)) });
  return rows.map((e) => ({ id: e.id, type: e.type, actorId: e.actorId, data: parseData(e.data), at: e.at.toISOString() }));
}

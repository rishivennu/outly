import "server-only";
import { db } from "../db";

/**
 * R1318: the learning log. Recommendation feedback stays in RecommendationEvent (planner.ts); everything else the
 * engine learns from lands here. A dedupeKey makes a repeated write a no-op, so sweeps and retries are safe.
 */

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** Append to the learning log; the same dedupeKey twice is a no-op (returns false). */
export async function logLearning(ownerId: string, type: string, opts: { subjectType?: string; subjectId?: string; dedupeKey?: string; data?: unknown; at?: Date } = {}): Promise<boolean> {
  if (opts.dedupeKey && (await db.learningEvent.findUnique({ where: { ownerId_dedupeKey: { ownerId, dedupeKey: opts.dedupeKey } }, select: { id: true } }))) return false;
  try {
    await db.learningEvent.create({
      data: { ownerId, type, subjectType: opts.subjectType ?? null, subjectId: opts.subjectId ?? null, dedupeKey: opts.dedupeKey ?? null, data: opts.data === undefined ? null : JSON.stringify(opts.data).slice(0, 4000), at: opts.at ?? new Date() },
    });
    return true;
  } catch (e) {
    if (isUnique(e)) return false; // a racing writer got there first
    throw e;
  }
}


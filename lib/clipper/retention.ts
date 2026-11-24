import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { ABANDON_DAYS, ABANDONED_ERROR, RETENTION_BATCH, retentionCutoffs, retentionLine, type RetentionReport } from "./retention-core";

/**
 * R1326: the clipper's housekeeping, one bounded pass per sweep slot (lib/queue/plan.ts housekeeping, every 5 min).
 * Rules and reasons live in `retention-core.ts`. Every step is its own query with `take: RETENTION_BATCH`, so a
 * backlog costs at most three small reads and three deletes a run and the post sweep ahead of it is never delayed.
 */

/** Jobs closed at or before `cutoff`: failed/cancelled, or ready with the review done. `completedAt` first, `updatedAt` for failed jobs. */
const closedBefore = (cutoff: Date): Prisma.ClipJobWhereInput => ({
  OR: [
    { status: { in: ["failed", "cancelled"] }, OR: [{ completedAt: { lte: cutoff } }, { completedAt: null, updatedAt: { lte: cutoff } }] },
    { status: "ready", stage: "done", OR: [{ completedAt: { lte: cutoff } }, { completedAt: null, updatedAt: { lte: cutoff } }] },
  ],
});

const quiet = (cutoff: Date): Prisma.ClipJobWhereInput => ({ status: "running", OR: [{ heartbeatAt: { lte: cutoff } }, { heartbeatAt: null, updatedAt: { lte: cutoff } }] });

export async function sweepClipper(now = new Date()): Promise<RetentionReport> {
  const t0 = Date.now();
  const cut = retentionCutoffs(now);
  // 1. Running jobs nobody has driven for ABANDON_DAYS: cancelled, with the reason on the job and in its log.
  //    The update repeats the condition, so a heartbeat that lands between the read and the write keeps the job.
  const stale = await db.clipJob.findMany({ where: quiet(cut.abandoned), select: { id: true, ownerId: true, stage: true }, take: RETENTION_BATCH });
  let abandoned = 0;
  for (const j of stale) {
    const n = await db.clipJob.updateMany({ where: { id: j.id, ...quiet(cut.abandoned) }, data: { status: "cancelled", error: ABANDONED_ERROR, completedAt: now, heartbeatAt: now } });
    if (!n.count) continue;
    abandoned++;
    await db.clipEvent.create({ data: { jobId: j.id, ownerId: j.ownerId, type: "abandoned", data: JSON.stringify({ from: { status: "running", stage: j.stage }, to: { status: "cancelled", stage: j.stage }, afterDays: ABANDON_DAYS }) } });
  }
  // 2. Transcripts of jobs closed TRANSCRIPT_RETENTION_DAYS ago.
  const tIds = (await db.clipTranscript.findMany({ where: { job: closedBefore(cut.transcripts) }, select: { id: true }, take: RETENTION_BATCH })).map((r) => r.id);
  const transcripts = tIds.length ? (await db.clipTranscript.deleteMany({ where: { id: { in: tIds } } })).count : 0;
  // 3. Suggested and rejected candidates of jobs closed CANDIDATE_RETENTION_DAYS ago (approved ones stay with their clips).
  const cIds = (await db.clipCandidate.findMany({ where: { status: { in: ["suggested", "rejected"] }, job: closedBefore(cut.candidates) }, select: { id: true }, take: RETENTION_BATCH })).map((r) => r.id);
  const candidates = cIds.length ? (await db.clipCandidate.deleteMany({ where: { id: { in: cIds } } })).count : 0;
  const report = { abandoned, transcripts, candidates, ms: Date.now() - t0 };
  if (abandoned || transcripts || candidates) console.log(`[sweep] ${retentionLine(report)}`);
  return report;
}

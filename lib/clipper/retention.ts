import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { ABANDON_BATCH, ABANDON_DAYS, ABANDONED_ERROR, RETENTION_BATCH, retentionCutoffs, retentionLine, type RetentionReport } from "./retention-core";

/**
 * R1326: the clipper's housekeeping, one bounded pass per sweep slot (lib/queue/plan.ts housekeeping, every 5 min).
 * Rules and reasons live in `retention-core.ts`. Every step is its own query with `take: RETENTION_BATCH` (the
 * per-row abandon step `ABANDON_BATCH`), so a backlog costs at most three small reads and three deletes a run and the
 * post sweep ahead of it is never delayed. R1328 review: every delete repeats its condition next to the ids, so a
 * candidate approved or a job retried between the read and the write is kept.
 */

const closedClock = (cutoff: Date): Prisma.ClipJobWhereInput => ({ OR: [{ completedAt: { lte: cutoff } }, { completedAt: null, updatedAt: { lte: cutoff } }] });

/** Jobs closed at or before `cutoff`: failed/cancelled, or ready with the review done. `completedAt` first, `updatedAt` for failed jobs. */
const closedBefore = (cutoff: Date): Prisma.ClipJobWhereInput => ({
  OR: [
    { status: { in: ["failed", "cancelled"] }, ...closedClock(cutoff) },
    { status: "ready", stage: "done", ...closedClock(cutoff) },
  ],
});

/** Closed for good at or before `cutoff`: a failed job can be retried at its stage and still needs its transcript, so it is not here. */
const terminalBefore = (cutoff: Date): Prisma.ClipJobWhereInput => ({
  OR: [
    { status: "cancelled", ...closedClock(cutoff) },
    { status: "ready", stage: "done", ...closedClock(cutoff) },
  ],
});

/** Running with no executor report, or queued and untouched, since `cutoff` (both hold an ACTIVE_JOBS_MAX slot). */
const quiet = (cutoff: Date): Prisma.ClipJobWhereInput => ({
  OR: [
    { status: "running", OR: [{ heartbeatAt: { lte: cutoff } }, { heartbeatAt: null, updatedAt: { lte: cutoff } }] },
    { status: "queued", updatedAt: { lte: cutoff } },
  ],
});

const SPARE = ["suggested", "rejected"];

export async function sweepClipper(now = new Date(), opts: { batch?: number; abandonBatch?: number } = {}): Promise<RetentionReport> {
  const t0 = Date.now();
  const batch = opts.batch ?? RETENTION_BATCH;
  const cut = retentionCutoffs(now);
  // 1. Running jobs nobody has driven, and queued jobs nobody started, for ABANDON_DAYS: cancelled, with the reason on
  //    the job and in its log. The update repeats the condition, so a heartbeat or a start that lands between the read
  //    and the write keeps the job. Events are written once, after the loop, for the jobs the update actually closed.
  const stale = await db.clipJob.findMany({ where: quiet(cut.abandoned), select: { id: true, ownerId: true, status: true, stage: true }, take: opts.abandonBatch ?? ABANDON_BATCH });
  const closed: typeof stale = [];
  for (const j of stale) {
    const n = await db.clipJob.updateMany({ where: { id: j.id, ...quiet(cut.abandoned) }, data: { status: "cancelled", error: ABANDONED_ERROR, completedAt: now, heartbeatAt: now } });
    if (n.count) closed.push(j);
  }
  if (closed.length) {
    await db.clipEvent.createMany({
      data: closed.map((j) => ({ jobId: j.id, ownerId: j.ownerId, type: "abandoned", data: JSON.stringify({ from: { status: j.status, stage: j.stage }, to: { status: "cancelled", stage: j.stage }, afterDays: ABANDON_DAYS }) })),
    });
  }
  // 2. Transcripts of jobs closed for good TRANSCRIPT_RETENTION_DAYS ago (failed jobs keep theirs for a retry).
  const tIds = (await db.clipTranscript.findMany({ where: { job: terminalBefore(cut.transcripts) }, select: { id: true }, take: batch })).map((r) => r.id);
  const transcripts = tIds.length ? (await db.clipTranscript.deleteMany({ where: { id: { in: tIds }, job: terminalBefore(cut.transcripts) } })).count : 0;
  // 3. Suggested and rejected candidates of jobs closed CANDIDATE_RETENTION_DAYS ago (approved ones stay with their clips).
  const cIds = (await db.clipCandidate.findMany({ where: { status: { in: SPARE }, job: closedBefore(cut.candidates) }, select: { id: true }, take: batch })).map((r) => r.id);
  const candidates = cIds.length ? (await db.clipCandidate.deleteMany({ where: { id: { in: cIds }, status: { in: SPARE }, job: closedBefore(cut.candidates) } })).count : 0;
  const report = { abandoned: closed.length, transcripts, candidates, ms: Date.now() - t0 };
  if (report.abandoned || transcripts || candidates) console.log(`[sweep] ${retentionLine(report)}`);
  return report;
}

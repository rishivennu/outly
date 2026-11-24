/**
 * R1326 hardening, pure: the clipper's retention and abandonment rules. No Prisma here; `retention.ts` applies them.
 *
 * - A job is CLOSED once nothing more will happen to it: failed, cancelled, or ready with the review done.
 *   `ready/review` is still the creator's desk and is never pruned.
 * - The clock starts when the job closed (`completedAt`, else `updatedAt`), never at creation, so a long review
 *   does not eat into the retention of the clips' material.
 * - Transcripts (the heaviest rows) go TRANSCRIPT_RETENTION_DAYS after close. After that a clip keeps its title,
 *   copy and plans, but "Regenerate copy" and "Find in words" answer NO_TRANSCRIPT.
 * - Suggested and rejected candidates go CANDIDATE_RETENTION_DAYS after close. Approved ones stay: a clip's
 *   candidate carries the reason and scores the feedback loop learns from.
 * - A running job whose executor has not reported for ABANDON_DAYS is cancelled by the sweep ("abandoned"), so it
 *   stops holding one of the owner's ACTIVE_JOBS_MAX slots. A stall under that is the creator's to resume.
 * - Every pass is bounded (RETENTION_BATCH rows per table per sweep); whatever is left waits for the next slot.
 */
export const TRANSCRIPT_RETENTION_DAYS = 90;
export const CANDIDATE_RETENTION_DAYS = 30;
export const ABANDON_DAYS = 7;
export const RETENTION_BATCH = 500;
export const DAY_MS = 86_400_000;

export interface JobLike { status: string; stage: string; heartbeatAt: Date | null; updatedAt: Date; completedAt: Date | null }

export const isClosed = (j: { status: string; stage: string }) => j.status === "failed" || j.status === "cancelled" || (j.status === "ready" && j.stage === "done");

/** When the job closed, for the retention clock (null while it is open). */
export const closedAt = (j: JobLike): Date | null => (isClosed(j) ? (j.completedAt ?? j.updatedAt) : null);

export const retentionCutoffs = (now: Date) => ({
  transcripts: new Date(now.getTime() - TRANSCRIPT_RETENTION_DAYS * DAY_MS),
  candidates: new Date(now.getTime() - CANDIDATE_RETENTION_DAYS * DAY_MS),
  abandoned: new Date(now.getTime() - ABANDON_DAYS * DAY_MS),
});

export const transcriptExpired = (j: JobLike, now: Date) => {
  const c = closedAt(j);
  return c !== null && c <= retentionCutoffs(now).transcripts;
};

export const candidatesExpired = (j: JobLike, now: Date) => {
  const c = closedAt(j);
  return c !== null && c <= retentionCutoffs(now).candidates;
};

/** Running with no executor report for ABANDON_DAYS (heartbeat, else the last update). */
export const isAbandoned = (j: JobLike, now: Date) => j.status === "running" && (j.heartbeatAt ?? j.updatedAt) <= retentionCutoffs(now).abandoned;

export const ABANDONED_ERROR = `No progress was reported for ${ABANDON_DAYS} days, so this job was closed. Start it again from the video when you are ready.`;

export interface RetentionReport { abandoned: number; transcripts: number; candidates: number; ms: number }

/** One line for the sweep response and the admin log. */
export const retentionLine = (r: RetentionReport) =>
  `clipper retention: ${r.abandoned} abandoned job${r.abandoned === 1 ? "" : "s"} closed, ${r.transcripts} transcript${r.transcripts === 1 ? "" : "s"} and ${r.candidates} candidate${r.candidates === 1 ? "" : "s"} pruned in ${r.ms} ms`;

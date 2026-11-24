/**
 * R1326 hardening, pure: the clipper's retention and abandonment rules. No Prisma here; `retention.ts` applies them.
 *
 * - A job is CLOSED once nothing more will happen to it: failed, cancelled, or ready with the review done.
 *   `ready/review` is still the creator's desk and is never pruned.
 * - The clock starts when the job closed (`completedAt`, else `updatedAt`), never at creation, so a long review
 *   does not eat into the retention of the clips' material.
 * - Transcripts (the heaviest rows) go TRANSCRIPT_RETENTION_DAYS after close, for cancelled and ready/done jobs only.
 *   A FAILED job keeps its transcript: it can be retried or started again at its stage (settings-core), and detect
 *   needs the words (R1328 review; nothing re-transcribes on a retry). After pruning, a clip keeps its title, copy
 *   and plans, but "Regenerate copy", "Find in words", "Add your own clip" and approving a candidate answer NO_TRANSCRIPT.
 * - Suggested and rejected candidates go CANDIDATE_RETENTION_DAYS after close (failed jobs included: a retry detects
 *   afresh). Approved ones stay: a clip's candidate carries the reason and scores the feedback loop learns from.
 * - A running job whose executor has not reported for ABANDON_DAYS, or a queued job nobody started for as long, is
 *   cancelled by the sweep ("abandoned"), so it stops holding one of the owner's ACTIVE_JOBS_MAX slots (the slot
 *   count includes queued). A stall under that is the creator's to resume.
 * - Every pass is bounded (RETENTION_BATCH ids per table per sweep, ABANDON_BATCH jobs for the per-row abandon
 *   step); whatever is left waits for the next slot.
 */
export const TRANSCRIPT_RETENTION_DAYS = 90;
export const CANDIDATE_RETENTION_DAYS = 30;
export const ABANDON_DAYS = 7;
export const RETENTION_BATCH = 500;
/** The abandon step writes per job (update + event), so it takes fewer rows a run. */
export const ABANDON_BATCH = 100;
export const DAY_MS = 86_400_000;

export interface JobLike { status: string; stage: string; heartbeatAt: Date | null; updatedAt: Date; completedAt: Date | null }

export const isClosed = (j: { status: string; stage: string }) => j.status === "failed" || j.status === "cancelled" || (j.status === "ready" && j.stage === "done");
/** Closed for good: a failed job is closed but can still be retried, so its transcript is kept. */
export const isTerminal = (j: { status: string; stage: string }) => j.status === "cancelled" || (j.status === "ready" && j.stage === "done");

/** When the job closed, for the retention clock (null while it is open). */
export const closedAt = (j: JobLike): Date | null => (isClosed(j) ? (j.completedAt ?? j.updatedAt) : null);

export const retentionCutoffs = (now: Date) => ({
  transcripts: new Date(now.getTime() - TRANSCRIPT_RETENTION_DAYS * DAY_MS),
  candidates: new Date(now.getTime() - CANDIDATE_RETENTION_DAYS * DAY_MS),
  abandoned: new Date(now.getTime() - ABANDON_DAYS * DAY_MS),
});

export const transcriptExpired = (j: JobLike, now: Date) => {
  const c = closedAt(j);
  return isTerminal(j) && c !== null && c <= retentionCutoffs(now).transcripts;
};

export const candidatesExpired = (j: JobLike, now: Date) => {
  const c = closedAt(j);
  return c !== null && c <= retentionCutoffs(now).candidates;
};

/** Running with no executor report for ABANDON_DAYS (heartbeat, else the last update), or queued and untouched for as long. */
export const isAbandoned = (j: JobLike, now: Date) =>
  (j.status === "running" && (j.heartbeatAt ?? j.updatedAt) <= retentionCutoffs(now).abandoned) || (j.status === "queued" && j.updatedAt <= retentionCutoffs(now).abandoned);

export const ABANDONED_ERROR = `No progress was reported for ${ABANDON_DAYS} days, so this job was closed. Start it again from the video when you are ready.`;

export interface RetentionReport { abandoned: number; transcripts: number; candidates: number; ms: number }

/** One line for the sweep response and the admin log. */
export const retentionLine = (r: RetentionReport) =>
  `clipper retention: ${r.abandoned} abandoned job${r.abandoned === 1 ? "" : "s"} closed, ${r.transcripts} transcript${r.transcripts === 1 ? "" : "s"} and ${r.candidates} candidate${r.candidates === 1 ? "" : "s"} pruned in ${r.ms} ms`;

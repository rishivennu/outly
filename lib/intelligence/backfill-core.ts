/**
 * R1338: the upgrade backfill, pure. When a creator who has the engine reads /intelligence and their workspace profile
 * is missing or stale, the read kicks one background refresh (plan doc D9) so the profile exists the next time they
 * look, instead of waiting up to ten minutes for the sweep. The decision and the lock key live here so the route, the
 * sweep and the tests agree.
 */
export type BackfillVerdict = "kicked" | "fresh" | "locked" | "not-entitled" | "no-posts";

/** One kick per owner per this many minutes, whatever the read rate (the lock is a LearningEvent dedupe key). */
export const BACKFILL_LOCK_MINUTES = 30;

/** The dedupe key for the lock: the owner's next kick is allowed once the window turns. */
export function backfillLockKey(now: Date | number): string {
  const t = now instanceof Date ? now.getTime() : now;
  return `backfill:${Math.floor(t / (BACKFILL_LOCK_MINUTES * 60_000))}`;
}

/** Is a refresh due: no workspace profile, or one older than `staleMs`. */
export function backfillDue(profileComputedAt: Date | string | null | undefined, now: Date | number, staleMs: number): boolean {
  if (!profileComputedAt) return true;
  const t = now instanceof Date ? now.getTime() : now;
  return t - new Date(profileComputedAt).getTime() >= staleMs;
}

/** What the creator reads while the first profile is being built (spec §4): the cold-start line, then the honest why. */
export interface ColdStart {
  /** No workspace profile exists yet for this owner. */
  coldStart: boolean;
  /** What this read did about it. */
  backfill: BackfillVerdict | null;
}

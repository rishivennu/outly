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

/**
 * R1339: what the baselines card does while a backfill runs. The first profile is usually written within seconds of the
 * kick, so the card re-reads once early and once patiently, then stops and says so; no polling loop.
 */
export const BACKFILL_REFETCH_MS: readonly number[] = [20_000, 60_000];

/** A refresh is in flight for this owner: this read kicked it, or an earlier read's lock is still held. */
export function backfillRunning(backfill: BackfillVerdict | null | undefined): boolean {
  return backfill === "kicked" || backfill === "locked";
}

/** Whether the card should re-read after `attempt` re-reads so far (0 = none yet) and how long to wait first. */
export function baselinesRefetchDelay(input: { coldStart?: boolean | null; backfill?: BackfillVerdict | null } | null, attempt: number): number | null {
  if (!input || !input.coldStart || !backfillRunning(input.backfill)) return null;
  return attempt < BACKFILL_REFETCH_MS.length ? BACKFILL_REFETCH_MS[attempt] : null;
}

/**
 * The one notice the baselines card shows above its numbers, never two at once (R1339: the cold-start line used to
 * sit next to "Nothing measured yet", two explanations of the same empty card). Platform cards, when there are any,
 * render under the notice regardless.
 */
export type BaselinesNotice = "loading" | "error" | "cold-start" | "empty" | null;
export function baselinesNotice(input: { data: { coldStart?: boolean | null; platforms: readonly unknown[] } | null; error: string | null }): BaselinesNotice {
  if (input.data) {
    if (input.data.coldStart) return "cold-start";
    return input.data.platforms.length ? null : "empty";
  }
  return input.error ? "error" : "loading";
}

/** The sentence after the cold-start line: what is happening and whether the card will look again by itself. */
export function coldStartDetail(backfill: BackfillVerdict | null | undefined, attempt: number): string {
  if (backfillRunning(backfill)) {
    if (attempt === 0) return "Your first profile is being built now; this card checks again in a moment.";
    if (attempt < BACKFILL_REFETCH_MS.length) return "Still building; this card checks again shortly.";
    return "Still building. Come back in a few minutes and this card will have filled in.";
  }
  if (backfill === "no-posts") return "It starts with your first published post that has a day of numbers.";
  return "";
}

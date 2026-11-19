/**
 * R1219: a post's lifecycle, read from what Outlly already stores. Kept apart from `Post.status` (what publishing
 * did) and from each destination's `platformStatus` (what the platform said), so the three never fight:
 *
 *   draft, scheduled, queued, uploading, publishing, published, failed   come from publishing;
 *   archived                                                             the creator took it out of the active views;
 *   deleted                                                              every live copy is gone from its platform
 *                                                                        (taken down from here, or found gone there);
 *   needs_verification                                                   a platform said "no such post" once; Outlly
 *                                                                        checks again before it believes that;
 *   unavailable                                                          the platform can't be asked right now
 *                                                                        (account disconnected) so the state is unknown.
 *
 * Pure: no server imports, so the Content library can label a card with it in the browser.
 */
export const LIFECYCLES = ["draft", "scheduled", "queued", "uploading", "publishing", "published", "archived", "deleted", "failed", "unavailable", "needs_verification"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export type VerifyState = "needs_verification" | "unavailable";

export interface LifecycleTarget {
  status: string;
  removeMode?: string | null;
  verifyState?: string | null;
  platformPostId?: string | null;
}
export interface LifecyclePost {
  status: string;
  archivedAt?: string | Date | null;
  targets: LifecycleTarget[];
}

const wasLive = (t: LifecycleTarget) => t.status === "published" && !!t.platformPostId;
const gone = (t: LifecycleTarget) => t.removeMode === "deleted";

export function lifecycleOf(p: LifecyclePost): Lifecycle {
  if (p.archivedAt) return "archived";
  const live = p.targets.filter(wasLive);
  if (live.length && live.every(gone)) return "deleted";
  const open = live.filter((t) => !gone(t));
  if (open.some((t) => t.verifyState === "needs_verification")) return "needs_verification";
  if (open.some((t) => t.verifyState === "unavailable")) return "unavailable";
  switch (p.status) {
    case "draft":
      return "draft";
    case "scheduled":
      return "scheduled";
    case "publishing": {
      const s = p.targets.map((t) => t.status);
      if (s.some((x) => x === "uploading")) return "uploading";
      if (s.some((x) => x === "processing" || x === "published")) return "publishing";
      return "queued";
    }
    case "published":
      return "published";
    default:
      return "failed";
  }
}

/** Short, honest label for a card badge. */
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  queued: "Queued",
  uploading: "Uploading",
  publishing: "Publishing",
  published: "Published",
  archived: "Archived",
  deleted: "Deleted",
  failed: "Failed",
  unavailable: "Can't check",
  needs_verification: "Needs verification",
};

/** Two misses this far apart before a destination is recorded as deleted on its platform. */
export const CONFIRM_MS = 15 * 60_000;

export type VerifyOutcome = "live" | "missing" | "unavailable" | "unsupported" | { error: string };

export interface VerifyRow {
  platformUrl: string | null;
  removeMode: string | null;
  verifyState: string | null;
  missingSince: Date | null;
}

/**
 * What one check changes on a destination. One "not found" only marks it needs_verification; a second one at least
 * CONFIRM_MS after the first records the delete (removedVia "platform"), keeping the last public URL. Seeing it
 * again clears everything. A rate limit or an outage changes nothing but the error code.
 */
export function nextVerify(t: VerifyRow, outcome: VerifyOutcome, now: Date): Record<string, unknown> & { confirmedGone?: boolean } {
  if (t.removeMode === "deleted") return {};
  if (outcome === "live") return { verifyState: null, missingSince: null, lastVerifiedAt: now, lastSyncError: null };
  if (outcome === "unavailable") return { verifyState: "unavailable", lastSyncError: "NOT_CONNECTED" };
  if (outcome === "unsupported") return {};
  if (typeof outcome === "object") return { lastSyncError: outcome.error.slice(0, 40) };
  // missing
  const first = t.missingSince;
  if (first && now.getTime() - first.getTime() >= CONFIRM_MS) {
    return {
      removeMode: "deleted",
      removedVia: "platform",
      removedAt: now,
      lastUrl: t.platformUrl,
      platformUrl: null,
      verifyState: null,
      lastVerifiedAt: now,
      lastSyncError: null,
      confirmedGone: true,
    };
  }
  return { verifyState: "needs_verification", missingSince: first ?? now, lastSyncError: "NOT_FOUND" };
}

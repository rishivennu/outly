import { copyChanged, type CopyShape } from "../collab-core";

/** Two bookings of the same media on one account closer than this are treated as the same post twice. */
export const CONFLICT_WINDOW_MS = 10 * 60_000;

export interface ServerDraft {
  id: string;
  title: string | null;
  story: string | null;
  hook: string | null;
  updatedAt: string;
  targets: { platform: string; socialAccountId: string | null; title: string | null; caption: string | null; description: string | null; hashtags: string | null; firstComment: string | null; enabled: boolean }[];
}

type StoredPost = {
  id: string;
  mediaId: string;
  title: string | null;
  story: string | null;
  hook: string | null;
  updatedAt: Date;
  targets: { platform: string; socialAccountId: string | null; title: string | null; caption: string | null; description: string | null; hashtags: string | null; firstComment: string | null }[];
};

/** The stored version, as the device needs it to show "theirs" next to "yours". Every stored target is switched on. */
export function serverDraft(p: StoredPost): ServerDraft {
  return {
    id: p.id,
    title: p.title,
    story: p.story,
    hook: p.hook,
    updatedAt: p.updatedAt.toISOString(),
    targets: p.targets.map((t) => ({ platform: t.platform, socialAccountId: t.socialAccountId, title: t.title, caption: t.caption, description: t.description, hashtags: t.hashtags, firstComment: t.firstComment, enabled: true })),
  };
}

/**
 * A device saves an edit made on top of `baseUpdatedAt`. It is a conflict only when the post changed since then
 * AND the edit would overwrite something different (an autosave that repeats what is stored is not one).
 * No base (older clients) never conflicts. `replaceTargets` = the edit is the full destination list (POST save).
 */
export function draftConflict(stored: StoredPost, edit: CopyShape, baseUpdatedAt: string | null | undefined, opts: { replaceTargets?: boolean } = {}): ServerDraft | null {
  if (!baseUpdatedAt) return null;
  const base = Date.parse(baseUpdatedAt);
  if (!Number.isFinite(base) || stored.updatedAt.getTime() <= base) return null;
  return copyChanged(stored, edit, opts) ? serverDraft(stored) : null;
}

/**
 * Thrown inside a save's transaction when the post changed between reading it and writing it (another device
 * saved in that moment). The route answers with the same 409 draft_conflict as a stale base.
 */
export class StaleDraftError extends Error {
  constructor() {
    super("draft changed while saving");
  }
}

export const DRAFT_CONFLICT_MESSAGE = "This draft was changed somewhere else. Pick which version to keep.";

export interface Booking {
  postId: string;
  title: string | null;
  mediaId: string;
  accountId: string;
  platform: string;
  scheduledAt: Date;
}
export interface ScheduleConflict {
  postId: string;
  title: string;
  scheduledAt: string;
  platform: string;
}

/**
 * Other bookings that would send the same media to the same account within CONFLICT_WINDOW_MS of `at`.
 * `want` = the accounts this post goes out on. One entry per other post and platform.
 */
export function scheduleConflicts(input: { postId: string | null; mediaId: string; at: Date; want: { accountId: string; platform: string }[]; booked: Booking[] }): ScheduleConflict[] {
  const accounts = new Set(input.want.map((w) => w.accountId));
  const seen = new Set<string>();
  const out: ScheduleConflict[] = [];
  for (const b of input.booked) {
    if (b.postId === input.postId || b.mediaId !== input.mediaId || !accounts.has(b.accountId)) continue;
    if (Math.abs(b.scheduledAt.getTime() - input.at.getTime()) >= CONFLICT_WINDOW_MS) continue;
    const key = `${b.postId}:${b.platform}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ postId: b.postId, title: (b.title || "Untitled post").split("\n")[0].slice(0, 90), scheduledAt: b.scheduledAt.toISOString(), platform: b.platform });
  }
  return out;
}

export const conflictMessage = (n: number) =>
  n === 1
    ? "The same media is already booked on this account within 10 minutes of that time. Pick another time, or move the other post."
    : `The same media is already booked on this account ${n} times within 10 minutes of that time. Pick another time.`;

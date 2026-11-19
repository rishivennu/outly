import "server-only";
import { attachAdaptation, ensureItemForPost, type ContentOrigin } from "./memory";
import { linkOutcome } from "./outcome";

// R1234: Content Memory is a side record of a save, so a lineage failure is logged with a short code and swallowed:
// it never fails the create that called it.
async function guarded<T>(code: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    console.warn(`[lineage] ${code}`, e instanceof Error ? e.message : e);
    return null;
  }
}

export interface CreatedFrom {
  adaptedFromPostId?: string | null;
  /** R1241: the recommendation the composer was opened from; linked for outcomes once the item exists. */
  recommendationId?: string | null;
}

/**
 * Files a freshly created post in Content Memory. Adapted from another post of the owner: it joins that post's item
 * directly (no throwaway item of its own first). Otherwise, or when the source is not the owner's, it gets its own item.
 * `from` may be the source post id alone (Duplicate, bulk) or both ids (the composer).
 */
export async function lineageAfterCreate(ownerId: string, postId: string, from?: string | null | CreatedFrom, opts: { origin?: ContentOrigin } = {}): Promise<void> {
  const origin = opts.origin ?? "manual";
  const { adaptedFromPostId, recommendationId } = typeof from === "object" && from ? from : { adaptedFromPostId: from, recommendationId: null };
  const attached = !!adaptedFromPostId && !!(await guarded("attach_failed", () => attachAdaptation(ownerId, adaptedFromPostId, postId, { origin })));
  if (!attached) await guarded("ensure_failed", () => ensureItemForPost(ownerId, postId, { origin }));
  // R1241: after the item, since the link reads the post's variation. A foreign or bad id is a no-op, never a failed save.
  if (recommendationId) await guarded("outcome_link_failed", () => linkOutcome(ownerId, recommendationId, postId));
}

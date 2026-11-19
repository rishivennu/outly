import "server-only";
import { attachAdaptation, ensureItemForPost, type ContentOrigin } from "./memory";

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

/**
 * Files a freshly created post in Content Memory. Adapted from another post of the owner: it joins that post's item
 * directly (no throwaway item of its own first). Otherwise, or when the source is not the owner's, it gets its own item.
 */
export async function lineageAfterCreate(ownerId: string, postId: string, adaptedFromPostId?: string | null, opts: { origin?: ContentOrigin } = {}): Promise<void> {
  const origin = opts.origin ?? "manual";
  if (adaptedFromPostId && (await guarded("attach_failed", () => attachAdaptation(ownerId, adaptedFromPostId, postId, { origin })))) return;
  await guarded("ensure_failed", () => ensureItemForPost(ownerId, postId, { origin }));
}

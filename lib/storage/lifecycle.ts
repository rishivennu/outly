import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { storage } from "./index";
import { cleanupDelay } from "../account-cleanup-core";
import { DRAFT_TTL_DAYS } from "../domain";
import { entitlements } from "../billing/entitlements";
import { consumedBytes, cycleFor, mediaBytes, storedBytes } from "./quota";
import { MB, TRASH_DAYS, monthlyAllowanceMb, usesStorage } from "./quota-core";

/**
 * R1209: what happens to an uploaded file after it lands. Active, then (optionally) Trash, then deleted for good.
 * Trash is only a database mark: the file stays, still counts toward storage and can be restored. A permanent
 * delete removes the object from the bucket FIRST and the row only after that succeeded ("already gone" counts as
 * success), so storage is never shown as freed while the file still exists. A failed bucket call leaves the file
 * counted, queues a StorageCleanup row the minute sweeper retries, and answers with a retryable error.
 * Free monthly upload consumption is never given back by any of this: it lives in UploadLedger.
 */
const DAY = 864e5;

export const purgeAt = (deletedAt: Date) => new Date(deletedAt.getTime() + TRASH_DAYS * DAY);

const retry = () =>
  new HttpError(503, "We couldn't delete the file just now, so it still counts toward your storage. We'll keep trying in the background, or try again in a minute.", "delete_retry", { retryable: true });

/** Removes every key from the bucket; a failure queues a retry row tied to the media. */
async function removeKeys(keys: (string | null | undefined)[], ref: { userId: string; mediaId?: string }, now = new Date()) {
  const failed: string[] = [];
  for (const key of [...new Set(keys.filter((k): k is string => !!k && !k.startsWith("/") && !k.startsWith("sample/")))]) {
    try {
      await storage.remove(key);
    } catch (e) {
      failed.push(key);
      const open = await db.storageCleanup.findFirst({ where: { key, doneAt: null, purpose: "media" }, select: { id: true } });
      if (!open)
        await db.storageCleanup.create({ data: { key, purpose: "media", userId: ref.userId, mediaId: ref.mediaId ?? null, attempts: 1, nextAt: new Date(now.getTime() + cleanupDelay(1)), lastError: String((e as Error)?.message ?? e).slice(0, 300) } }).catch((err) => console.error("[storage] queue cleanup", key, err));
    }
  }
  return failed;
}

const unused = { posts: { none: {} }, postItems: { none: {} } } as const;

async function usedBy(mediaId: string) {
  const [posts, items] = await Promise.all([
    db.post.findMany({ where: { mediaId }, select: { id: true, title: true, status: true } }),
    db.postMedia.findMany({ where: { mediaId }, select: { post: { select: { id: true, title: true, status: true } } } }),
  ]);
  const all = new Map<string, { id: string; title: string | null; status: string }>();
  for (const p of [...posts, ...items.map((i) => i.post)]) all.set(p.id, p);
  return [...all.values()];
}

async function paidStorage(userId: string) {
  return usesStorage((await entitlements(userId)).quotaPolicy);
}

async function owned(userId: string, mediaId: string) {
  return db.media.findFirst({ where: { id: mediaId, userId } });
}

const inUse = (posts: { status: string }[]) =>
  new HttpError(409, `This file is used by ${posts.length === 1 ? (posts[0]!.status === "draft" ? "a draft" : "a post") : `${posts.length} posts or drafts`}. Delete the draft (and choose to delete its media) instead, so nothing is left pointing at a missing file.`, "in_use", { posts });

/** Moves a file to Trash. Storage is not freed until it is deleted for good. Repeating it changes nothing. */
export async function trashMedia(userId: string, mediaId: string, now = new Date()) {
  const m = await owned(userId, mediaId);
  if (!m) throw new HttpError(404, "We couldn't find that file.", "NOT_FOUND");
  if (m.status === "uploading") throw new HttpError(409, "That file is still uploading. Cancel the upload instead.", "uploading");
  const posts = await usedBy(m.id);
  if (posts.length) throw inUse(posts);
  if (!m.deletedAt) await db.media.updateMany({ where: { id: m.id, deletedAt: null }, data: { deletedAt: now } });
  const at = (await db.media.findUnique({ where: { id: m.id }, select: { deletedAt: true } }))?.deletedAt ?? now;
  return { ok: true as const, status: "trash" as const, purgeAt: purgeAt(at).toISOString(), freedBytes: 0 };
}

export async function restoreMedia(userId: string, mediaId: string) {
  const m = await owned(userId, mediaId);
  if (!m) throw new HttpError(404, "We couldn't find that file.", "NOT_FOUND");
  if (!m.deletedAt) return { ok: true as const, status: "active" as const };
  if (await db.storageCleanup.count({ where: { mediaId: m.id, doneAt: null } })) throw new HttpError(409, "That file is already being deleted, so it can't be restored.", "deleting");
  await db.media.update({ where: { id: m.id }, data: { deletedAt: null } });
  return { ok: true as const, status: "active" as const };
}

/**
 * Deletes a file for good: bucket first, row after. A second request for the same file finds nothing and is still
 * a success that frees nothing, so a double click never counts twice. `refunded` = paid storage went back up.
 */
export async function purgeMedia(userId: string, mediaId: string, now = new Date()) {
  const m = await owned(userId, mediaId);
  if (!m) return { ok: true as const, alreadyGone: true, freedBytes: 0, refunded: false };
  if (m.status === "uploading") throw new HttpError(409, "That file is still uploading. Cancel the upload instead.", "uploading");
  const posts = await usedBy(m.id);
  if (posts.length) throw inUse(posts);
  if (!m.deletedAt) await db.media.updateMany({ where: { id: m.id, deletedAt: null }, data: { deletedAt: now } });
  if ((await removeKeys([m.storageKey, m.thumbnailKey], { userId, mediaId: m.id }, now)).length) throw retry();
  const gone = await db.media.deleteMany({ where: { id: m.id, userId, ...unused } });
  await db.storageCleanup.updateMany({ where: { mediaId: m.id, doneAt: null }, data: { doneAt: now, lastError: null } });
  const freedBytes = gone.count ? mediaBytes(m) : 0;
  return { ok: true as const, alreadyGone: gone.count === 0, freedBytes, refunded: freedBytes > 0 && (await paidStorage(userId)) };
}

/** After the sweeper removed the last pending object of a purge, the row goes too (only if nothing uses it). */
export async function finishMediaPurge(mediaId: string) {
  if (await db.storageCleanup.count({ where: { mediaId, doneAt: null } })) return false;
  const r = await db.media.deleteMany({ where: { id: mediaId, deletedAt: { not: null }, ...unused } });
  return r.count === 1;
}

/**
 * Start Over "Delete" (and Storage Manager "Delete draft, and its media"). Only a post that hasn't gone out:
 * published content keeps its original video unless the creator removes it on purpose later. The files go first
 * (owned by this account and not used by any other post), then the post (lib/posts/delete.ts stops anything booked),
 * then the media rows. A file the bucket refuses is queued for the cleanup sweeper and its row stays, so its bytes are
 * still counted (`pendingBytes`) until the file is really gone; the sweeper then drops the row (finishMediaPurge).
 * The draft goes either way: keeping it would leave it pointing at a video the sweeper is about to delete.
 */
export async function deleteDraftWithMedia(user: { id: string; role?: string | null }, postId: string, now = new Date()) {
  const { deletePost } = await import("../posts/delete");
  const post = await db.post.findFirst({ where: { id: postId, userId: user.id }, include: { targets: true, items: true } });
  if (!post) return { ok: true as const, local: "already_gone" as const, freedBytes: 0, refunded: false, media: { deleted: 0, kept: 0 } };
  const { assertPostScope } = await import("../profiles");
  await assertPostScope(user.id, post.targets);
  if (post.targets.some((t) => ["processing", "published"].includes(t.platformStatus)) || ["publishing", "published", "partial"].includes(post.status))
    throw new HttpError(409, "This post has already gone out, so its video is kept. Delete the post first, then remove the video in Settings, Storage.", "published");
  const ids = [...new Set([post.mediaId, ...post.items.map((i) => i.mediaId)])];
  const media = await db.media.findMany({ where: { id: { in: ids }, userId: user.id } });
  const elsewhere = new Set(
    [
      ...(await db.post.findMany({ where: { mediaId: { in: ids }, id: { not: post.id } }, select: { mediaId: true } })).map((p) => p.mediaId),
      ...(await db.postMedia.findMany({ where: { mediaId: { in: ids }, postId: { not: post.id } }, select: { mediaId: true } })).map((p) => p.mediaId),
    ],
  );
  const doomed = media.filter((m) => !elsewhere.has(m.id) && m.status !== "uploading");
  const waiting = new Set<string>();
  for (const m of doomed) {
    await db.media.updateMany({ where: { id: m.id, deletedAt: null }, data: { deletedAt: now } });
    if ((await removeKeys([m.storageKey, m.thumbnailKey], { userId: user.id, mediaId: m.id }, now)).length) waiting.add(m.id);
  }
  await removeKeys([post.coverKey], { userId: user.id }, now); // a refused cover is queued; it holds no counted bytes
  const result = await deletePost(user, post.id, { platforms: false, appOnlyAck: false });
  const done = doomed.filter((m) => !waiting.has(m.id)).map((m) => m.id);
  const gone = done.length ? await db.media.deleteMany({ where: { id: { in: done }, userId: user.id, ...unused } }) : { count: 0 };
  if (done.length) await db.storageCleanup.updateMany({ where: { mediaId: { in: done }, doneAt: null }, data: { doneAt: now, lastError: null } });
  const left = new Set((await db.media.findMany({ where: { id: { in: done } }, select: { id: true } })).map((m) => m.id));
  const freedBytes = doomed.filter((m) => done.includes(m.id) && !left.has(m.id)).reduce((a, m) => a + mediaBytes(m), 0);
  const pendingBytes = doomed.filter((m) => waiting.has(m.id)).reduce((a, m) => a + mediaBytes(m), 0);
  return {
    ...result,
    freedBytes,
    pendingBytes,
    refunded: freedBytes > 0 && (await paidStorage(user.id)),
    media: { deleted: gone.count, pending: waiting.size, kept: media.length - gone.count - waiting.size },
  };
}

/**
 * Daily (retention cron): finished uploads no post or draft uses, older than DRAFT_TTL_DAYS, move to Trash.
 * Saved drafts are never deleted by this job any more; their media stays as long as the draft does.
 */
export async function trashOrphanMedia(now = new Date()) {
  const r = await db.media.updateMany({
    where: { deletedAt: null, status: { notIn: ["uploading", "failed"] }, createdAt: { lt: new Date(now.getTime() - DRAFT_TTL_DAYS * DAY) }, ...unused, NOT: { storageKey: { startsWith: "sample/" } } },
    data: { deletedAt: now },
  });
  return r.count;
}

/** Daily: Trash older than TRASH_DAYS is deleted for good (bucket first). One a post picked up again goes back to active. */
export async function purgeTrash(now = new Date(), batch = 100) {
  const due = await db.media.findMany({ where: { deletedAt: { lt: new Date(now.getTime() - TRASH_DAYS * DAY) } }, orderBy: { deletedAt: "asc" }, take: batch });
  let purged = 0;
  let restored = 0;
  let queued = 0;
  for (const m of due) {
    if ((await usedBy(m.id)).length) {
      await db.media.update({ where: { id: m.id }, data: { deletedAt: null } });
      restored++;
      continue;
    }
    if (await db.storageCleanup.count({ where: { mediaId: m.id, doneAt: null } })) continue; // the sweeper is on it
    if ((await removeKeys([m.storageKey, m.thumbnailKey], { userId: m.userId, mediaId: m.id }, now)).length) {
      queued++;
      continue;
    }
    const r = await db.media.deleteMany({ where: { id: m.id, ...unused } });
    purged += r.count;
  }
  return { purged, restored, queued };
}

/**
 * Daily: the cycle that just ended is written to UsageCycle once per account (unique userId + cycleKey, so a
 * second run that day, or a retry, adds nothing). Nothing is deleted and nothing is reset here: a new cycle starts
 * by itself because the counter only sums uploads inside the current window.
 */
export async function closeUsageCycles(now = new Date(), opts: { limit?: number; userIds?: string[] } = {}) {
  const since = new Date(now.getTime() - 70 * DAY);
  const limit = opts.limit ?? 2000;
  const users = opts.userIds ? new Set(opts.userIds) : new Set([
    ...(await db.uploadLedger.groupBy({ by: ["userId"], where: { at: { gte: since } }, orderBy: { userId: "asc" }, take: limit })).map((r) => r.userId),
    ...(await db.media.groupBy({ by: ["userId"], where: { status: { notIn: ["uploading", "failed"] } }, orderBy: { userId: "asc" }, take: limit })).map((r) => r.userId),
  ]);
  let written = 0;
  for (const userId of users) {
    try {
      const e = await entitlements(userId);
      const current = await cycleFor(userId, e, now);
      const prev = await cycleFor(userId, e, new Date(current.start.getTime() - 1));
      const user = await db.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
      if (!user || prev.end <= user.createdAt || prev.end > now) continue;
      if (await db.usageCycle.findUnique({ where: { userId_cycleKey: { userId, cycleKey: prev.key } }, select: { id: true } })) continue;
      const [{ used, extra }, kept] = await Promise.all([consumedBytes(userId, prev), storedBytes(userId)]);
      const allowance = monthlyAllowanceMb(e.uploadMonthlyMb);
      await db.usageCycle.create({
        data: {
          userId, cycleKey: prev.key, startsAt: prev.start, endsAt: prev.end, planSlug: e.planSlug, policy: e.quotaPolicy,
          uploadedBytes: BigInt(used), storedBytes: BigInt(kept.stored), allowanceBytes: BigInt(allowance > 0 ? allowance * MB + extra : 0), capacityBytes: BigInt(Math.max(0, e.storageMb) * MB), closedAt: now,
        },
      });
      written++;
    } catch (err) {
      if ((err as { code?: string } | null)?.code !== "P2002") console.error("[usage-cycle]", userId, err);
    }
  }
  return written;
}

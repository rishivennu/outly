import "server-only";
import type { Media, Post, PostTarget, ReviewRequest, SocialAccount } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./http";
import { storage } from "./storage";
import { isPlatform, PLATFORMS, type Platform } from "./domain";
import { enqueue } from "./queue";
import { syncPost } from "./queue/handlers";
import type { SimulationMode } from "./social/types";
import { isPracticeAccount } from "./social/registry";
import { assertApproved, reviewView } from "./review";

/* ---------- client-safe shapes (no tokens, no storage keys) ---------- */

export type MediaView = Awaited<ReturnType<typeof mediaView>>;
/** A missing or unreachable object should show a placeholder, not crash the page. */
async function safeSignedUrl(key: string) {
  try {
    return await storage.signedUrl(key, 6 * 3600);
  } catch (e) {
    console.warn(`[media] no signed URL for ${key}: ${(e as Error).message}`);
    return null;
  }
}

export async function mediaView(m: Media) {
  // both signatures in parallel (and batched with every other view on the page)
  const [url, thumbnailUrl] = await Promise.all([
    m.storageKey.startsWith("sample/") ? null : safeSignedUrl(m.storageKey),
    m.thumbnailKey ? (m.thumbnailKey.startsWith("/") ? m.thumbnailKey : safeSignedUrl(m.thumbnailKey)) : null,
  ]);
  return {
    id: m.id,
    filename: m.originalFilename,
    mimeType: m.mimeType,
    size: m.size,
    duration: m.duration,
    width: m.width,
    height: m.height,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    url,
    thumbnailUrl,
  };
}

export function targetView(t: PostTarget) {
  return {
    id: t.id,
    platform: t.platform as Platform,
    title: t.title,
    caption: t.caption,
    description: t.description,
    hashtags: t.hashtags,
    status: t.platformStatus,
    platformPostId: t.platformPostId,
    url: t.platformUrl,
    practice: t.practice,
    errorCode: t.errorCode,
    errorDetail: t.errorMessage,
    attempts: t.attempts,
    publishedAt: t.publishedAt?.toISOString() ?? null,
  };
}
export type TargetView = ReturnType<typeof targetView>;

export async function postView(p: Post & { targets: PostTarget[]; media: Media; reviews?: ReviewRequest[] }) {
  // reviews are only included by loaders that need them; undefined means "not loaded", not "none".
  const reviews = p.reviews ? [...p.reviews].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) : null;
  return {
    id: p.id,
    title: p.title,
    story: p.story,
    hook: p.hook,
    status: p.status,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    requireApproval: p.requireApproval,
    review: reviews ? (reviews[0] ? reviewView(reviews[0]) : null) : null,
    approved: reviews ? reviews.some((r) => r.status === "approved") : false,
    media: await mediaView(p.media),
    targets: [...p.targets].sort((a, b) => PLATFORMS.indexOf(a.platform as Platform) - PLATFORMS.indexOf(b.platform as Platform)).map(targetView),
  };
}
export type PostView = Awaited<ReturnType<typeof postView>>;

export function accountView(a: SocialAccount) {
  return {
    id: a.id,
    platform: a.platform as Platform,
    username: a.username,
    displayName: a.displayName,
    avatar: a.avatar,
    status: a.status,
    /** Practice (rehearsal) account: publishing to it never touches the real platform. */
    mock: isPracticeAccount(a),
    connectedAt: a.createdAt.toISOString(),
  };
}
export type AccountView = ReturnType<typeof accountView>;

/* ---------- ownership-scoped loaders: every lookup filters by userId ---------- */

export async function ownedMedia(userId: string, id: string) {
  const m = await db.media.findFirst({ where: { id, userId } });
  if (!m) throw new HttpError(404, "We couldn't find that video.");
  return m;
}

export async function ownedPost(userId: string, id: string) {
  const p = await db.post.findFirst({ where: { id, userId }, include: { targets: true, media: true, reviews: { orderBy: { createdAt: "desc" } } } });
  if (!p) throw new HttpError(404, "We couldn't find that post.");
  return p;
}

export async function ownedTarget(userId: string, id: string) {
  const t = await db.postTarget.findFirst({ where: { id, post: { userId } }, include: { post: true } });
  if (!t) throw new HttpError(404, "We couldn't find that destination.");
  return t;
}

/* ---------- launch / retry ---------- */

export async function connectedAccounts(userId: string) {
  const accts = await db.socialAccount.findMany({ where: { userId } });
  const map = new Map<Platform, SocialAccount>();
  for (const a of accts) if (isPlatform(a.platform)) map.set(a.platform, a);
  return map;
}

export async function launchPost(userId: string, postId: string, mode: "now" | "schedule", scheduledAt: Date | null, simulate: SimulationMode) {
  const post = await ownedPost(userId, postId);
  if (post.targets.length === 0) throw new HttpError(400, "Pick at least one place to send it.");
  if (["publishing", "published"].includes(post.status)) throw new HttpError(409, "This one is already on its way.");
  // Approval is checked for "schedule" too: a scheduled post that nobody approved would only fail later.
  await assertApproved(post);
  const accounts = await connectedAccounts(userId);
  const missing = post.targets.filter((t) => accounts.get(t.platform as Platform)?.status !== "connected");
  if (missing.length) {
    const p = missing[0].platform as Platform;
    throw new HttpError(409, `${p === "x" ? "X" : p[0].toUpperCase() + p.slice(1)} needs you to reconnect first.`, "NOT_CONNECTED");
  }

  if (mode === "schedule") {
    if (!scheduledAt || scheduledAt.getTime() < Date.now() + 60_000) throw new HttpError(400, "Pick a time at least a minute from now.");
    await db.$transaction([
      db.post.update({ where: { id: post.id }, data: { status: "scheduled", scheduledAt } }),
      ...post.targets.map((t) =>
        db.postTarget.update({ where: { id: t.id }, data: { platformStatus: "pending", socialAccountId: accounts.get(t.platform as Platform)!.id, errorCode: null, errorMessage: null, attempts: 0 } }),
      ),
    ]);
    await enqueue("SCHEDULED_POST", { postId: post.id }, { delayMs: scheduledAt.getTime() - Date.now(), jobId: `sched-${post.id}-${scheduledAt.getTime()}` });
    return;
  }

  // Send now: create records first, return immediately, workers do the rest.
  await db.$transaction([
    db.post.update({ where: { id: post.id }, data: { status: "publishing", scheduledAt: null } }),
    ...post.targets.map((t) =>
      db.postTarget.update({ where: { id: t.id }, data: { platformStatus: "queued", socialAccountId: accounts.get(t.platform as Platform)!.id, errorCode: null, errorMessage: null, attempts: 0, uploadRef: null, publishRequestedAt: null } }),
    ),
  ]);
  for (const t of post.targets) await enqueue("SOCIAL_UPLOAD", { targetId: t.id, platform: t.platform as Platform, simulate });
}

export async function retryTarget(userId: string, targetId: string) {
  const t = await ownedTarget(userId, targetId);
  if (t.platformStatus !== "failed") throw new HttpError(409, "Nothing to retry here.");
  const acct = await db.socialAccount.findFirst({ where: { userId, platform: t.platform } });
  if (!acct || acct.status !== "connected") throw new HttpError(409, "Reconnect the account first.", "NOT_CONNECTED");
  // Keep the platform-side upload (and the publish marker) unless the media itself was the problem, so a retry
  // resumes/reconciles instead of creating a second copy.
  const restart = t.errorCode === "MEDIA_REJECTED" || t.socialAccountId !== acct.id;
  await db.postTarget.update({
    where: { id: t.id },
    data: { platformStatus: "queued", socialAccountId: acct.id, errorCode: null, errorMessage: null, attempts: 0, ...(restart ? { uploadRef: null, publishRequestedAt: null } : {}) },
  });
  await syncPost(t.postId);
  // Retries run without simulated faults so the recovery path can be rehearsed end to end.
  await enqueue("SOCIAL_UPLOAD", { targetId: t.id, platform: t.platform as Platform, simulate: "smooth" });
}

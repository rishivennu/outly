import "server-only";
import type { Media, Post, PostTarget, ReviewRequest, SocialAccount } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./http";
import { storage } from "./storage";
import { isPlatform, PLATFORMS, REMOVAL, STOPPABLE, type Platform, type RemoveMode } from "./domain";
import { enqueue } from "./queue";
import { spendPost } from "./billing/entitlements";
import { syncPost } from "./queue/handlers";
import type { SimulationMode } from "./social/types";
import { isPracticeAccount } from "./social/registry";
import { assertApproved, reviewView } from "./review";
import { assertPostScope, requestScope } from "./profiles";
import { pickAccount, type Scope } from "./profiles-core";
import { approvalCurrent } from "./collab-core";

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
    firstComment: t.firstComment,
    /** posted | failed | waiting (set, not yet live) | null (none). */
    firstCommentState: !t.firstComment?.trim() ? null : t.firstCommentId ? ("posted" as const) : t.firstCommentError ? ("failed" as const) : ("waiting" as const),
    firstCommentError: t.firstCommentError,
    status: t.platformStatus,
    platformPostId: t.platformPostId,
    url: t.platformUrl,
    practice: t.practice,
    errorCode: t.errorCode,
    errorDetail: t.errorMessage,
    attempts: t.attempts,
    publishedAt: t.publishedAt?.toISOString() ?? null,
    /** Taken down on the platform through Outlly: deleted, or hidden (YouTube private). */
    removeMode: (t.removeMode as RemoveMode | null) ?? null,
    removedAt: t.removedAt?.toISOString() ?? null,
    /** What the creator can do to the live post from here (Instagram and TikTok: neither, open the app). */
    canDelete: t.platformStatus === "published" && !!t.platformPostId && t.removeMode !== "deleted" && isPlatform(t.platform) && REMOVAL[t.platform].delete,
    canHide: t.platformStatus === "published" && !!t.platformPostId && t.removeMode !== "deleted" && isPlatform(t.platform) && REMOVAL[t.platform].hide,
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
    approved: reviews ? approvalCurrent(reviews, p.editedAt) : false,
    /** 1037: who last changed the copy, so a teammate knows whose version they're approving. */
    editedBy: p.editedBy,
    editedAt: p.editedAt?.toISOString() ?? null,
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
  await assertPostScope(userId, p.targets); // 1037: a member limited to some accounts sees only their posts
  return p;
}

export async function ownedTarget(userId: string, id: string) {
  const t = await db.postTarget.findFirst({ where: { id, post: { userId } }, include: { post: true } });
  if (!t) throw new HttpError(404, "We couldn't find that destination.");
  await assertPostScope(userId, [t]).catch(() => {
    throw new HttpError(404, "We couldn't find that destination.");
  });
  return t;
}

/* ---------- launch / retry ---------- */

/**
 * The default account per platform: the first one connected that is still connected. With one account per
 * platform (every plan before 1037) that is simply the account. A destination tied to a specific account
 * (multi-account plans) goes out there instead; see accountForTarget.
 */
export async function connectedAccounts(userId: string) {
  const accts = await db.socialAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const map = new Map<Platform, SocialAccount>();
  for (const a of accts) {
    if (!isPlatform(a.platform)) continue;
    const cur = map.get(a.platform);
    if (!cur || (cur.status !== "connected" && a.status === "connected")) map.set(a.platform, a);
  }
  return Object.assign(map, { all: accts });
}

/** The account one destination goes out on: its own account, else the platform default the person may use. */
export function accountForTarget(t: Pick<PostTarget, "platform" | "socialAccountId">, all: SocialAccount[], scope: Scope) {
  return pickAccount(t.platform, t.socialAccountId, all, scope);
}

export async function launchPost(userId: string, postId: string, mode: "now" | "schedule", scheduledAt: Date | null, simulate: SimulationMode) {
  const post = await ownedPost(userId, postId);
  if (post.targets.length === 0) throw new HttpError(400, "Pick at least one place to send it.");
  if (["publishing", "published"].includes(post.status)) throw new HttpError(409, "This one is already on its way.");
  // Approval is checked for "schedule" too: a scheduled post that nobody approved would only fail later.
  await assertApproved(post);
  // A partial post sent again (Fix it) must only send what isn't live yet: resetting a live destination to
  // "queued" uploaded and published it a second time, a duplicate on the creator's own account (1028 review).
  const toSend = post.targets.filter((t) => t.platformStatus !== "published");
  if (toSend.length === 0) throw new HttpError(409, "It's already live everywhere you picked.");
  const accounts = await connectedAccounts(userId);
  const scope = await requestScope(userId);
  const acctOf = new Map(toSend.map((t) => [t.id, accountForTarget(t, accounts.all, scope)]));
  if (scope && toSend.some((t) => !acctOf.get(t.id)))
    throw new HttpError(403, "One of these destinations goes to an account you don't have access to. Ask the owner to share it with you.", "ROLE");
  const missing = toSend.filter((t) => acctOf.get(t.id)?.status !== "connected");
  if (missing.length) {
    const p = missing[0].platform as Platform;
    throw new HttpError(409, `${p === "x" ? "X" : p[0].toUpperCase() + p.slice(1)} needs you to reconnect first.`, "NOT_CONNECTED");
  }

  if (mode === "schedule") {
    if (!scheduledAt || scheduledAt.getTime() < Date.now() + 60_000) throw new HttpError(400, "Pick a time at least a minute from now.");
    // Atomic claim (same pattern as scheduledPost()): whoever flips the status wins, so two
    // simultaneous requests can never both schedule — and never both enqueue — the same post.
    if (!(await claimWithSlot(userId, post, { status: "scheduled", scheduledAt }))) throw new HttpError(409, "This one is already on its way.");
    await markLaunched(post.id);
    await db.$transaction([
      ...toSend.map((t) =>
        db.postTarget.update({ where: { id: t.id }, data: { platformStatus: "pending", socialAccountId: acctOf.get(t.id)!.id, errorCode: null, errorMessage: null, attempts: 0 } }),
      ),
    ]);
    await enqueue("SCHEDULED_POST", { postId: post.id }, { delayMs: scheduledAt.getTime() - Date.now(), jobId: `sched-${post.id}-${scheduledAt.getTime()}` });
    return;
  }

  // Send now: claim first, create records, return immediately, workers do the rest.
  // The claim is what stops a double-click (or a retried fetch) from publishing twice: the status check
  // above is a read, and two requests can both pass it before either write lands.
  const stamp = await claimWithSlot(userId, post, { status: "publishing", scheduledAt: null });
  if (!stamp) throw new HttpError(409, "This one is already on its way.");
  await markLaunched(post.id);
  await db.$transaction(
    toSend.map((t) =>
      db.postTarget.update({ where: { id: t.id }, data: { platformStatus: "queued", socialAccountId: acctOf.get(t.id)!.id, errorCode: null, errorMessage: null, attempts: 0, uploadRef: null, publishRequestedAt: null } }),
    ),
  );
  // jobId comes from the claim, not the clock: a duplicate request never gets this far, and a later
  // relaunch of the same post gets a fresh claim (so a new id) instead of being swallowed as a dupe.
  for (const t of toSend)
    await enqueue("SOCIAL_UPLOAD", { targetId: t.id, platform: t.platform as Platform, simulate }, { jobId: `up-${t.id}-${stamp}` });
}

/**
 * Takes the plan's post slot before the claim (insert-then-count, so parallel launches can't overshoot).
 * Moving an already-booked post to a new time is free; a draft, or a failed post sent again, costs a slot
 * in the period it goes out (once per post per period).
 */
const holdPostSlot = (userId: string, post: Post) =>
  post.status === "scheduled" && post.launchedAt ? Promise.resolve({ fresh: false, release: async () => {} }) : spendPost(userId, post.id);

/** Slot first, then the claim. If the claim is lost or throws (DB hiccup), the slot goes back. */
async function claimWithSlot(userId: string, post: Post, data: { status: string; scheduledAt: Date | null }) {
  const slot = await holdPostSlot(userId, post);
  let stamp: Awaited<ReturnType<typeof claim>>;
  try {
    stamp = await claim(post.id, ["draft", "failed", "partial", "scheduled"], data);
  } catch (err) {
    if (slot.fresh) await slot.release();
    throw err;
  }
  if (!stamp && slot.fresh) await slot.release();
  return stamp;
}

/** Stamps the first launch only, so a retry or reschedule never counts against the plan twice. */
const markLaunched = (postId: string) => db.post.updateMany({ where: { id: postId, launchedAt: null }, data: { launchedAt: new Date() } });

/**
 * Flip a post's status only if it is still in one of `from`, and return a token identifying this claim
 * (the row's new updatedAt). Null means somebody else got there first.
 */
async function claim(postId: string, from: string[], data: { status: string; scheduledAt?: Date | null }) {
  const claimed = await db.post.updateMany({ where: { id: postId, status: { in: from } }, data });
  if (claimed.count !== 1) return null;
  const row = await db.post.findUnique({ where: { id: postId }, select: { updatedAt: true } });
  return String(row?.updatedAt.getTime() ?? Date.now());
}

/**
 * Stop sending: one destination, or every one still moving. Only targets that haven't asked the platform to
 * go public can stop (pending, queued, uploading); the update is conditional, so a worker that got there first
 * wins and the creator sees the real state. Jobs already in the queue check for CANCELED and bow out.
 */
export async function cancelTargets(userId: string, postId: string, targetIds?: string[]) {
  const post = await db.post.findFirst({ where: { id: postId, userId }, select: { id: true, status: true } });
  if (!post) throw new HttpError(404, "We couldn't find that post.");
  // Only a send in progress. A booked post is called off with Unschedule, so one Stop can't strand the rest of it.
  if (post.status !== "publishing") throw new HttpError(409, post.status === "scheduled" ? "This one is booked for later. Unschedule it instead." : "Nothing is on its way right now.");
  const r = await db.postTarget.updateMany({
    where: { postId, platformStatus: { in: [...STOPPABLE] }, ...(targetIds ? { id: { in: targetIds } } : {}) },
    data: { platformStatus: "failed", errorCode: "CANCELED", errorMessage: "Stopped by the creator before it was sent." },
  });
  await syncPost(postId);
  return r.count;
}

export async function retryTarget(userId: string, targetId: string) {
  const t = await ownedTarget(userId, targetId);
  if (t.platformStatus !== "failed") throw new HttpError(409, "Nothing to retry here.");
  // The destination's own account first (multi-account plans, 1037), else the platform default.
  const all = await db.socialAccount.findMany({ where: { userId, platform: t.platform }, orderBy: { createdAt: "asc" } });
  const acct = accountForTarget(t, all, await requestScope(userId));
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

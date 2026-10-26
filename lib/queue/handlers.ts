import { loadKeys } from "../social/keys";
import "server-only";
import { db } from "../db";
import { accountContext, freshAccount } from "../live/account";
import { env } from "../env";
import { derivePostStatus, isPlatform, type Platform, type TargetStatus } from "../domain";
import { storage } from "../storage";
import { probe, thumbnail } from "../media/probe";
import { isPracticeAccount, publisherForAccount } from "../social/registry";
import { asPublisherError, PublisherError, type PublishContext, type RemoteState, type SimulationMode } from "../social/types";
import { isApproved } from "../review";
import { enqueue } from "./index";
import type { JobName, JobPayloads } from "./jobs";

const MAX_AUTO_RETRIES = 3;
const MAX_STATUS_POLLS = 60;
/** "uploading" with no progress this long means the job died mid-transfer (function timeout, recycled instance). */
export const STUCK_UPLOAD_MS = 15 * 60_000;
/** "processing" with no poll this long means the status loop was lost. Live polls touch the row every <=30 s. */
export const STUCK_PROCESSING_MS = 10 * 60_000;
/** Still not live this long after we asked the platform to publish: stop waiting, let the creator retry. */
export const PROCESSING_GIVE_UP_MS = 3 * 3600_000;
/** Upload restarts by the sweeper (on top of the automatic retries) before the target is failed. */
const MAX_UPLOAD_RESTARTS = 3;
/** While bytes are moving, touch updatedAt this often so the sweeper never restarts a live upload (1027 review). */
const UPLOAD_HEARTBEAT_MS = 60_000;
/** The sweeper refreshes tokens that expire within this window (was 24 h, so 1-hour YouTube tokens refreshed every minute). */
export const REFRESH_WINDOW_MS = 30 * 60_000;

export async function runJob<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
  await loadKeys();
  await dispatch(name, data);
}

async function dispatch<N extends JobName>(name: N, data: JobPayloads[N]) {
  switch (name) {
    case "VIDEO_PROCESS":
      return videoProcess(data as JobPayloads["VIDEO_PROCESS"]);
    case "VIDEO_THUMBNAIL":
      return videoThumbnail(data as JobPayloads["VIDEO_THUMBNAIL"]);
    case "SOCIAL_UPLOAD":
      return socialUpload(data as JobPayloads["SOCIAL_UPLOAD"]);
    case "SOCIAL_PUBLISH":
      return socialPublish(data as JobPayloads["SOCIAL_PUBLISH"]);
    case "SOCIAL_STATUS_CHECK":
      return socialStatus(data as JobPayloads["SOCIAL_STATUS_CHECK"]);
    case "SCHEDULED_POST":
      return scheduledPost(data as JobPayloads["SCHEDULED_POST"]);
    case "TOKEN_REFRESH":
      return tokenRefresh(data as JobPayloads["TOKEN_REFRESH"]);
    case "FIRST_COMMENT":
      return firstComment(data as JobPayloads["FIRST_COMMENT"]);
  }
}

/* ---------------- media ---------------- */

async function videoProcess({ mediaId }: { mediaId: string }) {
  const m = await db.media.findUnique({ where: { id: mediaId } });
  if (!m) return;
  await db.media.update({ where: { id: m.id }, data: { status: "processing" } });
  try {
    const path = storage.localPath?.(m.storageKey);
    const p = path ? await probe(path) : null;
    await db.media.update({
      where: { id: m.id },
      data: {
        status: "ready",
        ...(p?.duration ? { duration: p.duration } : {}),
        ...(p?.width ? { width: p.width, height: p.height } : {}),
      },
    });
    if (!m.thumbnailKey) await enqueue("VIDEO_THUMBNAIL", { mediaId });
  } catch (e) {
    console.error("[VIDEO_PROCESS]", e);
    // Browser already supplied metadata; a probe failure should not block the creator.
    await db.media.update({ where: { id: m.id }, data: { status: "ready" } });
  }
}

async function videoThumbnail({ mediaId }: { mediaId: string }) {
  const m = await db.media.findUnique({ where: { id: mediaId } });
  if (!m || m.thumbnailKey) return;
  const input = storage.localPath?.(m.storageKey);
  if (!input) return;
  const key = `thumbs/${m.userId}/${m.id}.jpg`;
  const ok = await thumbnail(input, storage.localPath!(key), Math.min(1, (m.duration ?? 2) / 2)).catch(() => false);
  if (ok) await db.media.update({ where: { id: m.id }, data: { thumbnailKey: key } });
}

/* ---------------- social ---------------- */

async function loadContext(targetId: string, simulate: SimulationMode | undefined) {
  const t = await db.postTarget.findUnique({
    where: { id: targetId },
    include: { socialAccount: true, post: { include: { media: true } } },
  });
  if (!t || !isPlatform(t.platform)) return null;
  const acct = t.socialAccount;
  if (!acct || acct.status !== "connected") {
    await failTarget(t.id, t.postId, new PublisherError("NOT_CONNECTED", "No connected account", `No connected ${t.platform} account for this user.`, false));
    return null;
  }
  let publisher;
  try {
    publisher = publisherForAccount(t.platform, acct);
  } catch (e) {
    await failTarget(t.id, t.postId, new PublisherError("NOT_CONNECTED", "Platform not configured", (e as Error).message, false));
    return null;
  }
  const practice = isPracticeAccount(acct);
  if (t.practice !== practice) await db.postTarget.update({ where: { id: t.id }, data: { practice } });

  // Single-flight, race-safe refresh; a refused refresh throws AUTH_EXPIRED (and marks the account).
  const account = accountContext(await freshAccount(acct));

  const media = t.post.media;
  const ctx: PublishContext = {
    account,
    media: {
      id: media.id,
      mimeType: media.mimeType,
      size: media.size,
      duration: media.duration,
      width: media.width,
      height: media.height,
      publicUrl: async () => {
        const u = await storage.signedUrl(media.storageKey, 6 * 3600);
        return u.startsWith("http") ? u : `${env.APP_URL}${u}`;
      },
      open: async () => storage.read(media.storageKey),
      readAll: async () => {
        const { stream } = await storage.read(media.storageKey);
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(c as Buffer);
        return Buffer.concat(chunks);
      },
    },
    content: { title: t.title, caption: t.caption, description: t.description, hashtags: t.hashtags },
    simulate,
    attempt: t.attempts,
    resumeRef: t.uploadRef,
    checkpoint: async (ref: string) => {
      await db.postTarget.update({ where: { id: t.id }, data: { uploadRef: ref } });
    },
  };
  return { t, ctx, publisher, platform: t.platform as Platform };
}

/**
 * Settle a target. Conditional (1027): a confirmed "published" is never overwritten (a late or duplicate
 * job's failure used to turn a live post into "failed"), and a failure never lands on top of a Stop.
 * Returns false when nothing changed.
 */
export async function setTarget(id: string, postId: string, status: TargetStatus, extra: Record<string, unknown> = {}) {
  const r = await db.postTarget.updateMany({
    where: { id, platformStatus: { not: "published" }, ...(status === "failed" ? { NOT: { platformStatus: "failed", errorCode: "CANCELED" } } : {}) },
    data: { platformStatus: status, ...extra },
  });
  if (!r.count) return false;
  const t = await db.postTarget.findUnique({ where: { id } });
  await syncPost(postId);
  if (!t) return true;
  // Live with a first comment waiting: post it a few seconds later (a brand-new video can refuse comments for a moment).
  if (status === "published" && t.firstComment?.trim() && !t.firstCommentId && isPlatform(t.platform))
    await enqueue("FIRST_COMMENT", { targetId: id, platform: t.platform }, { delayMs: 5000, jobId: `fc-${id}` });
  return true;
}

const FIRST_COMMENT_TRIES = 4;

/**
 * Post the creator's first comment on their own, already-live post. Best effort by design: the post itself is
 * never touched, a failure is kept on the target (firstCommentError) so the app can say so plainly.
 */
export async function firstComment({ targetId, platform, attempt = 0 }: JobPayloads["FIRST_COMMENT"]) {
  const t = await db.postTarget.findUnique({ where: { id: targetId }, include: { socialAccount: true } });
  if (!t || t.firstCommentId || !t.firstComment?.trim() || t.platformStatus !== "published" || !t.platformPostId) return;
  const fail = (msg: string) => db.postTarget.update({ where: { id: t.id }, data: { firstCommentError: msg } });
  const acct = t.socialAccount;
  if (!acct || acct.status !== "connected") return void (await fail("The account was disconnected before we could add the comment."));
  try {
    const publisher = publisherForAccount(platform, acct);
    if (!publisher.postComment) return void (await fail("This platform doesn't let apps add comments."));
    const account = accountContext(await freshAccount(acct));
    const { id } = await publisher.postComment(account, t.platformPostId, t.firstComment.trim());
    // Conditional, so a duplicate job that raced this one can't post twice and overwrite the id.
    await db.postTarget.updateMany({ where: { id: t.id, firstCommentId: null }, data: { firstCommentId: id, firstCommentError: null } });
  } catch (e) {
    const pe = asPublisherError(e);
    // MEDIA_REJECTED here is usually "still processing": worth a few more tries, spaced out.
    const again = (pe.retryable || pe.code === "MEDIA_REJECTED") && attempt + 1 < FIRST_COMMENT_TRIES;
    if (again) return void (await enqueue("FIRST_COMMENT", { targetId, platform, attempt: attempt + 1 }, { delayMs: 15_000 * 2 ** attempt, jobId: `fc-${targetId}-${attempt + 1}` }));
    await fail(pe.code === "AUTH_EXPIRED" ? "The account needs reconnecting, so the comment didn't go up." : pe.code === "FORBIDDEN" ? "The platform didn't allow the comment (comments may be off for this post)." : "The comment didn't go up. You can add it on the platform.");
  }
}

export async function syncPost(postId: string) {
  const post = await db.post.findUnique({ where: { id: postId }, include: { targets: { select: { platformStatus: true, publishedAt: true } } } });
  if (!post) return;
  const status = derivePostStatus(post.targets, !!post.scheduledAt && post.scheduledAt > new Date());
  const allDone = post.targets.length > 0 && post.targets.every((t) => t.platformStatus === "published");
  await db.post.update({
    where: { id: postId },
    data: { status, ...(allDone && !post.publishedAt ? { publishedAt: new Date() } : {}) },
  });
  // The send just settled with something live: one in-app notice (10-16g). Keyed per post, so a retry
  // that finishes later never adds a second one.
  if (post.status === "publishing" && (status === "published" || status === "partial")) {
    const { noticePostLive } = await import("../retention/notices");
    await noticePostLive(postId).catch((e) => console.error("[notice]", e));
  }
}

/** The creator pressed Stop. Any job still holding this target lets it go. */
async function canceled(targetId: string) {
  const t = await db.postTarget.findUnique({ where: { id: targetId }, select: { errorCode: true, platformStatus: true } });
  return t?.platformStatus === "failed" && t.errorCode === "CANCELED";
}

/** Move a target forward only if nobody stopped it in the meantime. Returns false when it was stopped. */
async function advance(targetId: string, postId: string, status: TargetStatus, extra: Record<string, unknown> = {}) {
  // Never from failed (a Stop) and never backwards from published (a stale or duplicate job).
  const r = await db.postTarget.updateMany({ where: { id: targetId, platformStatus: { notIn: ["failed", "published"] } }, data: { platformStatus: status, ...extra } });
  if (r.count) await syncPost(postId);
  return r.count > 0;
}

async function failTarget(targetId: string, postId: string, err: unknown) {
  if (await canceled(targetId)) return; // a stop is the creator's call; a late error must not overwrite it
  const pe = asPublisherError(err);
  // Already live (or stopped meanwhile): a late error changes nothing, and nobody gets a failure notice.
  if (!(await setTarget(targetId, postId, "failed", { errorCode: pe.code, errorMessage: pe.technical ?? pe.message }))) return;
  if (pe.code === "AUTH_EXPIRED") {
    const t = await db.postTarget.findUnique({ where: { id: targetId }, select: { socialAccountId: true } });
    if (t?.socialAccountId) await db.socialAccount.update({ where: { id: t.socialAccountId }, data: { status: "needs_reconnect" } });
  }
  // Tell the creator in the app (and by email once per post). A notice failure never hides the real one.
  const { noticeFailedTarget } = await import("../retention/notices");
  await noticeFailedTarget(targetId, pe.code).catch((e) => console.error("[notice]", e));
}

/** Retry transient failures with exponential backoff, otherwise surface to the creator. */
async function handleFailure(name: "SOCIAL_UPLOAD" | "SOCIAL_PUBLISH", data: JobPayloads["SOCIAL_UPLOAD"], targetId: string, postId: string, attempts: number, raw: unknown) {
  const err = asPublisherError(raw);
  if (await canceled(targetId)) return;
  if (err.retryable && attempts < MAX_AUTO_RETRIES) {
    await db.postTarget.update({ where: { id: targetId }, data: { attempts: { increment: 1 }, errorCode: err.code, errorMessage: err.technical ?? err.message } });
    await enqueue(name, data, { delayMs: 1500 * 2 ** attempts });
    return;
  }
  await failTarget(targetId, postId, err);
}

/**
 * loadContext for every social job (1027: publish and status checks used to call it bare, so a DB hiccup or a
 * refused token refresh threw out of the job and left the target "processing" for good). A transient problem
 * is retried the way the job would retry itself; anything else fails the target so the creator can act.
 */
async function load(name: "SOCIAL_UPLOAD" | "SOCIAL_PUBLISH" | "SOCIAL_STATUS_CHECK", data: JobPayloads["SOCIAL_UPLOAD"] & { poll?: number }) {
  try {
    return await loadContext(data.targetId, data.simulate);
  } catch (e) {
    // A PublisherError says what it is (AUTH_EXPIRED, a config problem...). Anything else here is our own
    // plumbing (Prisma pool timeout, DB unreachable): treat it as transient; handleFailure still caps retries.
    const pe = e instanceof PublisherError ? e : new PublisherError("NETWORK", "Connection problem", asPublisherError(e).technical ?? String(e));
    const t = await db.postTarget.findUnique({ where: { id: data.targetId } }).catch(() => null);
    if (!t) return null;
    const poll = data.poll ?? 0;
    if (pe.retryable && name === "SOCIAL_STATUS_CHECK" && poll < MAX_STATUS_POLLS) await enqueue("SOCIAL_STATUS_CHECK", { ...data, poll: poll + 1 }, { delayMs: 5000 });
    else if (pe.retryable && name !== "SOCIAL_STATUS_CHECK") await handleFailure(name, data, t.id, t.postId, t.attempts, pe);
    else await failTarget(t.id, t.postId, pe);
    return null;
  }
}

async function socialUpload(data: JobPayloads["SOCIAL_UPLOAD"]) {
  const loaded = await load("SOCIAL_UPLOAD", data);
  if (!loaded) return;
  const { t, ctx, publisher } = loaded;
  if (t.platformStatus === "published" || (t.platformStatus === "failed" && t.errorCode === "CANCELED")) return;
  // Already handed to the platform on a previous run (and not a resumable session): don't upload twice.
  if (t.uploadRef && !t.uploadRef.startsWith("session:")) return void (await enqueue("SOCIAL_PUBLISH", data));
  const issues = publisher.validateMedia(ctx.media).filter((i) => i.level === "error");
  if (issues.length) return failTarget(t.id, t.postId, new PublisherError("MEDIA_REJECTED", issues[0].message, issues.map((i) => i.message).join("\n"), false));

  if (!(await advance(t.id, t.postId, "uploading", { errorCode: null, errorMessage: null }))) return;
  // A long, non-resumable upload never checkpoints, so without this it would look stuck after 15 min and the
  // sweeper would start a second one beside it (two uploads, two publishes). A dead process stops beating.
  const beat = setInterval(() => {
    void db.postTarget.updateMany({ where: { id: t.id, platformStatus: "uploading" }, data: { updatedAt: new Date() } }).catch(() => {});
  }, UPLOAD_HEARTBEAT_MS);
  (beat as { unref?: () => void }).unref?.();
  try {
    const ref = await publisher.upload(ctx);
    await db.postTarget.update({ where: { id: t.id }, data: { uploadRef: ref } });
    // Stopped while the bytes were moving: keep the upload ref (a later "Send it again" reuses it), but never publish.
    if (await canceled(t.id)) return;
    await enqueue("SOCIAL_PUBLISH", data);
  } catch (e) {
    await handleFailure("SOCIAL_UPLOAD", data, t.id, t.postId, t.attempts, e);
  } finally {
    clearInterval(beat);
  }
}

async function applyRemote(targetId: string, postId: string, r: RemoteState, data: JobPayloads["SOCIAL_UPLOAD"], poll: number) {
  if (r.state === "published") {
    // The only path to "published": the platform confirmed it.
    return setTarget(targetId, postId, "published", { platformPostId: r.platformPostId, platformUrl: r.url ?? null, publishedAt: new Date(), errorCode: null, errorMessage: null });
  }
  if (r.state === "failed") return failTarget(targetId, postId, new PublisherError(r.code, r.message, r.message, false));
  await db.postTarget.update({ where: { id: targetId }, data: { uploadRef: r.ref } });
  if (poll >= MAX_STATUS_POLLS) return failTarget(targetId, postId, new PublisherError("PLATFORM_DOWN", "Processing timed out", `Still processing after ${poll} checks.`, false));
  await enqueue("SOCIAL_STATUS_CHECK", { ...data, poll: poll + 1 }, { delayMs: Math.min(1000 * 1.4 ** poll, 30_000) });
}

async function socialPublish(data: JobPayloads["SOCIAL_PUBLISH"]) {
  const loaded = await load("SOCIAL_PUBLISH", data);
  if (!loaded) return;
  const { t, ctx, publisher } = loaded;
  if (t.platformStatus === "failed" && t.errorCode === "CANCELED") return;
  if (t.platformStatus === "published") return; // a stale or duplicate job: it's already out, never post it twice
  if (!t.uploadRef) return failTarget(t.id, t.postId, new PublisherError("UNKNOWN", "Missing upload", "SOCIAL_PUBLISH ran without an upload reference.", false));
  // Last point a Stop can win. After this the platform is asked to go public, which can't be taken back.
  if (!(await advance(t.id, t.postId, "processing"))) return;
  try {
    if (await reconciled(t, ctx, publisher)) return;
    if (!t.publishRequestedAt) await db.postTarget.update({ where: { id: t.id }, data: { publishRequestedAt: new Date() } });
    const r = await publisher.publish(ctx, t.uploadRef);
    await applyRemote(t.id, t.postId, r, data, 0);
  } catch (e) {
    const pe = asPublisherError(e);
    if (pe.code === "DUPLICATE" && publisher.findExisting) {
      const hit = await publisher.findExisting(ctx, { since: new Date(Date.now() - 24 * 3600_000), uploadRef: t.uploadRef }).catch(() => null);
      if (hit) return setTarget(t.id, t.postId, "published", { platformPostId: hit.platformPostId, platformUrl: hit.url ?? null, publishedAt: new Date(), errorCode: null, errorMessage: null });
    }
    await handleFailure("SOCIAL_PUBLISH", data, t.id, t.postId, t.attempts, pe);
  }
}

/**
 * If a previous attempt may already have gone live (we asked to publish, then lost the answer), look for the
 * post on the platform before asking again. Returns true when the target was settled from what we found.
 */
async function reconciled(
  t: { id: string; postId: string; uploadRef: string | null; publishRequestedAt: Date | null },
  ctx: PublishContext,
  publisher: { findExisting?: NonNullable<import("../social/types").SocialPublisher["findExisting"]> },
) {
  if (!t.publishRequestedAt || !publisher.findExisting) return false;
  const hit = await publisher.findExisting(ctx, { since: new Date(t.publishRequestedAt.getTime() - 120_000), uploadRef: t.uploadRef });
  if (!hit) return false;
  await setTarget(t.id, t.postId, "published", { platformPostId: hit.platformPostId, platformUrl: hit.url ?? null, publishedAt: new Date(), errorCode: null, errorMessage: null });
  return true;
}

async function socialStatus(data: JobPayloads["SOCIAL_STATUS_CHECK"]) {
  const loaded = await load("SOCIAL_STATUS_CHECK", data);
  if (!loaded) return;
  const { t, ctx, publisher } = loaded;
  if (!t.uploadRef || t.platformStatus === "published") return;
  try {
    const r = await publisher.getStatus(ctx, t.uploadRef);
    await applyRemote(t.id, t.postId, r, data, data.poll);
  } catch (e) {
    if (e instanceof PublisherError && e.retryable && data.poll < MAX_STATUS_POLLS)
      return void (await enqueue("SOCIAL_STATUS_CHECK", { ...data, poll: data.poll + 1 }, { delayMs: 3000 }));
    await failTarget(t.id, t.postId, e);
  }
}

/* ---------------- scheduling ---------------- */

async function scheduledPost({ postId }: { postId: string }) {
  // Approval gate: skip the run and leave the post scheduled, so it goes out as soon as a reviewer approves
  // (the sweeper re-checks on every pass) instead of failing in the creator's face at midnight.
  const pending = await db.post.findUnique({ where: { id: postId }, select: { id: true, requireApproval: true, status: true } });
  if (!pending) return;
  // Maintenance no longer holds posts (10-13): members keep posting while it is on, and every account that
  // exists joined before it began (nobody can sign up during maintenance).
  if (pending.status === "scheduled" && !(await isApproved(pending))) {
    console.warn(`[SCHEDULED_POST] ${postId} skipped: waiting for approval.`);
    return;
  }
  // Atomic claim: only one worker/sweeper wins, so a post can never double-publish.
  const claimed = await db.post.updateMany({
    where: { id: postId, status: "scheduled", scheduledAt: { lte: new Date(Date.now() + 1000) } },
    data: { status: "publishing" },
  });
  if (claimed.count !== 1) return;
  const targets = await db.postTarget.findMany({ where: { postId, platformStatus: "pending" } });
  for (const t of targets) {
    if (!isPlatform(t.platform)) continue;
    await db.postTarget.update({ where: { id: t.id }, data: { platformStatus: "queued" } });
    // Scheduled runs rehearse "realistically" for practice accounts; real accounts ignore simulation entirely.
    await enqueue("SOCIAL_UPLOAD", { targetId: t.id, platform: t.platform, simulate: "realistic" }, { jobId: `up-${t.id}-${Date.now()}` });
  }
}

/** Safety net for scheduled posts (survives restarts, lost timers, and missed delayed jobs). */
export async function sweepDuePosts(now = Date.now()) {
  const due = await db.post.findMany({ where: { status: "scheduled", scheduledAt: { lte: new Date(now) } }, select: { id: true }, take: 50 });
  for (const p of due) await enqueue("SCHEDULED_POST", { postId: p.id }, { jobId: `sched-${p.id}` });
  const expiring = await db.socialAccount.findMany({
    where: { status: "connected", tokenExpiresAt: { lte: new Date(now + REFRESH_WINDOW_MS) } },
    select: { id: true },
    take: 50,
  });
  // Bucketed per 10 minutes: one refresh attempt per window however often the sweep runs, and (with Redis,
  // which remembers finished job ids) a fixed id would have blocked every refresh after the first.
  const bucket = Math.floor(now / (10 * 60_000));
  for (const a of expiring) await enqueue("TOKEN_REFRESH", { accountId: a.id }, { jobId: `refresh-${a.id}-${bucket}` });
}

/**
 * Hand lost work back to the queue. On a serverless host without Redis a job is a timer inside one function
 * invocation; if that invocation ends early the target sits where it was. Three places it can sit:
 *  - "queued": the SOCIAL_UPLOAD job never ran. Requeue it (socialUpload refuses to upload twice).
 *  - "uploading": the job died mid-transfer. Restart it (a resumable session ref is kept and reused); after
 *    MAX_UPLOAD_RESTARTS restarts the target fails, so it can't loop forever.
 *  - "processing": the publish or status loop was lost. Before the publish call (no publishRequestedAt) the
 *    publish is re-run; after it, only the status is checked (never a second publish); after
 *    PROCESSING_GIVE_UP_MS it fails with "processing timed out" and the creator can retry.
 * Stop only works up to "uploading" and Retry only from "failed", so before this a stuck target said
 * "Sending..." forever. Each claim is a conditional update on updatedAt, so several sweepers running at once
 * act once, and job ids are bucketed by minute.
 */
export async function requeueStuckTargets(olderThanMs = 120_000, now = Date.now()) {
  const minute = Math.floor(now / 60_000);
  let requeued = 0;
  const queued = await db.postTarget.findMany({
    where: { platformStatus: "queued", updatedAt: { lte: new Date(now - olderThanMs) } },
    select: { id: true, platform: true },
    take: 50,
  });
  for (const t of queued) {
    if (!isPlatform(t.platform)) continue;
    await enqueue("SOCIAL_UPLOAD", { targetId: t.id, platform: t.platform, simulate: "realistic" }, { jobId: `requeue-${t.id}-${minute}` });
    requeued++;
  }

  const uploading = await db.postTarget.findMany({
    where: { platformStatus: "uploading", updatedAt: { lte: new Date(now - STUCK_UPLOAD_MS) } },
    select: { id: true, postId: true, platform: true, attempts: true, updatedAt: true },
    take: 50,
  });
  for (const t of uploading) {
    if (!isPlatform(t.platform)) continue;
    const won = await db.postTarget.updateMany({ where: { id: t.id, platformStatus: "uploading", updatedAt: t.updatedAt }, data: { attempts: { increment: 1 }, updatedAt: new Date(now) } });
    if (!won.count) continue;
    if (t.attempts + 1 > MAX_AUTO_RETRIES + MAX_UPLOAD_RESTARTS) {
      await failTarget(t.id, t.postId, new PublisherError("PLATFORM_DOWN", "Upload kept stopping", `The upload to ${t.platform} stopped ${t.attempts + 1} times before finishing.`, false));
      continue;
    }
    await enqueue("SOCIAL_UPLOAD", { targetId: t.id, platform: t.platform, simulate: "realistic" }, { jobId: `requeue-up-${t.id}-${minute}` });
    requeued++;
  }

  const processing = await db.postTarget.findMany({
    where: { platformStatus: "processing", updatedAt: { lte: new Date(now - STUCK_PROCESSING_MS) } },
    select: { id: true, postId: true, platform: true, updatedAt: true, publishRequestedAt: true },
    take: 50,
  });
  for (const t of processing) {
    if (!isPlatform(t.platform)) continue;
    const won = await db.postTarget.updateMany({ where: { id: t.id, platformStatus: "processing", updatedAt: t.updatedAt }, data: { updatedAt: new Date(now) } });
    if (!won.count) continue;
    if (t.publishRequestedAt && now - t.publishRequestedAt.getTime() > PROCESSING_GIVE_UP_MS) {
      await failTarget(t.id, t.postId, new PublisherError("PLATFORM_DOWN", "Processing timed out", `${t.platform} hadn't confirmed the post ${Math.round((now - t.publishRequestedAt.getTime()) / 60_000)} minutes after we asked it to publish.`, false));
      continue;
    }
    const data = { targetId: t.id, platform: t.platform, simulate: "realistic" as const };
    if (t.publishRequestedAt) await enqueue("SOCIAL_STATUS_CHECK", { ...data, poll: 0 }, { jobId: `requeue-st-${t.id}-${minute}` });
    else await enqueue("SOCIAL_PUBLISH", data, { jobId: `requeue-pub-${t.id}-${minute}` });
    requeued++;
  }
  return requeued;
}

/** Sweeper-driven refresh, ahead of expiry. Shares the single-flight refresh with every other caller. */
async function tokenRefresh({ accountId }: { accountId: string }) {
  const a = await db.socialAccount.findUnique({ where: { id: accountId } });
  if (!a || a.status !== "connected" || !isPlatform(a.platform)) return;
  // A permanent refusal marks the account needs_reconnect inside freshAccount; a transient one waits for the next window.
  await freshAccount(a, REFRESH_WINDOW_MS).catch((e) => console.warn("[TOKEN_REFRESH]", a.id, asPublisherError(e).code));
}

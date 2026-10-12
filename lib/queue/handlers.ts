import { getConfig } from "../settings";
import { loadKeys } from "../social/keys";
import "server-only";
import { db } from "../db";
import { decrypt, encrypt } from "../crypto";
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

export async function runJob<N extends JobName>(name: N, data: JobPayloads[N]) {
  await loadKeys();
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

  let accessToken = decrypt(acct.accessToken);
  const refreshToken = acct.refreshToken ? decrypt(acct.refreshToken) : null;
  if (acct.tokenExpiresAt && acct.tokenExpiresAt.getTime() - Date.now() < 5 * 60_000) {
    const fresh = await publisher.refreshToken({ id: acct.id, platformUserId: acct.platformUserId, username: acct.username, accessToken, refreshToken });
    accessToken = fresh.accessToken;
    await db.socialAccount.update({
      where: { id: acct.id },
      data: {
        accessToken: encrypt(fresh.accessToken),
        ...(fresh.refreshToken ? { refreshToken: encrypt(fresh.refreshToken) } : {}),
        tokenExpiresAt: fresh.expiresAt ?? null,
      },
    });
  }

  const media = t.post.media;
  const ctx: PublishContext = {
    account: { id: acct.id, platformUserId: acct.platformUserId, username: acct.username, accessToken, refreshToken, tokenExpiresAt: acct.tokenExpiresAt },
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

async function setTarget(id: string, postId: string, status: TargetStatus, extra: Record<string, unknown> = {}) {
  await db.postTarget.update({ where: { id }, data: { platformStatus: status, ...extra } });
  await syncPost(postId);
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
}

async function failTarget(targetId: string, postId: string, err: unknown) {
  const pe = asPublisherError(err);
  await setTarget(targetId, postId, "failed", {
    errorCode: pe.code,
    errorMessage: pe.technical ?? pe.message,
  });
  if (pe.code === "AUTH_EXPIRED") {
    const t = await db.postTarget.findUnique({ where: { id: targetId }, select: { socialAccountId: true } });
    if (t?.socialAccountId) await db.socialAccount.update({ where: { id: t.socialAccountId }, data: { status: "needs_reconnect" } });
  }
}

/** Retry transient failures with exponential backoff, otherwise surface to the creator. */
async function handleFailure(name: "SOCIAL_UPLOAD" | "SOCIAL_PUBLISH", data: JobPayloads["SOCIAL_UPLOAD"], targetId: string, postId: string, attempts: number, raw: unknown) {
  const err = asPublisherError(raw);
  if (err.retryable && attempts < MAX_AUTO_RETRIES) {
    await db.postTarget.update({ where: { id: targetId }, data: { attempts: { increment: 1 }, errorCode: err.code, errorMessage: err.technical ?? err.message } });
    await enqueue(name, data, { delayMs: 1500 * 2 ** attempts });
    return;
  }
  await failTarget(targetId, postId, err);
}

async function socialUpload(data: JobPayloads["SOCIAL_UPLOAD"]) {
  const loaded = await loadContext(data.targetId, data.simulate).catch(async (e) => {
    const t = await db.postTarget.findUnique({ where: { id: data.targetId } });
    if (t) await failTarget(t.id, t.postId, e);
    return null;
  });
  if (!loaded) return;
  const { t, ctx, publisher } = loaded;
  if (t.platformStatus === "published") return;
  // Already handed to the platform on a previous run (and not a resumable session): don't upload twice.
  if (t.uploadRef && !t.uploadRef.startsWith("session:")) return void (await enqueue("SOCIAL_PUBLISH", data));
  const issues = publisher.validateMedia(ctx.media).filter((i) => i.level === "error");
  if (issues.length) return failTarget(t.id, t.postId, new PublisherError("MEDIA_REJECTED", issues[0].message, issues.map((i) => i.message).join("\n"), false));

  await setTarget(t.id, t.postId, "uploading", { errorCode: null, errorMessage: null });
  try {
    const ref = await publisher.upload(ctx);
    await db.postTarget.update({ where: { id: t.id }, data: { uploadRef: ref } });
    await enqueue("SOCIAL_PUBLISH", data);
  } catch (e) {
    await handleFailure("SOCIAL_UPLOAD", data, t.id, t.postId, t.attempts, e);
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
  const loaded = await loadContext(data.targetId, data.simulate);
  if (!loaded) return;
  const { t, ctx, publisher } = loaded;
  if (!t.uploadRef) return failTarget(t.id, t.postId, new PublisherError("UNKNOWN", "Missing upload", "SOCIAL_PUBLISH ran without an upload reference.", false));
  await setTarget(t.id, t.postId, "processing");
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
  const loaded = await loadContext(data.targetId, data.simulate);
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
  // Maintenance: hold it. The sweeper picks it up again on the first pass after the switch goes off.
  if ((await getConfig("site")).maintenance) return;
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
export async function sweepDuePosts() {
  if ((await getConfig("site")).maintenance) return;
  const due = await db.post.findMany({ where: { status: "scheduled", scheduledAt: { lte: new Date() } }, select: { id: true }, take: 50 });
  for (const p of due) await enqueue("SCHEDULED_POST", { postId: p.id }, { jobId: `sched-${p.id}` });
  const expiring = await db.socialAccount.findMany({
    where: { status: "connected", tokenExpiresAt: { lte: new Date(Date.now() + 24 * 3600_000) } },
    select: { id: true },
    take: 50,
  });
  for (const a of expiring) await enqueue("TOKEN_REFRESH", { accountId: a.id }, { jobId: `refresh-${a.id}` });
}

async function tokenRefresh({ accountId }: { accountId: string }) {
  const a = await db.socialAccount.findUnique({ where: { id: accountId } });
  if (!a || !isPlatform(a.platform)) return;
  try {
    const fresh = await publisherForAccount(a.platform, a).refreshToken({
      id: a.id,
      platformUserId: a.platformUserId,
      username: a.username,
      accessToken: decrypt(a.accessToken),
      refreshToken: a.refreshToken ? decrypt(a.refreshToken) : null,
    });
    await db.socialAccount.update({
      where: { id: a.id },
      data: {
        accessToken: encrypt(fresh.accessToken),
        ...(fresh.refreshToken ? { refreshToken: encrypt(fresh.refreshToken) } : {}),
        tokenExpiresAt: fresh.expiresAt ?? null,
      },
    });
  } catch (e) {
    if (e instanceof PublisherError && e.code === "AUTH_EXPIRED") await db.socialAccount.update({ where: { id: a.id }, data: { status: "needs_reconnect" } });
  }
}

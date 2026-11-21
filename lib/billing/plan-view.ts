import "server-only";
import { captionUsage, postUsage, replyUsage, storageUsage, uploadLimitBytes, xPostUsage } from "./entitlements";
import { transcriptionAvailable } from "../captions/availability";
import { legacyMeter, storageUsageFor } from "../storage/quota";

const fin = (n: number) => (Number.isFinite(n) ? n : null); // Infinity (unlimited) -> null in JSON

/** What the workspace's plan allows right now (GET /api/plan/limits; R1294 bootstrap). `null` = unlimited. */
export async function planLimits(userId: string) {
  const [posts, replies, captions, upload, storage, transcribe] = await Promise.all([postUsage(userId), replyUsage(userId), captionUsage(userId), uploadLimitBytes(userId), storageUsage(userId), transcriptionAvailable()]);
  return {
    plan: { slug: posts.planSlug, name: posts.planName },
    posts: { limit: posts.postLimit || null, period: posts.postPeriod, used: posts.used, left: fin(posts.left) },
    replies: { limit: replies.replyLimit || null, used: replies.used, left: fin(replies.left) },
    captions: { ai: captions.aiCaptions, limit: captions.captionVideos || null, used: captions.used, left: fin(captions.left), burn: captions.burnCaptions, transcribe },
    upload: { maxMb: upload.mb, planLimited: upload.planLimited },
    storage: { usedBytes: storage.usedBytes, limitBytes: storage.limitBytes || null, remainingBytes: storage.limitBytes ? storage.remainingBytes : null, over: storage.over, label: storage.label },
    source: posts.source,
  };
}

/** 1096 usage meter (GET /api/billing/usage; R1294 bootstrap): this period's posts, X posts, AI captions, replies, storage. */
export async function billingUsage(userId: string) {
  const [posts, x, ai, replies, storage] = await Promise.all([postUsage(userId), xPostUsage(userId), captionUsage(userId), replyUsage(userId), storageUsageFor(userId)]);
  const meter = legacyMeter(storage);
  return {
    plan: { slug: posts.planSlug, name: posts.planName },
    posts: { used: posts.used, limit: posts.postLimit, period: posts.postPeriod, left: fin(posts.left), fairUse: posts.fairUsePosts },
    x: { used: x.used, limit: x.xPostLimit, credits: x.credits, left: fin(x.left) },
    ai: { used: ai.used, limit: ai.captionVideos, credits: ai.credits, left: fin(ai.left), on: ai.aiCaptions, unlimited: ai.unlimited, unlimitedUntil: ai.unlimitedUntil },
    replies: { used: replies.used, limit: replies.replyLimit, left: fin(replies.left) },
    storage: { usedBytes: meter.usedBytes, limitBytes: meter.limitBytes, limitMb: Math.round(meter.limitBytes / 1048576), kind: meter.kind },
    quota: storage, // R1209: GET /api/storage/usage
    analyticsDays: posts.analyticsDays,
  };
}

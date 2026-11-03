import { json, route } from "@/lib/http";
import { captionUsage, postUsage, replyUsage, storageUsage, xPostUsage } from "@/lib/billing/entitlements";

const n = (v: number) => (Number.isFinite(v) ? v : null); // Infinity (unlimited) -> null in JSON

/** 1096 usage meter: this period's posts, X posts, AI videos, replies and storage, with top-up credits. */
export const GET = route(async (_req, { user }) => {
  const [posts, x, ai, replies, storage] = await Promise.all([postUsage(user.id), xPostUsage(user.id), captionUsage(user.id), replyUsage(user.id), storageUsage(user.id)]);
  return json({
    plan: { slug: posts.planSlug, name: posts.planName },
    posts: { used: posts.used, limit: posts.postLimit, period: posts.postPeriod, left: n(posts.left), fairUse: posts.fairUsePosts },
    x: { used: x.used, limit: x.xPostLimit, credits: x.credits, left: n(x.left) },
    ai: { used: ai.used, limit: ai.captionVideos, credits: ai.credits, left: n(ai.left), on: ai.aiCaptions },
    replies: { used: replies.used, limit: replies.replyLimit, left: n(replies.left) },
    storage: { usedBytes: storage.usedBytes, limitBytes: storage.limitBytes, limitMb: storage.storageMb },
    analyticsDays: posts.analyticsDays,
  });
});

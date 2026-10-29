import { z } from "zod";
import { json, route } from "@/lib/http";
import { assertBurnCaptions, captionUsage, postUsage, replyUsage, storageUsage, uploadLimitBytes } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";

const fin = (n: number) => (Number.isFinite(n) ? n : null);

/** What the signed-in workspace's plan allows right now. `null` = unlimited. */
export const GET = route(async (_req, { user }) => {
  const [posts, replies, captions, upload, storage] = await Promise.all([postUsage(user.id), replyUsage(user.id), captionUsage(user.id), uploadLimitBytes(user.id), storageUsage(user.id)]);
  return json({
    plan: { slug: posts.planSlug, name: posts.planName },
    posts: { limit: posts.postLimit || null, period: posts.postPeriod, used: posts.used, left: fin(posts.left) },
    replies: { limit: replies.replyLimit || null, used: replies.used, left: fin(replies.left) },
    captions: { ai: captions.aiCaptions, limit: captions.captionVideos || null, used: captions.used, left: fin(captions.left), burn: captions.burnCaptions },
    upload: { maxMb: upload.mb, planLimited: upload.planLimited },
    storage: { usedBytes: storage.usedBytes, limitBytes: storage.limitBytes || null, remainingBytes: storage.limitBytes ? storage.remainingBytes : null, over: storage.over, label: storage.label },
    source: posts.source,
  });
});

const Check = z.object({ feature: z.enum(["burn"]) });

/**
 * Asks before a client-side feature runs. 402 PLAN_LIMIT opens the upgrade popup.
 * Burn-in happens in the browser (canvas + MediaRecorder), so this is the gate for the app's UI, not DRM:
 * someone editing the page could still burn text into a video, the same as any video editor can.
 */
export const POST = route(async (req, { user }) => {
  Check.parse(await req.json());
  await assertBurnCaptions(user.id);
  return json({ ok: true });
});

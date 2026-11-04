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
 *
 * Honest about what this is: burn-in happens in the browser (canvas + MediaRecorder), so `burnCaptions` gates
 * Outlly's button, not the pixels. Someone editing the page could still burn text into their own video, the same
 * as any free video editor can, and no server check can prevent that. So the plan copy sells it as a feature of
 * the paid plans ("captions burned into the video"), never as something Outlly stops you doing elsewhere, and the
 * 402 message tells a Free user what they can still do today (post with the captions in the text).
 * Everything with a server-side cost -- posts, AI captions, replies, uploads, storage -- is enforced in
 * lib/billing/entitlements.ts on the action itself, not here.
 */
export const POST = route(async (req, { user }) => {
  Check.parse(await req.json());
  await assertBurnCaptions(user.id);
  return json({ ok: true });
});

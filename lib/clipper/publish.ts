import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { mediaView } from "../services";
import { logLearning } from "../intelligence/learning";
import { clipsWithPosts, ownedClip, type ClipPostView, type ClipView } from "./jobs";
import { parseSettings } from "./settings-core";
import { clipPrefill, platformPerformance, performanceLine, type ClipPlatformPerformance, type ClipPrefill } from "./publish-core";

/**
 * R1323: a rendered clip goes out through Create (/create?clip=<id>), like any other video: the composer gets the
 * rendered Media and the clip's words, the saved post is linked back to the clip, and the clip reads its post's
 * numbers from the same TargetMetric rows Insights uses. Every read and write checks the owner.
 */

const json = (v: unknown) => JSON.stringify(v);

/**
 * What Create needs to start a post from a clip; 409 until the clip is rendered, 409 ALREADY_POSTED (with the post
 * id) once it has a post. A clip whose post was deleted is unlinked here so it can be posted again.
 */
export async function clipForCreate(ownerId: string, clipId: string): Promise<{ clip: ClipView; media: Awaited<ReturnType<typeof mediaView>>; prefill: ClipPrefill }> {
  let c = await ownedClip(ownerId, clipId);
  if (c.status === "discarded") throw new HttpError(404, "That clip was discarded.", "DISCARDED");
  if (c.postId) {
    const post = await db.post.findFirst({ where: { id: c.postId, userId: ownerId }, select: { id: true } });
    if (post) throw new HttpError(409, "This clip already has a post. Open that post instead.", "ALREADY_POSTED", { postId: post.id });
    await db.generatedClip.updateMany({ where: { id: c.id, ownerId, postId: c.postId }, data: { postId: null, ...(c.status === "published" ? { status: "approved" } : {}) } });
    c = await ownedClip(ownerId, clipId);
  }
  if (c.renderStatus !== "rendered" || !c.mediaId) throw new HttpError(409, "Export the clip to 9:16 first, then post it.", "NOT_RENDERED");
  const [m, job] = await Promise.all([db.media.findFirst({ where: { id: c.mediaId, userId: ownerId, deletedAt: null } }), db.clipJob.findFirst({ where: { id: c.jobId, ownerId }, select: { settings: true } })]);
  if (!m) throw new HttpError(404, "The rendered file is gone. Export the clip again.", "NO_MEDIA");
  const settings = parseSettings(job?.settings ?? null);
  const [clip] = await clipsWithPosts(ownerId, [c]);
  return { clip, media: await mediaView(m), prefill: clipPrefill(c, settings.platforms) };
}

/**
 * Links a just-created post to the clip it was made from. Idempotent and quiet: a clip that already has another
 * post, a foreign clip or post, a discarded or unrendered clip, or a post whose video is not the clip's render
 * (the creator swapped the file in Create) is a no-op with a reason (the save must never fail over this).
 */
export async function attachClipToPost(ownerId: string, clipId: string, postId: string): Promise<{ ok: boolean; reason?: string }> {
  const [c, post] = await Promise.all([db.generatedClip.findFirst({ where: { id: clipId, ownerId } }), db.post.findFirst({ where: { id: postId, userId: ownerId }, select: { id: true, mediaId: true } })]);
  if (!c || !post) return { ok: false, reason: "not_found" };
  if (c.postId === post.id) return { ok: true };
  if (c.postId) return { ok: false, reason: "already_linked" };
  if (c.status === "discarded") return { ok: false, reason: "discarded" };
  if (c.renderStatus !== "rendered" || !c.mediaId) return { ok: false, reason: "not_rendered" };
  if (post.mediaId !== c.mediaId) return { ok: false, reason: "media_mismatch" };
  const n = await db.generatedClip.updateMany({ where: { id: c.id, ownerId, postId: null }, data: { postId: post.id } });
  if (!n.count) return { ok: false, reason: "already_linked" };
  await db.clipEvent.create({ data: { jobId: c.jobId, clipId: c.id, ownerId, actorId: ownerId, type: "post_created", data: json({ postId: post.id }) } });
  await logLearning(ownerId, "clip_post_created", { subjectType: "clip", subjectId: c.id, dedupeKey: `clip_post_created:${c.id}`, data: { jobId: c.jobId, postId: post.id, candidateId: c.candidateId } }).catch(() => false);
  return { ok: true };
}

export interface ClipPerformance {
  clip: ClipView;
  post: ClipPostView | null;
  platforms: ClipPlatformPerformance[];
  /** The one honest sentence for the row. */
  line: string;
}

/**
 * How the clip's post is doing, destination by destination. TargetMetric rows are deltas (one per sync that found a
 * change), so a destination's numbers are their sum, the same read Insights and the feature store do. Destinations
 * taken down through Outlly are left out.
 */
export async function clipPerformance(ownerId: string, clipId: string): Promise<ClipPerformance> {
  const [clip] = await clipsWithPosts(ownerId, [await ownedClip(ownerId, clipId)]);
  if (!clip.post) return { clip, post: null, platforms: [], line: performanceLine(null, []) };
  const post = await db.post.findFirst({
    where: { id: clip.post.id, userId: ownerId },
    select: { format: true, targets: { where: { practice: false, removedAt: null }, select: { id: true, platform: true, platformStatus: true, publishedAt: true, metricsCheckedAt: true } } },
  });
  const targets = post?.targets ?? [];
  const sums = targets.length ? await db.targetMetric.groupBy({ by: ["targetId"], where: { targetId: { in: targets.map((t) => t.id) } }, _sum: { views: true, likes: true, comments: true, shares: true, saves: true } }) : [];
  const byTarget = new Map(sums.map((s) => [s.targetId, s._sum]));
  const platforms = targets.map((t) => platformPerformance(t, post?.format ?? "video", byTarget.get(t.id) ?? null));
  return { clip, post: clip.post, platforms, line: performanceLine(clip.post, platforms) };
}

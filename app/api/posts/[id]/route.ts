import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { updatePostSchema } from "@/lib/validation";
import { launchPost, ownedPost, postView } from "@/lib/services";
import { enqueue } from "@/lib/queue";
import { supportsFirstComment } from "@/lib/domain";
import { deletePost } from "@/lib/posts/delete";
import { pinTargets } from "@/lib/profiles";
import { copyChanged } from "@/lib/collab-core";
import { recordEdit } from "@/lib/collab";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { user, params }) => json({ post: await postView(await ownedPost(user.id, params.id)) }), { limit: [600, 60_000] });

export const PATCH = route(async (req, { user, params }) => {
  const post = await ownedPost(user.id, params.id);
  const body = updatePostSchema.parse(await req.json());
  if (["publishing", "published"].includes(post.status)) throw new HttpError(409, "This one has already gone out.");
  if (body.scheduledAt) {
    const at = new Date(body.scheduledAt);
    if (at.getTime() < Date.now() + 60_000) throw new HttpError(400, "Pick a time at least a minute from now.");
    if (post.status === "draft" || post.status === "scheduled") {
      await db.post.update({ where: { id: post.id }, data: { scheduledAt: at } });
      if (post.status === "scheduled") await enqueue("SCHEDULED_POST", { postId: post.id }, { delayMs: at.getTime() - Date.now(), jobId: `sched-${post.id}-${at.getTime()}` });
    } else {
      // A failed or partly-sent post is being booked again: that is a launch, so it goes through launchPost
      // (connections, approval and the plan's post slot), never a bare status write. Editors can't launch (1037).
      if (user.role === "editor") throw new HttpError(403, "Editors can't publish. Send a review link, or ask the owner or a manager to launch it.", "ROLE");
      await launchPost(user.id, post.id, "schedule", at, "realistic");
    }
  }
  const changed = copyChanged(post, { title: body.title, targets: body.targets });
  const named = (body.targets ?? []).filter((t) => t.accountId);
  const pins = named.length ? await pinTargets(user, named, {}) : {};
  if (body.title !== undefined) await db.post.update({ where: { id: post.id }, data: { title: body.title } });
  if (body.requireApproval !== undefined) await db.post.update({ where: { id: post.id }, data: { requireApproval: body.requireApproval } });
  for (const t of body.targets ?? []) {
    await db.postTarget.updateMany({
      where: { postId: post.id, platform: t.platform },
      data: {
        ...(pins[t.platform] ? { socialAccountId: pins[t.platform] } : {}),
        title: t.title ?? undefined,
        caption: t.caption ?? undefined,
        description: t.description ?? undefined,
        hashtags: t.hashtags ?? undefined,
        ...(t.firstComment !== undefined && supportsFirstComment(t.platform) ? { firstComment: t.firstComment?.trim() || null } : {}),
      },
    });
  }
  if (changed) await recordEdit(user, post);
  return json({ post: await postView(await ownedPost(user.id, post.id)) });
});

/**
 * Remove from the studio (1089: lib/posts/delete.ts). With ?platforms=1 the live copies are deleted on every
 * platform that allows it first; if any of those fails, nothing is removed from the studio. Anything not yet
 * sent is stopped before the post goes, so a scheduled job can't publish it afterwards.
 */
export const DELETE = route(
  async (req, { user, params }) => {
    const q = new URL(req.url).searchParams;
    try {
      return json(await deletePost(user, params.id, { platforms: q.get("platforms") === "1", appOnlyAck: q.get("appOnly") === "ack" }));
    } catch (e) {
      // The sheet shows what changed (some platforms may have said yes before one said no).
      if (e instanceof HttpError && e.code === "REMOVE_FAILED") {
        const post = await db.post.findFirst({ where: { id: params.id, userId: user.id }, include: { targets: true, media: true, reviews: { orderBy: { createdAt: "desc" } } } });
        throw new HttpError(409, e.message, e.code, { ...(e.extra ?? {}), ...(post ? { post: await postView(post) } : {}) });
      }
      throw e;
    }
  },
  { limit: [30, 60_000] },
);

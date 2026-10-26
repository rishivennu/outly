import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { updatePostSchema } from "@/lib/validation";
import { launchPost, ownedPost, postView } from "@/lib/services";
import { enqueue } from "@/lib/queue";
import { isPlatform, PLATFORM_META, REMOVAL, supportsFirstComment, type Platform } from "@/lib/domain";
import { removeEverywhere } from "@/lib/social/remove";

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
      // (connections, approval and the plan's post slot), never a bare status write.
      await launchPost(user.id, post.id, "schedule", at, "realistic");
    }
  }
  if (body.title !== undefined) await db.post.update({ where: { id: post.id }, data: { title: body.title } });
  if (body.requireApproval !== undefined) await db.post.update({ where: { id: post.id }, data: { requireApproval: body.requireApproval } });
  for (const t of body.targets ?? []) {
    await db.postTarget.updateMany({
      where: { postId: post.id, platform: t.platform },
      data: {
        title: t.title ?? undefined,
        caption: t.caption ?? undefined,
        description: t.description ?? undefined,
        hashtags: t.hashtags ?? undefined,
        ...(t.firstComment !== undefined && supportsFirstComment(t.platform) ? { firstComment: t.firstComment?.trim() || null } : {}),
      },
    });
  }
  return json({ post: await postView(await ownedPost(user.id, post.id)) });
});

/**
 * Remove from the studio. With ?platforms=1 the live copies are deleted on every platform that allows it first;
 * if any of those fails, nothing is removed from the studio, so the creator can retry without losing the links.
 */
export const DELETE = route(async (req, { user, params }) => {
  const post = await ownedPost(user.id, params.id);
  if (post.status === "publishing") throw new HttpError(409, "Let it finish sending first.");
  const q = new URL(req.url).searchParams;
  if (q.get("platforms") === "1") {
    // Instagram/TikTok copies can't be deleted by API; their links vanish with the studio record, so the
    // caller must confirm the creator saw the "delete it in the app" step (the sheet sends appOnly=ack).
    const appOnly = post.targets.filter((t) => t.platformStatus === "published" && t.platformPostId && t.removeMode !== "deleted" && isPlatform(t.platform) && !REMOVAL[t.platform].delete);
    if (appOnly.length && q.get("appOnly") !== "ack")
      throw new HttpError(409, `${appOnly.map((t) => PLATFORM_META[t.platform as Platform].name).join(" and ")} can't be deleted from here. Delete ${appOnly.length === 1 ? "it" : "those"} in the app first.`, "APP_ONLY_LIVE");
    const results = await removeEverywhere(user.id, post.id);
    const failed = results.filter((r) => !r.ok);
    if (failed.length)
      throw new HttpError(409, `Couldn't take it down everywhere, so it's still in your studio. ${failed.map((f) => f.message).join(" ")}`, "REMOVE_FAILED", {
        results,
        post: await postView(await ownedPost(user.id, post.id)),
      });
  }
  await db.post.delete({ where: { id: post.id } });
  return json({ ok: true });
});

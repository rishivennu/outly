import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { updatePostSchema } from "@/lib/validation";
import { ownedPost, postView } from "@/lib/services";
import { enqueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { user, params }) => json({ post: await postView(await ownedPost(user.id, params.id)) }), { limit: [600, 60_000] });

export const PATCH = route(async (req, { user, params }) => {
  const post = await ownedPost(user.id, params.id);
  const body = updatePostSchema.parse(await req.json());
  if (["publishing", "published"].includes(post.status)) throw new HttpError(409, "This one has already gone out.");
  if (body.scheduledAt) {
    const at = new Date(body.scheduledAt);
    if (at.getTime() < Date.now() + 60_000) throw new HttpError(400, "Pick a time at least a minute from now.");
    await db.post.update({ where: { id: post.id }, data: { scheduledAt: at, status: post.status === "draft" ? "draft" : "scheduled" } });
    if (post.status === "scheduled") await enqueue("SCHEDULED_POST", { postId: post.id }, { delayMs: at.getTime() - Date.now(), jobId: `sched-${post.id}-${at.getTime()}` });
  }
  if (body.title !== undefined) await db.post.update({ where: { id: post.id }, data: { title: body.title } });
  if (body.requireApproval !== undefined) await db.post.update({ where: { id: post.id }, data: { requireApproval: body.requireApproval } });
  for (const t of body.targets ?? []) {
    await db.postTarget.updateMany({
      where: { postId: post.id, platform: t.platform },
      data: { title: t.title ?? undefined, caption: t.caption ?? undefined, description: t.description ?? undefined, hashtags: t.hashtags ?? undefined },
    });
  }
  return json({ post: await postView(await ownedPost(user.id, post.id)) });
});

export const DELETE = route(async (_req, { user, params }) => {
  const post = await ownedPost(user.id, params.id);
  if (post.status === "publishing") throw new HttpError(409, "Let it finish sending first.");
  await db.post.delete({ where: { id: post.id } });
  return json({ ok: true });
});

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
import { noticeScheduleChange } from "@/lib/notify-events";
import { DRAFT_CONFLICT_MESSAGE, draftConflict, serverDraft, StaleDraftError } from "@/lib/posts/conflicts";
import { assertPostSchedulable } from "@/lib/posts/guard-server";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { user, params }) => json({ post: await postView(await ownedPost(user.id, params.id)) }), { limit: [600, 60_000] });

export const PATCH = route(async (req, { user, params }) => {
  const post = await ownedPost(user.id, params.id);
  const body = updatePostSchema.parse(await req.json());
  if (["publishing", "published"].includes(post.status)) throw new HttpError(409, "This one has already gone out.");
  const edit = { title: body.title, story: body.story, hook: body.hook, targets: body.targets };
  // Phase 2: an edit made on an older copy than the one stored, that would overwrite a different change, changes nothing.
  const theirs = draftConflict(post, edit, body.baseUpdatedAt);
  if (theirs) throw new HttpError(409, DRAFT_CONFLICT_MESSAGE, "draft_conflict", { server: theirs });
  const at = body.scheduledAt ? new Date(body.scheduledAt) : null;
  if (at) {
    if (at.getTime() < Date.now() + 60_000) throw new HttpError(400, "Pick a time at least a minute from now.");
    // Phase 2: same media on the same account within 10 minutes (409), or a platform rule it would break (422).
    await assertPostSchedulable(user.id, post.id, at, body.targets);
    // A failed or partly-sent post booked again is a launch, and editors can't launch (1037): refused before anything is written.
    if (post.status !== "draft" && post.status !== "scheduled" && user.role === "editor") throw new HttpError(403, "Editors can't publish. Send a review link, or ask the owner or a manager to launch it.", "ROLE");
  }
  const changed = copyChanged(post, edit);
  const named = (body.targets ?? []).filter((t) => t.accountId);
  const pins = named.length ? await pinTargets(user, named, {}) : {};
  const words = body.title !== undefined || body.story !== undefined || body.hook !== undefined;
  // Phase 2: the words go first and, with a base, only onto the copy checked above. A save from another device
  // in between makes this a conflict (nothing written) instead of a silent overwrite.
  try {
    await db.$transaction(async (tx) => {
      if (words || (body.baseUpdatedAt && body.targets?.length)) {
        const n = await tx.post.updateMany({ where: { id: post.id, ...(body.baseUpdatedAt ? { updatedAt: post.updatedAt } : {}) }, data: words ? { title: body.title, story: body.story, hook: body.hook } : { updatedAt: new Date() } });
        if (!n.count) throw new StaleDraftError();
      }
      for (const t of body.targets ?? []) {
        await tx.postTarget.updateMany({
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
    }, { timeout: 15_000 });
  } catch (e) {
    if (e instanceof StaleDraftError) throw new HttpError(409, DRAFT_CONFLICT_MESSAGE, "draft_conflict", { server: serverDraft(await ownedPost(user.id, post.id)) });
    throw e;
  }
  if (body.requireApproval !== undefined) await db.post.update({ where: { id: post.id }, data: { requireApproval: body.requireApproval } });
  if (at) {
    if (post.status === "draft" || post.status === "scheduled") {
      await db.post.update({ where: { id: post.id }, data: { scheduledAt: at } });
      if (post.status === "scheduled") await enqueue("SCHEDULED_POST", { postId: post.id }, { delayMs: at.getTime() - Date.now(), jobId: `sched-${post.id}-${at.getTime()}` });
      // 1118: a team member moved the owner's scheduled post. The owner moving their own stays quiet.
      if (post.status === "scheduled" && user.actor && post.scheduledAt?.getTime() !== at.getTime()) await noticeScheduleChange(post, user.actor.name, at, user.timezone);
    } else {
      // A failed or partly-sent post is being booked again: that is a launch, so it goes through launchPost
      // (connections, approval and the plan's post slot), never a bare status write.
      await launchPost(user.id, post.id, "schedule", at, "realistic");
    }
  }
  if (changed) await recordEdit(user, post);
  const view = await postView(await ownedPost(user.id, post.id));
  return json({ post: view, updatedAt: view.updatedAt });
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
      const appOnly = q.get("appOnly");
      return json(await deletePost(user, params.id, { platforms: q.get("platforms") === "1", appOnlyAck: appOnly === "ack" || appOnly === "verify", verify: appOnly === "verify" }));
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

import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { cancelTargets, ownedPost, postView } from "@/lib/services";
import { releaseXPost } from "@/lib/billing/entitlements";
import { releasePostSlot } from "@/lib/posts/delete";
import { noticeScheduleChange } from "@/lib/notify-events";

/**
 * Sending now: stop every destination that hasn't reached its platform yet; the rest keep going.
 * Booked for later (Phase 2): take it off the schedule. It goes back to a draft (or stays "partial" when part of
 * it is already live), the waiting job bows out because the post is no longer "scheduled", and the plan's slot
 * and X allowance held for it are given back when nothing of it went out.
 */
export const POST = route(
  async (_req, { user, params }) => {
    const post = await ownedPost(user.id, params.id);
    if (post.status === "scheduled") {
      const live = post.targets.some((t) => t.platformStatus === "published");
      // Conditional, so a worker that claimed it a moment ago wins and the creator gets the Stop path instead.
      const off = await db.post.updateMany({ where: { id: post.id, userId: user.id, status: "scheduled" }, data: { status: live ? "partial" : "draft", scheduledAt: null } });
      if (off.count === 1) {
        for (const t of post.targets) if (t.platform === "x" && t.platformStatus !== "published") await releaseXPost(t.id);
        if (!live) await releasePostSlot(user.id, post.id, new Date(), { booked: true }).catch((e) => console.error("[unschedule] slot", e));
        if (user.actor) await noticeScheduleChange(post, user.actor.name, null, user.timezone);
        return json({ post: await postView(await ownedPost(user.id, post.id)), stopped: 0, unscheduled: true });
      }
    }
    const stopped = await cancelTargets(user.id, params.id);
    return json({ post: await postView(await ownedPost(user.id, params.id)), stopped });
  },
  { limit: [20, 60_000] },
);

import "server-only";
import type { z } from "zod";
import { db } from "../db";
import { HttpError } from "../http";
import { PLATFORM_META, type Platform } from "../domain";
import type { bulkScheduleSchema } from "../validation";
import { connectedAccounts, launchPost, ownedMedia, ownedPost, postView, type PostView } from "../services";
import { postUsage } from "../billing/entitlements";
import { getBestTimes } from "../schedule/best-time-server";
import { spreadSlots } from "../schedule/spread";
import { BULK_MAX, bulkTargets } from "./bulk";

/** Suggested times for a batch: best hours, spread over the days ahead, clear of what is already booked. */
export async function planBatch(userId: string, platforms: Platform[], count: number, tz: string) {
  const n = Math.min(BULK_MAX, Math.max(1, Math.floor(count) || 1));
  const [best, booked, usage] = await Promise.all([
    getBestTimes(userId, platforms, tz),
    db.post.findMany({ where: { userId, status: "scheduled", scheduledAt: { gte: new Date() } }, select: { scheduledAt: true }, take: 300 }),
    postUsage(userId),
  ]);
  const slots = spreadSlots({ count: n, peakHours: best.peakHours, tz, taken: booked.map((b) => b.scheduledAt!) });
  return { slots, peakHours: best.peakHours, source: best.source, reason: best.reason, left: Number.isFinite(usage.left) ? usage.left : null, planName: usage.planName };
}

/**
 * Book a batch. Everything that can be checked up front is (connections, plan, ownership, times), so a batch
 * either books whole or not at all for those reasons. A post that still trips on launch stays a draft and is
 * reported by index; the rest go ahead.
 */
export async function bookBatch(userId: string, body: z.infer<typeof bulkScheduleSchema>) {
  const platforms = [...new Set(body.platforms)];

  const accounts = await connectedAccounts(userId);
  const missing = platforms.find((p) => accounts.get(p)?.status !== "connected");
  if (missing) throw new HttpError(409, `${PLATFORM_META[missing].name} needs you to connect it first.`, "NOT_CONNECTED");

  const usage = await postUsage(userId);
  if (Number.isFinite(usage.left) && usage.left < body.items.length)
    throw new HttpError(
      402,
      usage.left === 0
        ? `You've used all ${usage.postLimit} posts on ${usage.planName} this month. Upgrade in Billing for more, or wait until the 1st.`
        : `${usage.planName} has ${usage.left} post${usage.left === 1 ? "" : "s"} left this month. Pick ${usage.left} or fewer, or upgrade in Billing.`,
      "PLAN_LIMIT",
    );

  const soon = Date.now() + 60_000;
  body.items.forEach((it, i) => {
    if (new Date(it.scheduledAt).getTime() < soon) throw new HttpError(400, `Video ${i + 1}: pick a time at least a minute from now.`);
  });
  await Promise.all(body.items.map((it) => ownedMedia(userId, it.mediaId)));

  const posts: PostView[] = [];
  const failed: { index: number; message: string }[] = [];
  for (const [index, it] of body.items.entries()) {
    const post = await db.post.create({
      data: { userId, mediaId: it.mediaId, title: it.title?.trim() || null, targets: { create: bulkTargets(it, platforms) } },
    });
    try {
      await launchPost(userId, post.id, "schedule", new Date(it.scheduledAt), "realistic");
    } catch (e) {
      failed.push({ index, message: e instanceof HttpError ? e.message : "Something got in the way. It's saved as a draft." });
    }
    posts.push(await postView(await ownedPost(userId, post.id)));
  }
  return { posts, failed };
}

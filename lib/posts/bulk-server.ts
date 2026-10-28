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
import { BULK_MAX, accountRounds, bulkTargets } from "./bulk";
import { requestScope } from "../profiles";
import { inScope, pickAccount } from "../profiles-core";

/** Suggested times for a batch: best hours, spread over the days ahead, clear of what is already booked. */
export async function planBatch(userId: string, platforms: Platform[], count: number, tz: string) {
  const n = Math.min(BULK_MAX, Math.max(1, Math.floor(count) || 1));
  const [best, booked, usage] = await Promise.all([
    getBestTimes(userId, platforms, tz),
    db.post.findMany({ where: { userId, status: "scheduled", scheduledAt: { gte: new Date() } }, select: { scheduledAt: true }, take: 300 }),
    postUsage(userId),
  ]);
  const slots = spreadSlots({ count: n, peakHours: best.peakHours, tz, taken: booked.map((b) => b.scheduledAt!) });
  return { slots, peakHours: best.peakHours, source: best.source, reason: best.reason, left: Number.isFinite(usage.left) ? usage.left : null, planName: usage.planName, period: usage.postPeriod };
}

/**
 * Book a batch. Everything that can be checked up front is (connections, plan, ownership, times), so a batch
 * either books whole or not at all for those reasons. A post that still trips on launch stays a draft and is
 * reported by index; the rest go ahead.
 */
export async function bookBatch(userId: string, body: z.infer<typeof bulkScheduleSchema>) {
  const accounts = await connectedAccounts(userId);
  // 1037: named accounts become rounds (one post per video per round). Without them it's the old behaviour:
  // one post per video to each platform's default account.
  let rounds: { platform: Platform; accountId: string | null }[][];
  const scope = await requestScope(userId);
  if (body.accountIds?.length) {
    const picked = body.accountIds.map((id) => accounts.all.find((a) => a.id === id));
    const bad = picked.findIndex((a) => !a || !inScope(scope, a.id));
    if (bad >= 0) throw new HttpError(403, "One of those accounts isn't one you can post to here.", "ROLE");
    const off = picked.find((a) => a!.status !== "connected");
    if (off) throw new HttpError(409, `@${off.username} on ${PLATFORM_META[off.platform as Platform]?.name ?? off.platform} needs reconnecting first.`, "NOT_CONNECTED");
    rounds = accountRounds(picked.map((a) => ({ id: a!.id, platform: a!.platform as Platform }))).map((r) => r.map((a) => ({ platform: a.platform, accountId: a.id })));
  } else {
    const platforms = [...new Set(body.platforms)];
    // A member limited to some accounts is checked against theirs (launch pins the same one through pickAccount).
    const missing = platforms.find((p) => (scope ? pickAccount(p, null, accounts.all, scope) : accounts.get(p))?.status !== "connected");
    if (missing) throw new HttpError(409, `${PLATFORM_META[missing].name} needs you to connect it first.`, "NOT_CONNECTED");
    rounds = [platforms.map((platform) => ({ platform, accountId: null }))];
  }
  const total = body.items.length * rounds.length;

  const usage = await postUsage(userId);
  const per = usage.postPeriod === "week" ? "this week" : "this month";
  if (Number.isFinite(usage.left) && usage.left < total)
    throw new HttpError(
      402,
      usage.left === 0
        ? `You've used all ${usage.postLimit} posts on ${usage.planName} ${per}. Upgrade to post more, or ${usage.postPeriod === "week" ? "wait until Monday" : "wait until the 1st"}.`
        : `${usage.planName} has ${usage.left} post${usage.left === 1 ? "" : "s"} left ${per} and this batch is ${total}. Pick fewer, or upgrade to post more.`,
      "PLAN_LIMIT",
      { feature: "posts", upgrade: "/billing" },
    );

  const soon = Date.now() + 60_000;
  body.items.forEach((it, i) => {
    if (new Date(it.scheduledAt).getTime() < soon) throw new HttpError(400, `Video ${i + 1}: pick a time at least a minute from now.`);
  });
  await Promise.all(body.items.map((it) => ownedMedia(userId, it.mediaId)));

  const posts: PostView[] = [];
  const failed: { index: number; postId: string; message: string }[] = [];
  for (const [index, it] of body.items.entries()) {
    for (const round of rounds) {
      const pin = new Map(round.map((r) => [r.platform, r.accountId]));
      const post = await db.post.create({
        data: { userId, mediaId: it.mediaId, title: it.title?.trim() || null, targets: { create: bulkTargets(it, round.map((r) => r.platform)).map((t) => ({ ...t, socialAccountId: pin.get(t.platform) ?? null })) } },
      });
      try {
        await launchPost(userId, post.id, "schedule", new Date(it.scheduledAt), "realistic");
      } catch (e) {
        failed.push({ index, postId: post.id, message: e instanceof HttpError ? e.message : "Something got in the way. It's saved as a draft." });
      }
      posts.push(await postView(await ownedPost(userId, post.id)));
    }
  }
  return { posts, failed };
}

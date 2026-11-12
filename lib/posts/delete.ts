import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { isPlatform, PLATFORM_META, REMOVAL, STOPPABLE, type Platform } from "../domain";
import { confirmGone, markDeleted, removeEverywhere } from "../social/remove";
import { periodKey, postUsage } from "../billing/entitlements";
import { refundCredit } from "../billing/topups";
import { syncPost } from "../queue/handlers";
import { storage } from "../storage";
import { invalidate } from "../cache";
import { assertPostScope } from "../profiles";

/**
 * 1089: removing a post from Outlly, safely.
 *
 * 1. Not sent yet (draft, scheduled, or still waiting/uploading): every destination that hasn't reached its
 *    platform is marked CANCELED first. Workers check that marker before each step, and once the row is gone
 *    they find nothing, so a booked post can't go out after the creator deleted it.
 * 2. A platform already has it and is finishing it ("processing"): that can't be called back, so nothing is
 *    removed and the creator is told to wait until it is live, then delete it there.
 * 3. Live: deleting on the platform happens only with ?platforms=1 (the creator confirmed it), and only where
 *    the platform's API allows it. Instagram and TikTok can't: the creator acknowledges that (appOnly=ack).
 *    If any platform delete fails, nothing is removed from Outlly, so the links aren't lost.
 * 4. 1142: Instagram and TikTok with appOnly=verify: the creator deleted it in the app first, and Outlly checks the
 *    platform no longer has it (confirmGone) before anything is removed. Still there, or no answer: nothing changes.
 * 5. 1142: the post's slot for this period is given back (and a top-up unit refunded), so the creator can post
 *    another one at once; the answer carries the fresh count for the toast and the quota on screen.
 */
export type RemoteOutcome = { platform: string; outcome: "deleted" | "failed" | "manual" | "kept"; message?: string; url?: string | null };
/** Posts left this period after the delete; `left` null = no limit on this plan. */
export type DeleteQuota = { used: number; left: number | null; limit: number; period: "week" | "month"; freed: boolean };
export type DeleteResult = { ok: true; local: "deleted" | "already_gone"; stopped: number; remote: RemoteOutcome[]; quota: DeleteQuota | null };
export type DeleteOpts = { platforms: boolean; appOnlyAck: boolean; verify?: boolean };

/** In-flight deletes on this instance: a double click or two tabs get the first one's answer. */
const running = new Map<string, Promise<DeleteResult>>();

export function deletePost(user: { id: string; role?: string | null }, postId: string, opts: DeleteOpts) {
  const k = `${user.id}:${postId}:${opts.platforms ? 1 : 0}`;
  const r = running.get(k);
  if (r) return r;
  const p = run(user, postId, opts).finally(() => running.delete(k));
  running.set(k, p);
  return p;
}

/**
 * 1142: deleting a post gives its post slot back for the current period (week or month, whichever the plan
 * counts), and a slot paid from a top-up pack goes back to the pack. Earlier periods are history and stay.
 */
export async function releasePostSlot(userId: string, postId: string, now = new Date()) {
  const rows = await db.featureUse.findMany({ where: { userId, feature: "post", ref: postId.slice(0, 120), period: { in: [periodKey("week", now), periodKey("month", now)] } }, select: { id: true, topUpId: true } });
  let freed = 0;
  for (const r of rows) {
    const gone = await db.featureUse.deleteMany({ where: { id: r.id } });
    freed += gone.count;
    if (gone.count === 1 && r.topUpId) await refundCredit(r.topUpId).catch(() => {});
  }
  return freed;
}

async function quotaNow(userId: string, freed: boolean): Promise<DeleteQuota | null> {
  try {
    const u = await postUsage(userId);
    return { used: u.used, left: Number.isFinite(u.left) ? u.left : null, limit: u.postLimit, period: u.postPeriod, freed };
  } catch {
    return null;
  }
}

const nameOf = (p: string) => (isPlatform(p) ? PLATFORM_META[p as Platform].name : p);

async function run(user: { id: string; role?: string | null }, postId: string, opts: DeleteOpts): Promise<DeleteResult> {
  const post = await db.post.findFirst({ where: { id: postId, userId: user.id }, include: { targets: true } });
  if (!post) return { ok: true, local: "already_gone", stopped: 0, remote: [], quota: await quotaNow(user.id, false) };
  await assertPostScope(user.id, post.targets); // 1037: a member limited to some accounts can't delete the others' posts
  if (opts.platforms && user.role === "editor") throw new HttpError(403, "Editors can't delete posts from the platforms. Ask the owner or a manager.", "ROLE");

  const appOnlyLive = post.targets.filter((t) => t.platformStatus === "published" && t.platformPostId && t.removeMode !== "deleted" && !t.practice && isPlatform(t.platform) && !REMOVAL[t.platform as Platform].delete);
  if (opts.platforms && appOnlyLive.length && !opts.appOnlyAck)
    throw new HttpError(409, `${appOnlyLive.map((t) => PLATFORM_META[t.platform as Platform].name).join(" and ")} can't be deleted from here. Delete ${appOnlyLive.length === 1 ? "it" : "those"} in the app first.`, "APP_ONLY_LIVE");

  // 1142: checked before anything is stopped or removed, so "still there" leaves the post exactly as it was.
  // Read-only until every one is checked: a "still live" on one never leaves another half-recorded.
  const verified: string[] = [];
  const goneIds: string[] = [];
  if (opts.platforms && opts.verify && appOnlyLive.length) {
    const still: string[] = [];
    const unsure: string[] = [];
    for (const t of appOnlyLive) {
      const s = await confirmGone(user.id, t.id, false);
      if (s === "gone") (verified.push(t.platform), goneIds.push(t.id));
      else (s === "live" ? still : unsure).push(nameOf(t.platform));
    }
    if (still.length)
      throw new HttpError(409, `It's still live on ${still.join(" and ")}. Delete it in the ${still.join(" and ")} app first, then press Delete again. Nothing was removed.`, "STILL_LIVE", { url: appOnlyLive.find((t) => still.includes(nameOf(t.platform)))?.platformUrl ?? null });
    if (unsure.length)
      throw new HttpError(409, `We couldn't check ${unsure.join(" and ")} just now, so nothing was removed. Try again in a minute, or remove it from your studio only.`, "CANT_CHECK");
    for (const id of goneIds) await markDeleted(user.id, id);
  }

  // Stop everything not yet handed to a platform BEFORE deciding, so nothing can start in between.
  const stopped = await db.postTarget.updateMany({
    where: { postId, platformStatus: { in: [...STOPPABLE] } },
    data: { platformStatus: "failed", errorCode: "CANCELED", errorMessage: "Stopped because the post was deleted." },
  });
  const fresh = await db.postTarget.findMany({ where: { postId } });
  const inFlight = fresh.filter((t) => t.platformStatus === "processing");
  if (inFlight.length) {
    if (stopped.count) await syncPost(postId);
    const names = inFlight.map((t) => (isPlatform(t.platform) ? PLATFORM_META[t.platform as Platform].name : t.platform)).join(" and ");
    throw new HttpError(409, `${names} already has this video and is finishing it, so it can't be called back. Wait until it's live, then delete it here or in the app.${stopped.count ? " Everything else was stopped." : ""}`, "IN_FLIGHT");
  }

  const live = fresh.filter((t) => t.platformStatus === "published" && t.platformPostId && t.removeMode !== "deleted");
  const appOnly = live.filter((t) => !t.practice && isPlatform(t.platform) && !REMOVAL[t.platform as Platform].delete);
  const remote: RemoteOutcome[] = [];
  if (opts.platforms) {
    const results = await removeEverywhere(user.id, postId);
    const failed = results.filter((r) => !r.ok);
    if (failed.length)
      throw new HttpError(409, `Couldn't take it down everywhere, so it's still in your studio${stopped.count ? " (anything not sent yet was stopped)" : ""}. ${failed.map((f) => f.message).join(" ")}`, "REMOVE_FAILED", {
        results: results.map((r) => ({ platform: r.platform, outcome: r.ok ? "deleted" : "failed", message: r.ok ? undefined : r.message })),
      });
    for (const r of results) remote.push({ platform: r.platform, outcome: "deleted" });
    for (const p of verified) remote.push({ platform: p, outcome: "deleted" });
    for (const t of appOnly) remote.push({ platform: t.platform, outcome: "manual", url: t.platformUrl });
  } else {
    for (const t of live) if (!t.practice) remote.push({ platform: t.platform, outcome: "kept", url: t.platformUrl });
  }

  // deleteMany: a second, racing delete finds nothing and is still a success.
  const gone = await db.post.deleteMany({ where: { id: postId, userId: user.id } });
  if (post.coverKey) await storage.remove(post.coverKey).catch(() => {});
  const freed = gone.count ? await releasePostSlot(user.id, postId).catch((e) => (console.error("[delete] slot", e), 0)) : 0;
  invalidate(`insights:${user.id}:${postId}`);
  invalidate(`pulse:${user.id}:`);
  console.info(`[delete] post ${postId} local=${gone.count ? "deleted" : "already_gone"} stopped=${stopped.count} freed=${freed} remote=${remote.map((r) => `${r.platform}:${r.outcome}`).join(",") || "-"}`);
  return { ok: true, local: gone.count ? "deleted" : "already_gone", stopped: stopped.count, remote, quota: await quotaNow(user.id, freed > 0) };
}

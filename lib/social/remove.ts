import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { isPlatform, PLATFORM_META, REMOVAL, type Platform } from "../domain";
import { liveAccount } from "../live/account";
import { invalidateDashboards } from "../live";
import { invalidateComments } from "../inbox";
import { publisherForAccount } from "./registry";
import { asPublisherError } from "./types";

export type RemoveAction = "delete" | "hide" | "show";

/** The platform already has no such post: that's the outcome the creator asked for, not a failure. */
function alreadyGone(technical?: string) {
  // 404 (YouTube, X, LinkedIn), videoNotFound (YouTube), Graph subcode 33 = "object does not exist" (Facebook, Threads).
  return !!technical && (/HTTP 404\b/.test(technical) || /"error_subcode"\s*:\s*33\b|videoNotFound/.test(technical));
}

/**
 * Take one live post down on the platform itself (or hide / show it again on YouTube).
 * The studio record stays, marked removed, so history and stats stay true and "Delete" never orphans a live post.
 */
export async function removeFromPlatform(userId: string, targetId: string, action: RemoveAction) {
  const t = await db.postTarget.findFirst({ where: { id: targetId, post: { userId } }, include: { socialAccount: true } });
  if (!t) throw new HttpError(404, "We couldn't find that destination.");
  if (!isPlatform(t.platform)) throw new HttpError(400, "Unknown platform");
  const platform: Platform = t.platform;
  const name = PLATFORM_META[platform].name;
  const can = REMOVAL[platform];

  if (t.platformStatus !== "published" || !t.platformPostId) throw new HttpError(409, `This one isn't live on ${name}, so there's nothing to take down.`);
  if (t.removeMode === "deleted") return t; // already done: a second click changes nothing
  if (action === "delete" && !can.delete)
    throw new HttpError(409, `${name} doesn't let apps delete posts. Open it in the ${name} app and delete it there.`, "NOT_SUPPORTED", { url: t.platformUrl });
  if (action !== "delete" && !can.hide) throw new HttpError(409, `${name} can't hide a post from here, only delete it.`, "NOT_SUPPORTED");
  if (action === "hide" && t.removeMode === "hidden") return t;
  if (action === "show" && t.removeMode !== "hidden") return t;

  // A delete that reached the platform but whose save failed leaves "deleting" behind. Retrying it, the
  // platform's "no such post" (or X/Graph's 200 deleted=false) means the first attempt worked.
  const finishing = action === "delete" && t.removeMode === "deleting";
  // What to restore if the delete fails. "deleting" never touches removedAt, so a set removedAt means it was hidden.
  const before = finishing ? (t.removedAt ? "hidden" : null) : t.removeMode;
  // Practice posts never reached a real platform: there's nothing to call.
  if (!t.practice) {
    const acct = t.socialAccount;
    if (!acct || acct.status !== "connected")
      throw new HttpError(409, `Reconnect ${name} first. Outlly needs the connection to take the post down.`, "NOT_CONNECTED");
    const publisher = publisherForAccount(platform, acct);
    // Write the intent BEFORE the irreversible call, so a crash or a failed save afterwards can't leave a
    // post that's gone from the platform still looking live with no trace of what happened.
    if (action === "delete" && !finishing) await db.postTarget.update({ where: { id: t.id }, data: { removeMode: "deleting" } });
    try {
      const ctx = await liveAccount(acct);
      if (action === "delete") await publisher.delete(ctx, t.platformPostId);
      else if (publisher.setVisibility) await publisher.setVisibility(ctx, t.platformPostId, action === "show");
      else throw new HttpError(409, `${name} can't hide a post from here, only delete it.`, "NOT_SUPPORTED");
    } catch (e) {
      const pe = e instanceof HttpError ? null : asPublisherError(e);
      const gone = !!pe && action === "delete" && (alreadyGone(pe.technical) || (finishing && /deleted=false|success=false/.test(pe.technical ?? "")));
      // Anything but "it's gone": the post is still up, so put the marker back the way it was.
      if (action === "delete" && !gone) await db.postTarget.update({ where: { id: t.id }, data: { removeMode: before } }).catch(() => {});
      if (!pe) throw e;
      if (gone) {
        // fall through: record it as deleted
      } else if (pe.code === "AUTH_EXPIRED") {
        await db.socialAccount.update({ where: { id: acct.id }, data: { status: "needs_reconnect" } });
        throw new HttpError(409, `${name} needs you to sign in again. Reconnect it in Accounts, then try once more.`, "AUTH_EXPIRED");
      } else if (pe.code === "FORBIDDEN") {
        throw new HttpError(409, `${name} didn't give Outlly permission to do that. Reconnect ${name} once (it asks for the new permission), then try again.`, "FORBIDDEN");
      } else if (pe.code === "RATE_LIMITED" || pe.code === "NETWORK" || pe.code === "PLATFORM_DOWN") {
        throw new HttpError(503, `We couldn't reach ${name} just now. Nothing changed; try again in a minute.`, pe.code);
      } else {
        console.warn(`[remove] ${platform} ${action} ${t.id}: ${pe.technical ?? pe.message}`);
        throw new HttpError(502, `${name} didn't take it down: ${pe.message}`, pe.code);
      }
    }
  }

  const data =
    action === "delete"
      ? { removedAt: new Date(), removeMode: "deleted", platformUrl: null }
      : action === "hide"
        ? { removedAt: new Date(), removeMode: "hidden" }
        : { removedAt: null, removeMode: null };
  // The platform has already acted; try hard to record it (3 tries) so the studio matches reality.
  let updated: Awaited<ReturnType<typeof db.postTarget.update>> | undefined;
  for (let i = 0; !updated; i++) {
    try {
      updated = await db.postTarget.update({ where: { id: t.id }, data });
    } catch (e) {
      if (i >= 2) {
        console.error(`[remove] ${platform} ${action} ${t.id} done on the platform but not saved`, e);
        throw new HttpError(503, `It's ${action === "delete" ? "deleted from" : "changed on"} ${name}, but we couldn't save that here. Press it once more to finish.`, "SAVE_FAILED");
      }
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  invalidateComments(t.id);
  invalidateDashboards(userId);
  return updated;
}

export type EverywhereResult = { platform: Platform; ok: boolean; message?: string };

/**
 * Delete every live copy the platforms let us delete. Instagram and TikTok are skipped (their APIs refuse);
 * the caller shows their links first so the creator can remove those by hand.
 */
export async function removeEverywhere(userId: string, postId: string): Promise<EverywhereResult[]> {
  const targets = await db.postTarget.findMany({ where: { postId, post: { userId }, platformStatus: "published", platformPostId: { not: null } } });
  const out: EverywhereResult[] = [];
  for (const t of targets) {
    if (!isPlatform(t.platform) || !REMOVAL[t.platform].delete || t.removeMode === "deleted") continue;
    try {
      await removeFromPlatform(userId, t.id, "delete");
      out.push({ platform: t.platform, ok: true });
    } catch (e) {
      out.push({ platform: t.platform, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

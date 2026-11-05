import "server-only";
import { db } from "../db";
import { PLATFORM_META, isPlatform } from "../domain";
import { isPracticeAccount } from "../social/registry";
import { notify, type PushExtras } from "./notices";
import type { PushAction } from "../push/webpush";
import { noticeKey } from "./core";

/**
 * 1139: the publishing tracker's lock-screen notifications, one per post.
 *
 * Called from lib/queue/handlers.ts syncPost, so it runs on the real job events and never on a timer:
 *  - started: the first destination has begun uploading;
 *  - live: the send settled with at least one place live;
 *  - failed / needs action: a destination gave up for good (the creator stopped it themselves stays quiet).
 *
 * Everything goes through notify() in lib/retention/notices.ts, so the creator's notification settings and
 * quiet hours decide where it lands (lib/notify-core decide), it is recorded in the bell, and a key is only
 * ever used once. Every message carries the same device tag, `post:<id>`, so each update replaces the last one
 * on the lock screen instead of stacking up.
 *
 * The live and failure stages deliberately use the keys noticeFailedTarget and noticePostLive use
 * (lib/retention/core noticeKey), so those two never add a second notice or a second push for the same thing.
 * The difference is the link: a failure opens the post's own recovery screen (/create?post=...), where Retry,
 * Reconnect and the technical detail are, not the general failed list.
 *
 * A failure also asks for `keepOpen`, so it waits on the lock screen where the device allows that, instead of
 * fading while the creator is away from the phone. Every stage carries its buttons. Both are handed to
 * notify() under the WebPushMessage names (lib/push/webpush), which trims them and writes the wire keys.
 * A device that draws neither still shows the notification with its own tap target: nothing here depends on them.
 */

export type PublishingStage = "started" | "live" | "failed";

/** One device tag per post: every update of this post replaces the last notification instead of stacking. */
export const pushTag = (postId: string) => `post:${postId}`;

const platformName = (p: string) => (isPlatform(p) ? PLATFORM_META[p].name : p);

/**
 * The buttons under the notification. Shaped by what lib/push/webpush actionsOf will accept: at most two, a
 * short plain id, a title inside 24 characters, and a link that is a path inside Outlly. For a failure the
 * link is the post's own recovery screen, with Reconnect sent to the accounts page when that is the fix.
 */
export function publishingActions(stage: PublishingStage, href: string, t?: { platform: string; errorCode?: string | null }): PushAction[] {
  if (stage === "started") return [{ action: "open", title: "See the progress", href }];
  if (stage === "live") return [{ action: "view", title: "View post", href }];
  const name = platformName(t?.platform ?? "");
  if (RECONNECT.includes(t?.errorCode ?? "")) return [{ action: "open", title: "Open the post", href }, { action: "reconnect", title: `Reconnect ${name}`.slice(0, 24), href: "/accounts" }];
  return [{ action: "open", title: failureCopy(t?.platform ?? "", t?.errorCode).action.slice(0, 24), href }];
}

/** "Instagram, YouTube and X" */
export function names(ps: { platform: string }[]) {
  const n = ps.map((t) => platformName(t.platform));
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** Codes the creator has to clear themselves. The rest are a retry away, which is why the words differ. */
export const NEEDS_ACTION = ["AUTH_EXPIRED", "NOT_CONNECTED", "NEEDS_APPROVAL", "FORBIDDEN", "MEDIA_REJECTED", "DUPLICATE"];
const RECONNECT = ["AUTH_EXPIRED", "NOT_CONNECTED"];

/** Plain words for why one destination stopped, and the one thing that fixes it. */
export function failureCopy(platform: string, code: string | null | undefined) {
  const name = platformName(platform);
  switch (code) {
    case "AUTH_EXPIRED":
    case "NOT_CONNECTED":
      return { body: `${name} signed Outlly out, so the post couldn't go out. Reconnect, then send it again.`, action: `Reconnect ${name}` };
    case "NEEDS_APPROVAL":
      return { body: "It is waiting for a teammate's approval before it can go out.", action: "Open the post" };
    case "FORBIDDEN":
      return { body: `${name} wouldn't allow this one. Open it to see why.`, action: "Open the post" };
    case "MEDIA_REJECTED":
      return { body: `${name} turned the file down. Open it to see why and send it again.`, action: "Open and retry" };
    case "DUPLICATE":
      return { body: `${name} already has this one, so we didn't post it twice.`, action: "Open the post" };
    case "RATE_LIMITED":
    case "NETWORK":
    case "PLATFORM_DOWN":
      return { body: `We couldn't reach ${name} for long enough that we stopped. Open it and send it again.`, action: "Open and retry" };
    default:
      return { body: `${name} turned the post down. Open it to see why and send it again.`, action: "Open and retry" };
  }
}

const POST_SELECT = {
  id: true,
  userId: true,
  title: true,
  hook: true,
  status: true,
  targets: {
    select: {
      id: true,
      platform: true,
      platformStatus: true,
      errorCode: true,
      practice: true,
      updatedAt: true,
      socialAccount: { select: { id: true, platformUserId: true } },
    },
  },
} as const;

const ACTIVE = ["pending", "queued", "uploading", "processing"];

/**
 * Looks at the post as it stands and sends whatever stage has not been sent yet. Safe to call on every target
 * change: each stage has its own key, so nothing is ever sent twice. Returns the stages it sent, for tests.
 */
export async function publishingPush(postId: string): Promise<PublishingStage[]> {
  const post = await db.post.findUnique({ where: { id: postId }, select: POST_SELECT });
  if (!post || post.status === "draft" || post.status === "scheduled") return [];
  // Practice runs never touch a platform, so they never buzz a phone.
  const real = post.targets.filter((t) => !t.practice && !(t.socialAccount && isPracticeAccount(t.socialAccount)));
  if (!real.length) return [];

  const title = (post.title || post.hook || "Your post").split("\n")[0].slice(0, 60);
  const href = `/create?post=${post.id}`;
  const tag = pushTag(post.id);
  const sent: PublishingStage[] = [];
  const icon = (platform: string) => (isPlatform(platform) ? `/brand/platforms/${platform}-192.png` : null);
  const extras = (e: PushExtras): PushExtras => ({ ...e, tag });

  const moving = real.filter((t) => t.platformStatus === "uploading" || t.platformStatus === "processing");
  const live = real.filter((t) => t.platformStatus === "published");
  const broken = real.filter((t) => t.platformStatus === "failed" && t.errorCode !== "CANCELED");
  const settled = !real.some((t) => ACTIVE.includes(t.platformStatus));

  // 1. Started: the first destination is really sending bytes.
  if (moving.length) {
    const r = await notify(
      post.userId,
      {
        kind: "post_live",
        tone: "info",
        title: `Sending "${title}"`,
        body: `Uploading to ${names(moving)}. We will tell you the moment it is live.`,
        href,
        action: "See the progress",
        key: `pubstart:${post.id}`,
      },
      {
        push: extras({
          platform: moving.length === 1 ? platformName(moving[0].platform) : null,
          icon: moving.length === 1 ? icon(moving[0].platform) : null,
          actions: publishingActions("started", href),
        }),
      },
    );
    if (r.created) sent.push("started");
  }

  // 2. Live: the send settled with at least one place live. Same key as noticePostLive, so it stays the only one.
  if (settled && live.length) {
    const rest = real.filter((t) => t.platformStatus === "failed");
    const r = await notify(
      post.userId,
      {
        kind: "post_live",
        tone: "info",
        title: `"${title}" is live on ${names(live)}`,
        body: rest.length ? `${names(rest)} still ${rest.length === 1 ? "needs" : "need"} a hand. Open it to see what happened.` : "Everything went out. Open it for the links to each post.",
        href,
        action: "See what happened",
        key: noticeKey.live(post.id),
      },
      {
        push: extras({
          platform: live.length === 1 ? platformName(live[0].platform) : null,
          icon: live.length === 1 ? icon(live[0].platform) : null,
          actions: publishingActions("live", href),
        }),
      },
    );
    if (r.created) sent.push("live");
  }

  // 3. Failed or needs action, newest first: the one thing the creator has to do, pointing at this post's own
  //    recovery screen. Same keys as noticeFailedTarget, so there is one notice per destination, not two.
  for (const t of [...broken].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())) {
    const name = platformName(t.platform);
    const copy = failureCopy(t.platform, t.errorCode);
    const needsAction = NEEDS_ACTION.includes(t.errorCode ?? "");
    const siblings = await db.notice.count({ where: { key: { startsWith: `fail:${post.id}:` } } });
    const r = await notify(
      post.userId,
      {
        kind: "post_failed",
        tone: "danger",
        title: needsAction ? `"${title}" needs you for ${name}` : `"${title}" didn't post to ${name}`,
        body: copy.body,
        href,
        action: copy.action,
        key: noticeKey.failed(post.id, t.id),
      },
      {
        // One email per post, as before: the first failure writes it, the rest stay in the app.
        email: siblings === 0,
        push: extras({
          platform: name,
          icon: icon(t.platform),
          keepOpen: true,
          actions: publishingActions("failed", href, t),
        }),
      },
    );
    if (r.created && !sent.includes("failed")) sent.push("failed");
  }
  return sent;
}

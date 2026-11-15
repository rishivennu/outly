import "server-only";
import type { Media, SocialAccount } from "@prisma/client";
import { db } from "../db";
import { HttpError } from "../http";
import { isPlatform, type Platform } from "../domain";
import { formatIssues, isPostFormat, type PostFormat } from "../formats";
import { accountForTarget, connectedAccounts, ownedPost } from "../services";
import { requestScope } from "../profiles";
import { publisherForAccount } from "../social/registry";
import { CONFLICT_WINDOW_MS, conflictMessage, scheduleConflicts, type ScheduleConflict } from "./conflicts";
import { PUBLISH_CAPS, capIssue, copyLimitIssues, mediaLimitIssues, overMovingCap, type LimitIssue, type TargetCopy } from "./limits";

export type GuardCode = "schedule_conflict" | "platform_limit" | "too_soon" | "already_sent" | "no_targets" | "not_connected";
export interface GuardIssue {
  code: GuardCode;
  message: string;
  platform?: Platform;
}
export interface GuardResult {
  issues: GuardIssue[];
  conflicts: ScheduleConflict[];
}

type MediaFacts = Pick<Media, "mimeType" | "size" | "duration" | "width" | "height">;
export interface BookingTarget extends TargetCopy {
  account: SocialAccount | null;
}

/**
 * One booking of `mediaId` at `at`, checked against what is already booked: same media on the same account
 * within 10 minutes, the platform's own media and text rules, and publishing caps. `alsoBooked` = times on each
 * account that are not in the database yet (the rest of a batch being booked in the same request).
 */
export async function bookingIssues(input: {
  userId: string;
  postId: string | null;
  mediaId: string;
  media: MediaFacts;
  format: PostFormat;
  slides?: MediaFacts[];
  at: Date;
  targets: BookingTarget[];
  alsoBooked?: { accountId: string; at: Date }[];
}): Promise<GuardResult> {
  const { userId, postId, at } = input;
  const want = input.targets.filter((t) => t.account).map((t) => ({ accountId: t.account!.id, platform: t.platform }));
  const from = new Date(at.getTime() - CONFLICT_WINDOW_MS);
  const to = new Date(at.getTime() + CONFLICT_WINDOW_MS);
  const near = want.length
    ? await db.postTarget.findMany({
        where: { socialAccountId: { in: want.map((w) => w.accountId) }, post: { userId, status: "scheduled", mediaId: input.mediaId, scheduledAt: { gte: from, lte: to }, ...(postId ? { id: { not: postId } } : {}) } },
        select: { platform: true, socialAccountId: true, post: { select: { id: true, title: true, hook: true, mediaId: true, scheduledAt: true } } },
        take: 50,
      })
    : [];
  const conflicts = scheduleConflicts({
    postId,
    mediaId: input.mediaId,
    at,
    want,
    booked: near.map((b) => ({ postId: b.post.id, title: b.post.title || b.post.hook, mediaId: b.post.mediaId, accountId: b.socialAccountId!, platform: b.platform, scheduledAt: b.post.scheduledAt! })),
  });

  const limits: LimitIssue[] = [];
  for (const t of input.targets) {
    limits.push(...copyLimitIssues(t, input.format));
    if (!t.account) continue;
    let publisher: ReturnType<typeof publisherForAccount> | null = null;
    try {
      publisher = publisherForAccount(t.platform, t.account);
    } catch {
      publisher = null; // a real account without app keys: launch reports that itself
    }
    if (publisher) {
      const checks = input.format === "video" ? publisher.validateMedia(input.media) : formatIssues(t.platform, input.format, input.slides?.length ? input.slides : [input.media]);
      limits.push(...mediaLimitIssues(t.platform, checks));
    }
    const cap = PUBLISH_CAPS[t.platform];
    if (cap) {
      const lo = new Date(at.getTime() - cap.windowMs);
      const hi = new Date(at.getTime() + cap.windowMs);
      const rows = await db.postTarget.findMany({
        where: {
          socialAccountId: t.account.id,
          ...(postId ? { postId: { not: postId } } : {}),
          OR: [{ platformStatus: "published", publishedAt: { gte: lo, lte: hi } }, { platformStatus: { not: "published" }, post: { status: "scheduled", scheduledAt: { gte: lo, lte: hi } } }],
        },
        select: { platformStatus: true, publishedAt: true, post: { select: { scheduledAt: true } } },
      });
      const times = rows.map((r) => (r.platformStatus === "published" ? r.publishedAt! : r.post.scheduledAt!));
      for (const b of input.alsoBooked ?? []) if (b.accountId === t.account.id) times.push(b.at);
      if (overMovingCap(times, at, cap.max, cap.windowMs)) limits.push(capIssue(t.platform)!);
    }
  }
  const issues: GuardIssue[] = [];
  if (conflicts.length) issues.push({ code: "schedule_conflict", message: conflictMessage(conflicts.length) });
  for (const l of limits) issues.push({ code: l.code, message: l.message, platform: l.platform });
  return { issues, conflicts };
}

/** Throws the contract's 409 schedule_conflict or 422 platform_limit for the first problem found. */
export function throwGuard(r: GuardResult, prefix = "") {
  const conflict = r.issues.find((i) => i.code === "schedule_conflict");
  if (conflict) throw new HttpError(409, prefix + conflict.message, "schedule_conflict", { conflicts: r.conflicts });
  const limit = r.issues.find((i) => i.code === "platform_limit");
  if (limit) throw new HttpError(422, prefix + limit.message, "platform_limit", { platform: limit.platform });
}

/**
 * Every check for booking an existing post at `at`. `copy` overlays edits sent in the same request, so a PATCH
 * that fixes a caption and sets the time is judged on the fixed caption.
 */
export async function checkPostSchedule(userId: string, postId: string, at: Date, copy: Partial<TargetCopy & { platform: string }>[] = []): Promise<GuardResult> {
  const post = await ownedPost(userId, postId);
  const early: GuardIssue[] = [];
  if (["publishing", "published"].includes(post.status)) early.push({ code: "already_sent", message: "This one has already gone out." });
  if (at.getTime() < Date.now() + 60_000) early.push({ code: "too_soon", message: "Pick a time at least a minute from now." });
  const toSend = post.targets.filter((t) => t.platformStatus !== "published" && isPlatform(t.platform));
  if (!toSend.length) early.push({ code: "no_targets", message: post.targets.length ? "It's already live everywhere you picked." : "Pick at least one place to send it." });
  const [accounts, scope] = await Promise.all([connectedAccounts(userId), requestScope(userId)]);
  const targets: BookingTarget[] = toSend.map((t) => {
    const edit = copy.find((c) => c.platform === t.platform) ?? {};
    const pick = <K extends keyof TargetCopy>(k: K) => (edit[k] !== undefined ? edit[k] : (t as unknown as TargetCopy)[k]);
    const account = accountForTarget(t, accounts.all, scope);
    if (!account || account.status !== "connected") early.push({ code: "not_connected", message: `${t.platform === "x" ? "X" : t.platform[0].toUpperCase() + t.platform.slice(1)} needs you to reconnect first.`, platform: t.platform as Platform });
    return { platform: t.platform as Platform, title: pick("title"), caption: pick("caption"), description: pick("description"), hashtags: pick("hashtags"), firstComment: pick("firstComment"), account };
  });
  const format: PostFormat = isPostFormat(post.format) ? post.format : "video";
  const r = await bookingIssues({ userId, postId: post.id, mediaId: post.mediaId, media: post.media, format, slides: post.items.map((i) => i.media), at, targets });
  return { issues: [...early, ...r.issues], conflicts: r.conflicts };
}

export async function assertPostSchedulable(userId: string, postId: string, at: Date, copy?: Partial<TargetCopy & { platform: string }>[]) {
  throwGuard(await checkPostSchedule(userId, postId, at, copy));
}

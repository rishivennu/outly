import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { HttpError } from "../http";
import { env } from "../env";
import { ensurePlans } from "./plans";

export interface Entitlements {
  planSlug: string;
  planName: string;
  postLimit: number; // per postPeriod (UTC); 0 = unlimited
  postPeriod: "week" | "month";
  aiCaptions: boolean;
  seats: number;
  maxUploadMb: number; // 0 = server maximum
  replyLimit: number; // per week; 0 = unlimited
  captionVideos: number; // per month; 0 = unlimited
  burnCaptions: boolean;
}

/** Which limit a 402 is about, so the upgrade popup can say the right thing. */
export type LimitFeature = "posts" | "upload" | "replies" | "captions" | "burn" | "ai" | "seats";

const limit = (message: string, feature: LimitFeature) => new HttpError(402, message, "PLAN_LIMIT", { feature, upgrade: "/billing" });

const UNLIMITED: Omit<Entitlements, "planSlug" | "planName"> = { postLimit: 0, postPeriod: "month", aiCaptions: true, seats: 0, maxUploadMb: 0, replyLimit: 0, captionVideos: 0, burnCaptions: true };

/** What this account's plan allows: its active subscription's plan, else the Free plan, else no limits. */
export async function entitlements(userId: string): Promise<Entitlements> {
  const now = new Date();
  // A paused plan rests: Free limits until pausedUntil, then the frozen paid days run again.
  const sub = await db.subscription.findFirst({ where: { userId, status: "active", currentPeriodEnd: { gt: now }, OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }] }, include: { plan: true }, orderBy: { createdAt: "desc" } });
  let plan = sub?.plan ?? null;
  if (!plan) {
    await ensurePlans();
    plan = await db.plan.findUnique({ where: { slug: "free" } });
  }
  if (!plan) return { planSlug: "free", planName: "Free", ...UNLIMITED };
  return {
    planSlug: plan.slug, planName: plan.name, postLimit: plan.postLimit, postPeriod: plan.postPeriod === "week" ? "week" : "month",
    aiCaptions: plan.aiCaptions, seats: plan.seats, maxUploadMb: plan.maxUploadMb, replyLimit: plan.replyLimit, captionVideos: plan.captionVideos, burnCaptions: plan.burnCaptions,
  };
}

export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
/** Monday 00:00 UTC of the current week. */
export const weekStart = (now = new Date()) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
};
export const periodStart = (p: "week" | "month", now = new Date()) => (p === "week" ? weekStart(now) : monthStart(now));

/** Stable key for a usage window: "2026-10" for months, "2026-W43" (ISO week) for weeks. */
export function periodKey(p: "week" | "month", now = new Date()) {
  if (p === "month") return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // Thursday of this week decides the ISO year
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const thisPeriod = (p: "week" | "month") => (p === "week" ? "this week" : "this month");
const resetHint = (p: "week" | "month") => (p === "week" ? "wait until Monday" : "wait until the 1st");

/** Posts launched (published or scheduled) this period and what's left. Drafts are free. `left` is Infinity on unlimited plans. */
export async function postUsage(userId: string, now = new Date()) {
  const e = await entitlements(userId);
  const from = periodStart(e.postPeriod, now);
  // launchedAt is when the post was sent or booked; older rows only have createdAt.
  // Spent slots (FeatureUse "post") survive deleting the post; the post count covers posts sent before slots existed.
  const [spent, legacy] = await Promise.all([
    e.postLimit > 0 ? db.featureUse.count({ where: { userId, feature: "post", period: periodKey(e.postPeriod, now) } }) : 0,
    db.post.count({ where: { userId, status: { not: "draft" }, OR: [{ launchedAt: { gte: from } }, { launchedAt: null, createdAt: { gte: from } }] } }),
  ]);
  const used = Math.max(spent, legacy);
  return { ...e, used, left: e.postLimit > 0 ? Math.max(0, e.postLimit - used) : Infinity };
}

/** Pure check, unit-tested: throws the upgrade message when the period's posts are used up. */
export function checkPostLimit(e: Pick<Entitlements, "postLimit" | "planName"> & { postPeriod?: "week" | "month" }, used: number) {
  const p = e.postPeriod ?? "month";
  if (e.postLimit > 0 && used >= e.postLimit)
    throw limit(`You've used all ${e.postLimit} posts on ${e.planName} ${thisPeriod(p)}. Upgrade to post more, or ${resetHint(p)}.`, "posts");
}

export async function assertCanPost(userId: string) {
  const u = await postUsage(userId);
  checkPostLimit(u, u.used);
  return u;
}

const isClash = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";

/**
 * Race-safe slot: insert the use first, then count, and back out if the count is over. Whichever request looks
 * last sees every row that raced in, so the total can never pass `max`. (Two requests landing at the exact same
 * instant may both back out; that errs on the safe side and a retry goes through.)
 * `fresh:false` = this ref was already counted this period (a retry). `release()` gives the slot back.
 */
async function reserve(userId: string, feature: string, period: string, ref: string, max: number, onFull: () => HttpError) {
  const key = ref.slice(0, 120);
  // Cheap look first, so an ordinary retry doesn't make Prisma log a unique-constraint error.
  if (await db.featureUse.findFirst({ where: { userId, feature, period, ref: key }, select: { id: true } })) return { fresh: false, release: async () => {} };
  let row: { id: string };
  try {
    row = await db.featureUse.create({ data: { userId, feature, period, ref: key }, select: { id: true } });
  } catch (err) {
    if (isClash(err)) return { fresh: false, release: async () => {} };
    throw err;
  }
  const release = async () => { await db.featureUse.deleteMany({ where: { id: row.id } }); };
  const n = await db.featureUse.count({ where: { userId, feature, period } });
  if (n > max) {
    await release();
    throw onFull();
  }
  return { fresh: true, release };
}

/**
 * Spends one post for `postId` in the current period, before the launch claim. Same post again in the same
 * period (retry, reschedule) costs nothing; a failed post relaunched in a later period costs one there.
 * Deleting the post doesn't give the slot back. Returns release() to call if the launch then fails.
 */
export async function spendPost(userId: string, postId: string, now = new Date()) {
  const u = await postUsage(userId, now);
  if (u.postLimit <= 0) return { fresh: false, release: async () => {} };
  const p = u.postPeriod;
  const full = () => limit(`You've used all ${u.postLimit} posts on ${u.planName} ${thisPeriod(p)}. Upgrade to post more, or ${resetHint(p)}.`, "posts");
  // Posts sent before slots existed still count (legacy), so the room left is postLimit minus those.
  const legacyOnly = Math.max(0, u.used - (await db.featureUse.count({ where: { userId, feature: "post", period: periodKey(p, now) } })));
  return reserve(userId, "post", periodKey(p, now), postId, Math.max(0, u.postLimit - legacyOnly), full);
}

/** Largest file this account may upload, in bytes. Never above the server maximum. */
export async function uploadLimitBytes(userId: string) {
  const server = env.MAX_UPLOAD_MB * 1024 * 1024;
  const e = await entitlements(userId);
  const plan = e.maxUploadMb > 0 ? e.maxUploadMb * 1024 * 1024 : server;
  return { bytes: Math.min(plan, server), mb: Math.min(e.maxUploadMb || env.MAX_UPLOAD_MB, env.MAX_UPLOAD_MB), planName: e.planName, planLimited: e.maxUploadMb > 0 && e.maxUploadMb < env.MAX_UPLOAD_MB };
}

export async function assertUploadSize(userId: string, size: number) {
  const l = await uploadLimitBytes(userId);
  if (size > l.bytes) {
    if (l.planLimited) throw limit(`${l.planName} uploads are limited to ${l.mb} MB per file. Upgrade to upload bigger videos, or compress this one.`, "upload");
    throw new HttpError(413, `File is larger than ${l.mb} MB.`, "TOO_LARGE");
  }
  return l;
}

export async function assertAiCaptions(userId: string) {
  const e = await entitlements(userId);
  if (!e.aiCaptions) throw limit(`AI captions aren't part of ${e.planName}. Upgrade in Billing, or type your captions yourself.`, "ai");
  return e;
}

/** Inbox replies this week, and what's left. */
export async function replyUsage(userId: string, now = new Date()) {
  const e = await entitlements(userId);
  const used = e.replyLimit > 0 ? await db.featureUse.count({ where: { userId, feature: "reply", period: periodKey("week", now) } }) : 0;
  return { ...e, used, left: e.replyLimit > 0 ? Math.max(0, e.replyLimit - used) : Infinity };
}

export async function assertCanReply(userId: string) {
  const u = await replyUsage(userId);
  if (u.replyLimit > 0 && u.used >= u.replyLimit)
    throw limit(`You've sent all ${u.replyLimit} replies on ${u.planName} this week. Upgrade to reply to more people, or wait until Monday.`, "replies");
  return u;
}

/** Holds one reply slot before sending; call release() if the reply fails or doesn't count (practice account). */
export async function reserveReply(userId: string, ref: string, now = new Date()) {
  const e = await entitlements(userId);
  if (e.replyLimit <= 0) return { ...e, left: Infinity, release: async () => {} };
  const r = await reserve(userId, "reply", periodKey("week", now), ref, e.replyLimit, () =>
    limit(`You've sent all ${e.replyLimit} replies on ${e.planName} this week. Upgrade to reply to more people, or wait until Monday.`, "replies"),
  );
  const used = await db.featureUse.count({ where: { userId, feature: "reply", period: periodKey("week", now) } });
  return { ...e, left: Math.max(0, e.replyLimit - used), release: r.release };
}

/** Counts one use. `ref` makes it idempotent: the same ref in the same period is counted once. */
export async function recordUse(userId: string, feature: "reply" | "captions", ref: string, now = new Date()) {
  const period = periodKey(feature === "reply" ? "week" : "month", now);
  await db.featureUse.create({ data: { userId, feature, period, ref: ref.slice(0, 120) } }).catch((err) => {
    if (!isClash(err)) throw err; // unique clash = already counted; anything else must not pass silently
  });
}

/** Audio chunks (~1 min each) a capped plan may transcribe per allowed video, re-runs included. */
export const CHUNKS_PER_CAPTION_VIDEO = 15;

/** Videos with AI captions this month. One video (ref) can be transcribed in many chunks and re-run; it counts once. */
export async function captionUsage(userId: string, now = new Date()) {
  const e = await entitlements(userId);
  const used = e.captionVideos > 0 ? await db.featureUse.count({ where: { userId, feature: "captions", period: periodKey("month", now) } }) : 0;
  return { ...e, used, left: e.captionVideos > 0 ? Math.max(0, e.captionVideos - used) : Infinity };
}

/** Gate for AI captions on one video. Passes again for a video already counted this month. */
export async function assertCaptionVideo(userId: string, ref: string, now = new Date()) {
  const e = await assertAiCaptions(userId);
  if (e.captionVideos <= 0) return e;
  const period = periodKey("month", now);
  const key = ref.slice(0, 120) || "unknown";
  const seen = await db.featureUse.findFirst({ where: { userId, feature: "captions", period, ref: key }, select: { id: true } });
  const full = () => limit(`${e.planName} includes AI captions on ${e.captionVideos} video${e.captionVideos === 1 ? "" : "s"} a month and you've used them. Upgrade for unlimited captions, or type them yourself.`, "captions");
  // The video ref comes from the browser (the clip isn't uploaded yet), so the audio itself is metered too:
  // every chunk takes a slot from a monthly budget the server owns. Reusing one ref can't stretch 2 videos into 20.
  const chunk = await reserve(userId, "caption-chunk", period, randomUUID(), e.captionVideos * CHUNKS_PER_CAPTION_VIDEO, full);
  if (seen) return e;
  try {
    await reserve(userId, "captions", period, key, e.captionVideos, full);
  } catch (err) {
    await chunk.release();
    throw err;
  }
  return e;
}

export async function assertBurnCaptions(userId: string) {
  const e = await entitlements(userId);
  if (!e.burnCaptions) throw limit(`Burning captions into the video is a paid feature. Upgrade to burn them in; on ${e.planName} you can still post with captions in the text.`, "burn");
  return e;
}

/** Seats: invited + active members must stay within the owner's plan. */
export function checkSeats(e: Pick<Entitlements, "seats" | "planName">, taken: number) {
  if (taken >= e.seats)
    throw limit(e.seats === 0 ? `${e.planName} doesn't include team seats. Upgrade in Billing to invite people.` : `${e.planName} includes ${e.seats} seat${e.seats === 1 ? "" : "s"} and they're all taken. Remove someone or upgrade.`, "seats");
}

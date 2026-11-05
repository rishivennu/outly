import "server-only";
import { db } from "../db";
import { cached } from "../cache";
import { noticeMilestones } from "../notify-events";
import { isPlatform, PLATFORM_META, type Platform } from "../domain";
import { liveAccount } from "../live/account";
import { asPublisherError, httpFailure } from "../social/types";
import type { AccountContext } from "../social/types";
import { engagementNote, engagementRate, type MetricKey, type PostInsights, type TargetInsights } from "./post-core";

/**
 * 1088: live numbers for ONE post, per destination, straight from the platform APIs.
 * Nothing here is invented: a metric the platform did not return is left out and listed in `unavailable`,
 * practice posts say they are practice, and every answer carries the time it was fetched.
 */

export const INSIGHTS_TTL_MS = 120_000; // one platform round trip per post per 2 minutes, per server instance
export const REFRESH_MIN_AGE_MS = 30_000; // a manual refresh younger than this gets the numbers we just fetched
const SNAPSHOT_EVERY_MS = 30 * 60_000;
const T = () => AbortSignal.timeout(10_000);

const SUPPORTED: Platform[] = ["instagram", "youtube", "facebook"];

/** Per platform, what its API can ever give for a single video. Used to label the rest "not available". */
export const CAN: Record<string, MetricKey[]> = {
  instagram: ["views", "reach", "likes", "comments", "shares", "saves", "engagementRate", "avgWatchSec", "watchTimeMin"],
  youtube: ["views", "likes", "comments", "shares", "engagementRate", "avgWatchSec", "watchTimeMin"],
  facebook: ["views", "reach", "likes", "comments", "avgWatchSec", "watchTimeMin", "engagementRate"],
};
const ALL: MetricKey[] = ["views", "reach", "impressions", "likes", "comments", "shares", "saves", "engagementRate", "watchTimeMin", "avgWatchSec"];

async function getJson<T>(url: string, what: string, headers?: Record<string, string>): Promise<T> {
  const r = await fetch(url, { headers, signal: T(), cache: "no-store" });
  if (!r.ok) throw await httpFailure(r, what);
  return (await r.json()) as T;
}
const tok = (t: string) => `access_token=${encodeURIComponent(t)}`;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(+v) ? +v : null);

type Metrics = Partial<Record<MetricKey, number>>;
type Fetched = { metrics: Metrics; notes: string[] };

/* ------------------------------------------------------------ Instagram */

type IgIns = { data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] };
async function instagram(acct: AccountContext, mediaId: string): Promise<Fetched> {
  const G = "https://graph.instagram.com/v21.0";
  const reel = "views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time";
  const plain = "views,reach,likes,comments,shares,saved,total_interactions";
  let ins: IgIns;
  try {
    ins = await getJson<IgIns>(`${G}/${encodeURIComponent(mediaId)}/insights?metric=${reel}&${tok(acct.accessToken)}`, "instagram media insights");
  } catch (e) {
    // Not a Reel (photo or carousel): the watch-time metrics are refused, the rest still exist.
    const pe = asPublisherError(e);
    if (pe.code !== "MEDIA_REJECTED") throw e;
    ins = await getJson<IgIns>(`${G}/${encodeURIComponent(mediaId)}/insights?metric=${plain}&${tok(acct.accessToken)}`, "instagram media insights");
  }
  const v = (k: string) => {
    const row = ins.data?.find((d) => d.name === k);
    return num(row?.total_value?.value ?? row?.values?.[0]?.value);
  };
  const m: Metrics = {};
  const put = (k: MetricKey, x: number | null) => {
    if (x !== null) m[k] = x;
  };
  put("views", v("views"));
  put("reach", v("reach"));
  put("likes", v("likes"));
  put("comments", v("comments"));
  put("shares", v("shares"));
  put("saves", v("saved"));
  const avgMs = v("ig_reels_avg_watch_time");
  const totalMs = v("ig_reels_video_view_total_time");
  if (avgMs !== null) m.avgWatchSec = avgMs / 1000;
  if (totalMs !== null) m.watchTimeMin = totalMs / 60_000;
  const er = engagementRate(m, "reach");
  if (er !== null) m.engagementRate = er;
  return { metrics: m, notes: [engagementNote(m, "reach"), "Instagram no longer reports impressions; views replaced them."].filter((x): x is string => !!x) };
}

/* ------------------------------------------------------------ YouTube */

type YtVideos = { items?: { statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }; snippet?: { publishedAt?: string } }[] };
type YtReport = { columnHeaders?: { name: string }[]; rows?: (string | number)[][] };
async function youtube(acct: AccountContext, videoId: string): Promise<Fetched> {
  const auth = { authorization: `Bearer ${acct.accessToken}` };
  const vids = await getJson<YtVideos>(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${encodeURIComponent(videoId)}`, "youtube video", auth);
  const it = vids.items?.[0];
  if (!it) throw Object.assign(new Error("gone"), { gone: true });
  const s = it.statistics ?? {};
  const m: Metrics = {};
  const views = num(s.viewCount);
  const likes = num(s.likeCount); // null when the creator hides likes
  const comments = num(s.commentCount); // null when comments are off
  if (views !== null) m.views = views;
  if (likes !== null) m.likes = likes;
  if (comments !== null) m.comments = comments;
  const notes = ["Views, likes and comments are live. Watch time and shares come from YouTube Analytics, which runs 1 to 2 days behind."];
  const start = (it.snippet?.publishedAt ?? new Date().toISOString()).slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  try {
    const r = await getJson<YtReport>(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${start}&endDate=${end < start ? start : end}&metrics=estimatedMinutesWatched,averageViewDuration,shares&filters=video==${encodeURIComponent(videoId)}`,
      "youtube analytics video",
      auth,
    );
    const row = r.rows?.[0];
    const at = (k: string) => {
      const i = r.columnHeaders?.findIndex((h) => h.name === k) ?? -1;
      return row && i >= 0 ? num(row[i]) : null;
    };
    const wt = at("estimatedMinutesWatched");
    const avg = at("averageViewDuration");
    const sh = at("shares");
    if (row) {
      if (wt !== null) m.watchTimeMin = wt;
      if (avg !== null) m.avgWatchSec = avg;
      if (sh !== null) m.shares = sh;
    } else notes.push("YouTube Analytics has no rows for this video yet (new uploads take a day or two).");
  } catch (e) {
    const pe = asPublisherError(e);
    notes.push(pe.code === "FORBIDDEN" || pe.code === "AUTH_EXPIRED" ? "Reconnect YouTube once to allow analytics, then watch time and shares appear." : "YouTube Analytics didn't answer just now, so watch time and shares are missing.");
  }
  const er = engagementRate(m, "views");
  if (er !== null) m.engagementRate = er;
  const yn = engagementNote(m, "views");
  if (yn) notes.push(yn);
  return { metrics: m, notes };
}

/* ------------------------------------------------------------ Facebook */

type FbIns = { data?: { name: string; values?: { value: number | Record<string, number> }[] }[] };
type FbObj = { likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } };
async function facebook(acct: AccountContext, videoId: string): Promise<Fetched> {
  const G = "https://graph.facebook.com/v21.0";
  const id = encodeURIComponent(videoId);
  const [insR, objR] = await Promise.allSettled([
    getJson<FbIns>(`${G}/${id}/video_insights?metric=fb_reels_total_plays,post_impressions_unique,post_video_avg_time_watched,post_video_view_time&${tok(acct.accessToken)}`, "facebook video insights"),
    getJson<FbObj>(`${G}/${id}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0)&${tok(acct.accessToken)}`, "facebook video"),
  ]);
  if (insR.status === "rejected" && objR.status === "rejected") throw objR.reason;
  const m: Metrics = {};
  const notes: string[] = [];
  if (insR.status === "fulfilled") {
    const v = (k: string) => num(insR.value.data?.find((d) => d.name === k)?.values?.[0]?.value);
    const plays = v("fb_reels_total_plays");
    const reach = v("post_impressions_unique");
    const avgMs = v("post_video_avg_time_watched");
    const totalMs = v("post_video_view_time");
    if (plays !== null) m.views = plays;
    if (reach !== null) m.reach = reach;
    if (avgMs !== null) m.avgWatchSec = avgMs / 1000;
    if (totalMs !== null) m.watchTimeMin = totalMs / 60_000;
  } else notes.push("Facebook didn't share plays and reach (the Page needs the read_insights permission).");
  if (objR.status === "fulfilled") {
    const l = num(objR.value.likes?.summary?.total_count);
    const c = num(objR.value.comments?.summary?.total_count);
    if (l !== null) m.likes = l;
    if (c !== null) m.comments = c;
  }
  const er = engagementRate(m, "reach");
  if (er !== null) m.engagementRate = er;
  const fn = engagementNote(m, "reach");
  if (fn) notes.push(fn);
  notes.push("Facebook's API does not give share counts for a single Reel.");
  return { metrics: m, notes };
}

const FETCH: Partial<Record<Platform, (a: AccountContext, id: string) => Promise<Fetched>>> = { instagram, youtube, facebook };

/* ------------------------------------------------------------ one destination */

/** A PostTarget with its account loaded: what the per-destination reader needs. Exported so the 1140
 * background sync can hand it rows it queried itself instead of going through one post at a time. */
export type InsightsTarget = Awaited<ReturnType<typeof loadTargets>>[number];
type Row = InsightsTarget;
async function loadTargets(userId: string, postId: string) {
  return db.postTarget.findMany({ where: { postId, post: { userId } }, include: { socialAccount: true } });
}

/** Live numbers for ONE destination, or the reason there are none. The only place a platform is called. */
export async function targetInsights(t: Row): Promise<TargetInsights> {
  const platform = t.platform as Platform;
  const name = isPlatform(platform) ? PLATFORM_META[platform].name : t.platform;
  const base: TargetInsights = {
    targetId: t.id,
    platform,
    accountName: t.socialAccount?.displayName || t.socialAccount?.username || null,
    url: t.platformUrl,
    publishedAt: t.publishedAt?.toISOString() ?? null,
    status: "unavailable",
    metrics: {},
    unavailable: [],
    notes: [],
    fetchedAt: null,
    message: null,
  };
  if (t.platformStatus !== "published" || !t.platformPostId) return { ...base, status: "not_published", message: `Not live on ${name} yet, so there are no numbers.` };
  if (t.removeMode === "deleted") return { ...base, status: "removed", message: `Deleted from ${name}. Its numbers went with it.` };
  if (t.practice) return { ...base, status: "practice", message: "Practice post: it never reached a real platform, so there are no live numbers." };
  const run = FETCH[platform];
  if (!run || !SUPPORTED.includes(platform)) return { ...base, status: "unavailable", message: `Outlly can't read per-post analytics from ${name} yet. Open the post on ${name} to see them.` };
  const acct = t.socialAccount;
  if (!acct || acct.status !== "connected") return { ...base, status: "error", code: "NOT_CONNECTED", message: `Reconnect ${name} in Accounts to see this post's numbers.` };
  try {
    const ctx = await liveAccount(acct);
    const { metrics, notes } = await run(ctx, t.platformPostId);
    const can = CAN[platform] ?? [];
    const unavailable = ALL.filter((k) => metrics[k] === undefined);
    return { ...base, status: "live", metrics, notes, unavailable, fetchedAt: new Date().toISOString(), supported: can };
  } catch (e) {
    if ((e as { gone?: boolean }).gone) return { ...base, status: "error", code: "GONE", message: `${name} no longer has this post. It may have been deleted there.` };
    const pe = asPublisherError(e);
    const msg =
      pe.code === "AUTH_EXPIRED"
        ? `${name} needs you to sign in again. Reconnect it in Accounts.`
        : pe.code === "FORBIDDEN"
          ? `${name} didn't give Outlly permission to read this post's insights. Reconnect it once to allow it.`
          : pe.code === "RATE_LIMITED"
            ? `${name} asked us to slow down. Try again in a few minutes.`
            : pe.code === "NETWORK" || pe.code === "PLATFORM_DOWN"
              ? `We couldn't reach ${name} just now. Try again in a minute.`
              : `${name} didn't return numbers for this post.`;
    console.warn(`[insights] ${platform} ${t.id}: ${pe.code}`); // no token, no body
    return { ...base, status: "error", code: pe.code, message: msg };
  }
}

/**
 * Keep the stored history in step with what the platform says, without double counting: TargetMetric rows
 * are increments (analytics sums them), so the new row is "live total minus what is already stored".
 * At most one row per destination per 30 minutes, so refreshes don't write on every click.
 * Exported since 1140: the background sync writes history the same way, so there is one definition of
 * "what a stored delta means" whether the numbers came from a popup or from the sweeper.
 */
export async function snapshotTarget(r: TargetInsights) {
  if (r.status !== "live") return;
  // 1140: saves ride along. Only Instagram reports them, so everywhere else the delta stays 0.
  const keys = ["views", "likes", "comments", "shares", "saves"] as const;
  if (!keys.some((k) => r.metrics[k] !== undefined)) return;
  const last = await db.targetMetric.findFirst({ where: { targetId: r.targetId }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } });
  if (last && Date.now() - last.capturedAt.getTime() < SNAPSHOT_EVERY_MS) return;
  const sum = await db.targetMetric.aggregate({ where: { targetId: r.targetId }, _sum: { views: true, likes: true, comments: true, shares: true, saves: true } });
  const delta = Object.fromEntries(keys.map((k) => [k, Math.round((r.metrics[k] ?? 0) - (sum._sum[k] ?? 0))])) as Record<(typeof keys)[number], number>;
  // Signed: when a platform corrects a count downwards (removed spam views), the stored total follows it.
  // Metrics this answer didn't include stay as they are rather than dropping to zero.
  for (const k of keys) if (r.metrics[k] === undefined) delta[k] = 0;
  if (last && !keys.some((k) => delta[k] !== 0)) return;
  await db.targetMetric.create({ data: { targetId: r.targetId, ...delta } });
  // 1118: passed 1K / 10K / 100K / 1M views on this platform since the last snapshot (each one notified once).
  if (r.metrics.views !== undefined) await noticeMilestones(r.targetId, sum._sum.views ?? 0, r.metrics.views);
}

const key = (userId: string, postId: string) => `insights:${userId}:${postId}`;

/** The caller has already checked the post belongs to this user (ownedPost). */
export async function postInsights(userId: string, postId: string, opts: { fresh?: boolean } = {}): Promise<PostInsights & { cached: boolean }> {
  const k = key(userId, postId);
  let hit = true;
  const load = async (): Promise<PostInsights> => {
    hit = false;
    const targets = await loadTargets(userId, postId);
    const results = await Promise.all(targets.map(targetInsights));
    await Promise.all(results.map((r) => snapshotTarget(r).catch((e) => console.warn(`[insights] snapshot ${r.targetId}: ${(e as Error).message}`))));
    return { postId, fetchedAt: new Date().toISOString(), targets: results };
  };
  let v = await cached(k, INSIGHTS_TTL_MS, load);
  // A refresh fetches again only when what we hold is older than 30 s: double clicks and several tabs share one call.
  if (opts.fresh && hit && Date.now() - Date.parse(v.fetchedAt) >= REFRESH_MIN_AGE_MS) {
    v = await cached(k, 0, load);
  }
  return { ...v, cached: hit };
}

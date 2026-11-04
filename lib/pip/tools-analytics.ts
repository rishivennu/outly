import "server-only";
import { db } from "../db";
import { cached } from "../cache";
import { aiQuota } from "../ai-quota";
import { entitlements, postUsage } from "../billing/entitlements";
import { analyticsWindow } from "../billing/plan-rules";
import { isPlatform, PLATFORM_META } from "../domain";
import type { LivePost, PlatformDashboard } from "../live/types";
import { isPracticeAccount } from "../social/registry";
import * as A from "./analytics-core";
import { platformsNamed } from "./plan";
import { dayLabel, parseRange, previousRange, type DateRange } from "./range";
import { at, base, plural, type PipArgs, type PipCtx } from "./tools-core";
import { accountsInScope, dashboards, type Acct } from "./tools-content";
import type { PipResult, PipTool } from "./types";

/**
 * Pip as a creator's analyst (1123). Every tool here reads ONLY the signed-in workspace's own posts and synced
 * numbers (ownerId from the session; a teammate only the accounts in ctx.scope; rehearsal posts never), through
 * one loader with a per-request memo and a 60 second cache, and hands back cards, rows and short true
 * facts. The maths is in analytics-core.ts (pure, tested). Nothing is guessed: a number Outlly doesn't have is
 * said to be unavailable, a projection is labelled an estimate, and a link between two things is never called
 * the cause.
 */
type Tool = (ctx: PipCtx, a: PipArgs, range: DateRange | null, period: string | null) => Promise<PipResult>;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pname = (p: string) => (isPlatform(p) ? PLATFORM_META[p].name : cap(p));
const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plat = (p: string | null | undefined) => (p && isPlatform(p) ? p : null);
const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const LINKED = "Linked, not proven to cause.";

// ---------- per-request memo (a report runs several analyses over the same rows) ----------
const memos = new WeakMap<PipCtx, Map<string, Promise<unknown>>>();
function memo<T>(ctx: PipCtx, key: string, load: () => Promise<T>): Promise<T> {
  let m = memos.get(ctx);
  if (!m) memos.set(ctx, (m = new Map()));
  if (!m.has(key)) m.set(key, load());
  return m.get(key) as Promise<T>;
}

// ---------- the window: what was asked, cut to what the plan includes ----------
export type Win = DateRange & { days: number; maxDays: number; cut: string | null; earliest: number };

async function maxDaysFor(ctx: PipCtx) {
  const e = await memo(ctx, "ent", () => entitlements(ctx.ownerId)).catch(() => null);
  return analyticsWindow(e ?? { analyticsDays: 0 }, 100000).maxDays;
}

/** The period to analyse: the one asked for (never past now), else the last `fallback` days, inside the plan's history. */
export async function windowFor(ctx: PipCtx, range: DateRange | null, fallback: number): Promise<Win> {
  const maxDays = await maxDaysFor(ctx);
  const now = ctx.now.getTime();
  const r = range ?? parseRange(`last ${Math.min(fallback, maxDays)} days`, ctx.tz, ctx.now)!;
  const earliest = parseRange(`last ${maxDays} days`, ctx.tz, ctx.now)!.from.getTime();
  // Up to the end of this minute, so the 60s cache key holds still for a minute.
  const to = Math.min(r.to.getTime(), Math.ceil((now + 1) / 60000) * 60000);
  let from = r.from.getTime();
  let label = r.label;
  let cut: string | null = null;
  if (from < earliest) {
    from = earliest;
    cut = `Your plan includes ${maxDays} days of history, so this starts on ${dayLabel(new Date(earliest), ctx.tz)} instead of ${dayLabel(r.from, ctx.tz)}.`;
    label = `${dayLabel(new Date(from), ctx.tz)} to ${dayLabel(new Date(Math.max(from, to - 1)), ctx.tz)}`;
  }
  const end = Math.max(from, to);
  return { from: new Date(from), to: new Date(end), label, tz: ctx.tz, days: Math.round((end - from) / A.DAY_MS), maxDays, cut, earliest };
}

// ---------- the one loader ----------
export type Stats = {
  posts: A.StatPost[];
  snaps: A.Snap[];
  /** First and last time Outlly synced numbers for these accounts (all time), for "history starts on". */
  firstSync: number | null;
  lastSync: number | null;
  capped: boolean;
  failed: boolean;
  /** Accounts in scope whose numbers may have stopped updating. */
  stale: string[];
};
const SNAP_CAP = 200_000;
const empty = (): Stats => ({ posts: [], snaps: [], firstSync: null, lastSync: null, capped: false, failed: true, stale: [] });

const targetScope = (ctx: PipCtx, platform: string | null) => ({
  post: { userId: ctx.ownerId },
  practice: false,
  ...(platform ? { platform } : {}),
  ...(ctx.scope ? { socialAccountId: { in: ctx.scope } } : {}),
});

async function readStats(ctx: PipCtx, from: number, to: number, platform: string | null): Promise<Stats> {
  const tw = targetScope(ctx, platform);
  const span = { gte: new Date(from), lt: new Date(to) };
  const [targets, snapRows, first, last, stale] = await Promise.all([
    db.postTarget.findMany({
      where: { ...tw, platformStatus: "published", OR: [{ publishedAt: span }, { publishedAt: null, post: { userId: ctx.ownerId, publishedAt: span } }] },
      orderBy: { createdAt: "asc" },
      take: 5000,
      select: {
        id: true,
        postId: true,
        platform: true,
        socialAccountId: true,
        title: true,
        caption: true,
        description: true,
        hashtags: true,
        platformUrl: true,
        publishedAt: true,
        post: { select: { title: true, hook: true, publishedAt: true, media: { select: { originalFilename: true, mimeType: true, duration: true, width: true, height: true } } } },
      },
    }),
    db.targetMetric.findMany({
      where: { capturedAt: span, target: tw },
      take: SNAP_CAP,
      select: { targetId: true, capturedAt: true, views: true, likes: true, comments: true, shares: true, target: { select: { platform: true } } },
    }),
    db.targetMetric.findFirst({ where: { target: tw }, orderBy: { capturedAt: "asc" }, select: { capturedAt: true } }),
    db.targetMetric.findFirst({ where: { target: tw }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
    db.socialAccount.findMany({
      where: { userId: ctx.ownerId, status: { not: "connected" }, ...(ctx.scope ? { id: { in: ctx.scope } } : {}), ...(platform ? { platform } : {}) },
      select: { platform: true, username: true, status: true },
    }),
  ]);
  // Lifetime totals per post: the sum of every delta synced for it.
  const sums = new Map<string, { views: number; likes: number; comments: number; shares: number; n: number }>();
  const ids = targets.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 400) {
    const g = await db.targetMetric.groupBy({
      by: ["targetId"],
      where: { targetId: { in: ids.slice(i, i + 400) } },
      _sum: { views: true, likes: true, comments: true, shares: true },
      _count: { _all: true },
    });
    for (const x of g) sums.set(x.targetId, { views: x._sum.views ?? 0, likes: x._sum.likes ?? 0, comments: x._sum.comments ?? 0, shares: x._sum.shares ?? 0, n: x._count._all });
  }
  const posts: A.StatPost[] = [];
  for (const t of targets) {
    const at = t.publishedAt ?? t.post.publishedAt;
    if (!at) continue;
    const caption = (t.caption ?? t.description ?? "").trim();
    const listed = (t.hashtags ?? "").split(/\s+/).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`).toLowerCase());
    const s = sums.get(t.id);
    const m = t.post.media;
    posts.push({
      key: t.id,
      postId: t.postId,
      platform: t.platform,
      accountId: t.socialAccountId,
      title: short(t.title || t.post.title || t.post.hook || caption.split("\n")[0] || m.originalFilename || "Untitled", 60),
      url: t.platformUrl,
      publishedAt: at.getTime(),
      format: A.formatOf(m.mimeType, m.duration),
      orientation: A.orientationOf(m.width, m.height),
      duration: m.duration,
      captionLen: caption.length,
      hashtags: [...new Set([...listed, ...A.hashtagsIn(caption)])],
      views: Math.max(0, s?.views ?? 0),
      likes: Math.max(0, s?.likes ?? 0),
      comments: Math.max(0, s?.comments ?? 0),
      shares: Math.max(0, s?.shares ?? 0),
      hasMetrics: !!s && s.n > 0,
    });
  }
  return {
    posts,
    snaps: snapRows.map((x) => ({ at: x.capturedAt.getTime(), platform: x.target.platform, key: x.targetId, views: x.views, likes: x.likes, comments: x.comments, shares: x.shares })),
    firstSync: first?.capturedAt.getTime() ?? null,
    lastSync: last?.capturedAt.getTime() ?? null,
    capped: snapRows.length >= SNAP_CAP,
    failed: false,
    stale: stale.filter((s) => isPlatform(s.platform)).map((s) => `${pname(s.platform)} ${at(s.username)} ${s.status === "needs_reconnect" ? "needs reconnecting" : "is disconnected"}`),
  };
}

/** Everything for [from, to) on one platform (or all). Reuses a wider load already made in this request. */
export async function loadStats(ctx: PipCtx, from: number, to: number, platform: string | null): Promise<Stats> {
  const scopeKey = ctx.scope ? [...ctx.scope].sort().join(",") : "*";
  let spans = memos.get(ctx)?.get("spans") as unknown as { from: number; to: number; platform: string | null; p: Promise<Stats> }[] | undefined;
  if (!spans) {
    spans = [];
    if (!memos.has(ctx)) memos.set(ctx, new Map());
    memos.get(ctx)!.set("spans", spans as unknown as Promise<unknown>);
  }
  const wide = spans.find((s) => s.from <= from && s.to >= to && (s.platform === null || s.platform === platform));
  if (wide) {
    const st = await wide.p;
    const inP = (p: string) => !platform || p === platform;
    return { ...st, posts: st.posts.filter((p) => p.publishedAt >= from && p.publishedAt < to && inP(p.platform)), snaps: st.snaps.filter((s) => s.at >= from && s.at < to && inP(s.platform)) };
  }
  const key = `pip:stats:${ctx.ownerId}:${scopeKey}:${from}:${to}:${platform ?? "*"}`;
  const p = cached(key, 60_000, () => readStats(ctx, from, to, platform)).catch(() => empty());
  spans.push({ from, to, platform, p });
  return p;
}

/** Live platform dashboards for the accounts in scope, once per request. Notes about failures go on `r`. */
async function boardsFor(ctx: PipCtx, platform: string | null, r: PipResult) {
  const scratch = base(r.tool, "", null, [], "", null);
  const got = await memo(ctx, `boards:${platform ?? "*"}`, async () => {
    const accts = await accountsInScope(ctx, platform).catch(() => [] as Acct[]);
    return { accts, boards: await dashboards(ctx, accts, scratch), notes: scratch.notes };
  });
  for (const n of got.notes) if (!r.notes.some((x) => x.text === n.text)) r.notes.push(n);
  return got;
}

// ---------- shared pieces of an answer ----------
const ago = (at: number, now: number) => {
  const m = Math.max(0, Math.round((now - at) / 60000));
  return m < 2 ? "just now" : m < 90 ? `${m} minutes ago` : m < 48 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
};

/** Where the numbers came from, how fresh they are, and what the period leaves out. */
function frame(r: PipResult, ctx: PipCtx, w: Win, st: Stats, explicit: boolean) {
  r.range = { label: w.label, tz: ctx.tz };
  if (w.cut && explicit) r.notes.push({ level: "warn", text: w.cut });
  if (st.failed) {
    r.complete = false;
    r.notes.push({ level: "warn", text: "Your numbers couldn't be read just now, so this may be empty or short. Ask again in a minute." });
  }
  if (st.capped) {
    r.complete = false;
    r.notes.push({ level: "warn", text: "There were too many sync records to read at once, so totals may be short. Ask for a shorter period." });
  }
  if (st.firstSync && st.firstSync > w.from.getTime() + A.DAY_MS)
    r.notes.push({ level: "info", text: `Outlly started tracking your numbers on ${dayLabel(new Date(st.firstSync), ctx.tz)}, so days before that show nothing rather than what really happened.` });
  for (const s of st.stale) r.notes.push({ level: "warn", text: `${s}, so its numbers may have stopped updating.` });
  const platforms = [...new Set([...st.posts.map((p) => p.platform), ...st.snaps.map((s) => s.platform)])].map(pname);
  const fresh = st.lastSync ? `, last synced ${ago(st.lastSync, ctx.now.getTime())}` : "";
  if (platforms.length) r.sources = [`Outlly's synced numbers for posts published through Outlly on ${list(platforms)}${fresh}. They update about every 30 minutes.`];
}

/** Activity inside [from, to): the synced deltas added up. */
function totalsIn(snaps: A.Snap[], from: number, to: number, platform?: string | null) {
  const t = { views: 0, likes: 0, comments: 0, shares: 0 };
  for (const s of snaps) {
    if (s.at < from || s.at >= to || (platform && s.platform !== platform)) continue;
    t.views += s.views;
    t.likes += s.likes;
    t.comments += s.comments;
    t.shares += s.shares;
  }
  return { ...t, views: Math.max(0, t.views), inter: Math.max(0, t.likes + t.comments + t.shares) };
}

const uniquePosts = (posts: A.StatPost[]) => {
  const seen = new Map<string, A.StatPost>();
  for (const p of posts) if (!seen.has(p.postId) || p.publishedAt < seen.get(p.postId)!.publishedAt) seen.set(p.postId, p);
  return [...seen.values()];
};

/** Synced history starts at firstSync: analysing days before it would read missing data as zero activity. */
const syncedFrom = (w: Win, st: Stats) => Math.max(w.from.getTime(), st.firstSync ? A.DAY_MS * Math.floor(st.firstSync / A.DAY_MS) : w.from.getTime());

const deltaOf = (cur: number, prev: number | null) => (prev == null ? undefined : A.fmtSigned(A.changePct(cur, prev)));
const nothingYet = (r: PipResult, ctx: PipCtx) => {
  r.empty = ctx.scope ? "There are no published posts with numbers on the accounts you work on in that period." : "No published posts with numbers in that period yet. Post through Outlly and the numbers start syncing within about 30 minutes.";
  return r;
};

const postCols = [
  { key: "title", label: "Post" },
  { key: "where", label: "Platform" },
  { key: "date", label: "Posted" },
  { key: "views", label: "Views", align: "end" as const },
  { key: "er", label: "Engagement", align: "end" as const },
  { key: "likes", label: "Likes", align: "end" as const },
  { key: "comments", label: "Comments", align: "end" as const },
  { key: "shares", label: "Shares", align: "end" as const },
];
const postRow = (p: A.StatPost, tz: string) => ({
  id: p.key,
  cells: {
    title: p.title,
    where: pname(p.platform),
    date: dayLabel(new Date(p.publishedAt), tz),
    views: p.hasMetrics ? A.fmtInt(p.views) : "Not synced yet",
    er: p.hasMetrics ? A.fmtRate(A.erOf(A.interactionsOf(p), p.views)) : "",
    likes: p.hasMetrics ? A.fmtInt(p.likes) : "",
    comments: p.hasMetrics ? A.fmtInt(p.comments) : "",
    shares: p.hasMetrics ? A.fmtInt(p.shares) : "",
  },
  links: p.url ? [{ label: `Open on ${pname(p.platform)}`, href: p.url }] : undefined,
});

// ---------- overview: "views this week", "engagement rate yesterday", "most shares this month" ----------
type Metric = "views" | "likes" | "comments" | "shares";
const metricOf = (t: string): Metric => (/\bshar/i.test(t) ? "shares" : /\bcomment/i.test(t) ? "comments" : /\blike/i.test(t) ? "likes" : "views");

export const overview: Tool = async (ctx, a, range, period) => {
  const platform = plat(a.platform);
  const w = await windowFor(ctx, range, 30);
  const r = base("overview", platform ? `Your ${pname(platform)} numbers` : "Your numbers", w, postCols, "", period);
  const prev = previousRange(w, ctx.now);
  const comparable = prev.from.getTime() >= w.earliest && w.days >= 1;
  const st = await loadStats(ctx, comparable ? prev.from.getTime() : w.from.getTime(), w.to.getTime(), platform);
  frame(r, ctx, w, st, !!range);
  const from = w.from.getTime();
  const to = w.to.getTime();
  const cur = totalsIn(st.snaps, from, to);
  const old = comparable ? totalsIn(st.snaps, prev.from.getTime(), prev.to.getTime()) : null;
  const inWin = st.posts.filter((p) => p.publishedAt >= from && p.publishedAt < to);
  const prevPosts = comparable ? uniquePosts(st.posts.filter((p) => p.publishedAt >= prev.from.getTime() && p.publishedAt < prev.to.getTime())).length : null;
  const nPosts = uniquePosts(inWin).length;
  if (!inWin.length && !cur.views && !cur.inter) return nothingYet(r, ctx);
  const er = A.erOf(cur.inter, cur.views);
  const erOld = old ? A.erOf(old.inter, old.views) : null;
  r.cards = [
    { label: "Views", value: A.fmtInt(cur.views), delta: deltaOf(cur.views, old?.views ?? null), hint: comparable ? `vs ${prev.label}` : undefined },
    { label: "Engagement rate", value: A.fmtRate(er), delta: er != null && erOld != null ? `${er - erOld >= 0 ? "+" : ""}${r1(er - erOld)} pts` : undefined, hint: "Likes, comments and shares per 100 views" },
    { label: "Interactions", value: A.fmtInt(cur.inter), delta: deltaOf(cur.inter, old?.inter ?? null) },
    { label: "Posts published", value: A.fmtInt(nPosts), delta: prevPosts == null ? undefined : deltaOf(nPosts, prevPosts) },
  ];
  const metric = metricOf(ctx.message);
  const ranked = inWin.filter((p) => p.hasMetrics).sort((x, y) => y[metric] - x[metric] || y.views - x.views);
  const limit = Math.min(Math.max(a.limit ?? 10, 1), 25);
  r.rows = ranked.slice(0, limit).map((p) => postRow(p, ctx.tz));
  r.found = r.returned = r.rows.length;
  r.facts.push(`${w.label}: ${A.fmtInt(cur.views)} views${old ? ` (${A.fmtSigned(A.changePct(cur.views, old.views))} vs ${A.fmtInt(old.views)} in ${prev.label})` : ""}.`);
  r.facts.push(`Engagement rate ${A.fmtRate(er)}: ${A.fmtInt(cur.likes)} likes, ${A.fmtInt(cur.comments)} comments and ${A.fmtInt(cur.shares)} shares.`);
  if (erOld != null && er != null) r.facts.push(`Engagement rate in ${prev.label}: ${A.fmtRate(erOld)}.`);
  r.facts.push(`${plural(nPosts, "post")} published${prevPosts != null ? `, against ${prevPosts} in the period before` : ""}.`);
  if (ranked[0]) {
    r.facts.push(`Most ${metric}: "${ranked[0].title}" on ${pname(ranked[0].platform)}, ${A.fmtInt(ranked[0][metric])} ${metric} (lifetime so far).`);
    r.focus = { postId: ranked[0].key, title: ranked[0].title };
  }
  if (!comparable) r.notes.push({ level: "info", text: "There's no earlier period inside your plan's history to compare with." });
  r.notes.push({ level: "info", text: "Totals count what happened inside the dates. Post rows show each post's lifetime numbers so far." });
  r.notes.push({ level: "info", text: "Saves, reach and impressions aren't in Outlly's history yet. Ask \"compare my platforms\" for reach as the platforms report it." });
  return r;
};

// ---------- compare_platforms: "Instagram vs YouTube", "which platform has the most followers" ----------
const VIEW_NOTE =
  "Each platform counts a view its own way (Instagram counts plays, replays included; YouTube counts filtered watches), so raw views don't line up one to one. Engagement rate and typical views per post are the fairer comparison.";

export const comparePlatforms: Tool = async (ctx, a, range, period) => {
  const w = await windowFor(ctx, range, 30);
  const r = base(
    "compare_platforms",
    "Your platforms side by side",
    w,
    [
      { key: "where", label: "Platform" },
      { key: "followers", label: "Followers", align: "end" },
      { key: "views", label: "Views", align: "end" },
      { key: "perPost", label: "Typical views per post", align: "end" },
      { key: "er", label: "Engagement", align: "end" },
      { key: "posts", label: "Posts", align: "end" },
    ],
    "",
    period,
  );
  const [st, live] = await Promise.all([loadStats(ctx, w.from.getTime(), w.to.getTime(), null), boardsFor(ctx, null, r)]);
  frame(r, ctx, w, st, !!range);
  const from = w.from.getTime();
  const to = w.to.getTime();
  const followers = new Map<string, number>();
  const reach = new Map<string, number>();
  for (const { acct, d } of live.boards) {
    const f = d.headline.find((h) => h.key === "followers" || h.key === "subscribers")?.value;
    if (f != null) followers.set(acct.platform, (followers.get(acct.platform) ?? 0) + f);
    const re = d.headline.find((h) => h.key === "reach")?.value;
    if (re != null) reach.set(acct.platform, (reach.get(acct.platform) ?? 0) + re);
  }
  const names = [...new Set([...st.posts.map((p) => p.platform), ...st.snaps.map((s) => s.platform), ...live.accts.map((x) => x.platform as string)])].filter(isPlatform);
  if (!names.length) {
    r.empty = ctx.scope ? "None of the accounts you work on are connected." : "Connect an account first; then I can compare your platforms.";
    return r;
  }
  // "Instagram vs YouTube": just the two asked about, not every platform.
  const asked = platformsNamed(ctx.message).filter((p): p is (typeof names)[number] => (names as string[]).includes(p));
  if (asked.length >= 2) r.notes.push({ level: "info", text: `Showing only ${list(asked.map(pname))}, as you asked.` });
  type Row = { p: string; views: number; er: number | null; perPost: number | null; posts: number; followers: number | null };
  const rows: Row[] = (asked.length >= 2 ? asked : names).map((p) => {
    const t = totalsIn(st.snaps, from, to, p);
    const ps = st.posts.filter((x) => x.platform === p && x.hasMetrics);
    return { p, views: t.views, er: A.erOf(t.inter, t.views), perPost: ps.length ? A.median(ps.map((x) => x.views)) : null, posts: st.posts.filter((x) => x.platform === p).length, followers: followers.get(p) ?? null };
  });
  rows.sort((x, y) => y.views - x.views);
  r.rows = rows.map((x) => ({
    id: x.p,
    cells: {
      where: pname(x.p),
      followers: x.followers == null ? "Not available" : A.fmtInt(x.followers),
      views: A.fmtInt(x.views),
      perPost: x.perPost == null ? "No posts" : A.fmtInt(x.perPost),
      er: A.fmtRate(x.er),
      posts: x.posts,
    },
  }));
  r.found = r.returned = r.rows.length;
  const best = <K extends keyof Row>(k: K) => [...rows].filter((x) => x[k] != null).sort((x, y) => (y[k] as number) - (x[k] as number))[0];
  const topF = best("followers");
  const topV = rows[0];
  const topE = [...rows].filter((x) => x.er != null && x.views >= 100).sort((x, y) => y.er! - x.er!)[0];
  const topP = [...rows].filter((x) => x.perPost != null && x.posts >= 3).sort((x, y) => y.perPost! - x.perPost!)[0];
  r.cards = [
    ...(topF ? [{ label: "Most followers", value: pname(topF.p), hint: `${A.fmtInt(topF.followers!)} today` }] : []),
    { label: "Most views", value: pname(topV.p), hint: `${A.fmtInt(topV.views)} in the period` },
    ...(topE ? [{ label: "Best engagement", value: pname(topE.p), hint: A.fmtRate(topE.er) }] : []),
    ...(topP ? [{ label: "Most views per post", value: pname(topP.p), hint: `typically ${A.fmtInt(topP.perPost!)}` }] : []),
  ];
  if (topF) r.facts.push(`Most followers: ${pname(topF.p)} with ${A.fmtInt(topF.followers!)} (as the platform reports it today).`);
  else if (/\b(follow|subscri)/i.test(ctx.message))
    r.facts.push(`I couldn't read a follower count from any platform just now, so I can't say which has the most followers.${r.notes.some((n) => /reconnect/i.test(n.text)) ? " Some accounts need reconnecting first; they're listed below." : ""}`);
  for (const x of rows)
    r.facts.push(`${pname(x.p)}: ${A.fmtInt(x.views)} views, engagement ${A.fmtRate(x.er)}, ${plural(x.posts, "post")}${x.perPost != null ? `, typically ${A.fmtInt(x.perPost)} views per post` : ""}${x.followers != null ? `, ${A.fmtInt(x.followers)} followers` : ""}.`);
  if (topE && rows.length > 1) r.facts.push(`Best engagement rate: ${pname(topE.p)} (${A.fmtRate(topE.er)}).`);
  for (const [p, v] of reach) r.facts.push(`${pname(p)} reach for the last 28 days, as Instagram reports it: ${A.fmtInt(v)} accounts.`);
  if (rows.length === 1) r.facts.push(`Only ${pname(rows[0].p)} has numbers, so there's nothing to compare it with yet.`);
  r.notes.push({ level: "info", text: VIEW_NOTE });
  r.notes.push({ level: "info", text: `Followers are today's count from each platform. Views and engagement cover ${w.label}, from posts published through Outlly.` });
  if (live.boards.length) r.sources = [...(r.sources ?? []), "Followers and reach: read live from each platform just now."];
  return r;
};

// ---------- trend: weekly direction with a significance test, plus unusual days ----------
export const trend: Tool = async (ctx, a, range, period) => {
  const platform = plat(a.platform);
  const w = await windowFor(ctx, range, 90);
  const r = base(
    "trend",
    platform ? `Your ${pname(platform)} trend` : "Your trend",
    w,
    [
      { key: "week", label: "Week of" },
      { key: "views", label: "Views", align: "end" },
      { key: "perDay", label: "Views a day", align: "end" },
      { key: "er", label: "Engagement", align: "end" },
      { key: "posts", label: "Posts", align: "end" },
    ],
    "",
    period,
  );
  const st = await loadStats(ctx, w.from.getTime(), w.to.getTime(), platform);
  frame(r, ctx, w, st, !!range);
  const start = syncedFrom(w, st);
  const b = A.bucketDays(st.snaps, uniquePosts(st.posts), start, w.to.getTime(), ctx.tz);
  if (!sum(b.views) && !st.posts.length) return nothingYet(r, ctx);
  const weeks = A.toWeeks(b);
  const full = weeks.filter((x) => x.days === 7);
  r.rows = weeks.map((x) => ({ id: x.key, cells: { week: `${A.shortDay(x.key)}${x.days < 7 ? ` (${x.days} days)` : ""}`, views: A.fmtInt(x.views), perDay: A.fmtInt(x.perDay), er: A.fmtRate(x.er), posts: x.posts } }));
  r.found = r.returned = r.rows.length;
  const tv = A.trendOf(full.map((x) => x.perDay));
  const erWeeks = full.filter((x) => x.er != null && x.views >= 50);
  const te = A.trendOf(erWeeks.map((x) => x.er!));
  const word = (d: "up" | "down" | "flat") => (d === "up" ? "rising" : d === "down" ? "falling" : "holding steady");
  const sig = (t: Extract<A.Trend, { enough: true }>) => (t.p == null ? "too few weeks to test whether it's more than chance" : t.significant ? `${A.fmtP(t.p)}, unlikely to be chance` : `${A.fmtP(t.p)}, could be normal ups and downs`);
  r.cards = [];
  if (tv.enough) {
    r.cards.push({ label: "Views trend", value: cap(word(tv.direction)), delta: `${A.fmtSigned(tv.weeklyPct)} a week`, hint: tv.significant ? "Statistically clear" : "Not statistically clear" });
    r.facts.push(`Views per day are ${word(tv.direction)}: about ${A.fmtSigned(tv.weeklyPct)} a week over ${tv.n} full weeks (${sig(tv)}).`);
  } else r.facts.push(`Only ${plural(full.length, "full week")} of numbers; I need 4 before I can call a trend.`);
  if (te.enough) {
    r.cards.push({ label: "Engagement trend", value: cap(word(te.direction)), delta: `${A.fmtSigned(te.weeklyPct)} a week`, hint: te.significant ? "Statistically clear" : "Not statistically clear" });
    r.facts.push(`Engagement rate is ${word(te.direction)}: from ${A.fmtRate(erWeeks[0].er)} to ${A.fmtRate(erWeeks[erWeeks.length - 1].er)} a week over ${te.n} weeks (${sig(te)}).`);
  }
  if (full.length >= 2) {
    const f = full[0];
    const l = full[full.length - 1];
    r.cards.push({ label: "Views a day, latest full week", value: A.fmtInt(l.perDay), delta: deltaOf(l.perDay, f.perDay), hint: `vs ${A.fmtInt(f.perDay)} in the week of ${A.shortDay(f.key)}` });
  }
  // Unusual days, each with what went out that day or the day before (a link, never a cause).
  const odd = A.anomaliesOf(b.views, b.keys.map(A.shortDay), 14);
  for (const o of odd.slice(0, 3)) {
    const days = new Set(b.keys.slice(Math.max(0, o.index - 2), o.index + 1));
    const near = st.posts.filter((p) => days.has(A.localDay(p.publishedAt, ctx.tz))).sort((x, y) => y.views - x.views)[0];
    r.facts.push(`${o.kind === "spike" ? "Spike" : "Dip"} on ${o.label}: ${A.fmtInt(o.value)} views, ${A.fmtX(o.ratio)} a typical day${near ? `; "${near.title}" went out around then` : ""}.`);
  }
  if (odd.length) r.notes.push({ level: "info", text: `Spikes and dips are days far outside your usual range. A post going out near one is ${LINKED.toLowerCase().replace(".", "")}.` });
  else if (b.keys.length >= 14) r.facts.push("No unusual days: every day sat within your normal range.");
  r.notes.push({ level: "info", text: "Trends use full weeks only (Monday to Sunday) and a Mann-Kendall test, so one big day can't fake a trend." });
  return r;
};

// ---------- consistency: "am I consistent", frequency vs performance ----------
export const consistency: Tool = async (ctx, a, range, period) => {
  const platform = plat(a.platform);
  const w = await windowFor(ctx, range, 90);
  const r = base(
    "consistency",
    "How consistently you post",
    w,
    [
      { key: "week", label: "Week of" },
      { key: "posts", label: "Posts", align: "end" },
      { key: "perDay", label: "Views a day", align: "end" },
    ],
    "No posts published in that period, so there's no pattern to read yet.",
    period,
  );
  const [st, user] = await Promise.all([
    loadStats(ctx, w.from.getTime(), w.to.getTime(), platform),
    db.user.findUnique({ where: { id: ctx.ownerId }, select: { postingGoal: true } }).catch(() => null),
  ]);
  frame(r, ctx, w, st, !!range);
  const ups = uniquePosts(st.posts);
  if (!ups.length) {
    r.facts.push(`0 posts published in ${w.label}.`);
    return r;
  }
  let weeks = A.toWeeks(A.bucketDays(st.snaps, ups, w.from.getTime(), w.to.getTime(), ctx.tz));
  // Weeks before the first post in the period would read as "missed" for someone who just started.
  const firstActive = weeks.findIndex((x) => x.posts > 0);
  if (firstActive > 0) {
    weeks = weeks.slice(firstActive);
    r.notes.push({ level: "info", text: `Counted from your first post in the period, in the week of ${A.shortDay(weeks[0].key)}.` });
  }
  const c = A.consistencyOf(weeks, ups.map((p) => p.publishedAt), ctx.now.getTime());
  const goal = user?.postingGoal ?? 0;
  r.rows = weeks.map((x) => ({ id: x.key, cells: { week: `${A.shortDay(x.key)}${x.days < 7 ? ` (${x.days} days)` : ""}`, posts: x.posts, perDay: A.fmtInt(x.perDay) } }));
  r.found = r.returned = r.rows.length;
  r.cards = [
    { label: "Verdict", value: c.verdict },
    { label: "Posts a week", value: String(r1(c.avg)), hint: goal ? `Your goal: ${goal}` : undefined },
    { label: "Weeks with a post", value: `${c.activeWeeks} of ${c.weeks}` },
    { label: "Longest gap", value: plural(c.longestGapDays, "day") },
  ];
  r.facts.push(`${c.verdict}: ${plural(ups.length, "post")} in ${w.label}, about ${r1(c.avg)} a week, with a post in ${c.activeWeeks} of ${c.weeks} weeks.`);
  r.facts.push(`Longest gap between posts: ${plural(c.longestGapDays, "day")}.${c.daysSinceLast != null ? ` Last post ${plural(c.daysSinceLast, "day")} ago.` : ""}`);
  if (goal > 0) {
    const hit = weeks.filter((x) => x.days === 7 && x.posts >= goal).length;
    r.facts.push(`Your goal is ${goal} posts a week; you reached it in ${hit} of ${weeks.filter((x) => x.days === 7).length} full weeks.`);
  }
  // Frequency vs performance: do busier weeks get more views a day? Spearman, full synced weeks only.
  const synced = weeks.filter((x) => x.days === 7 && (!st.firstSync || new Date(`${x.key}T00:00:00Z`).getTime() >= st.firstSync - A.DAY_MS));
  const rho = synced.length >= 6 ? A.spearman(synced.map((x) => x.posts), synced.map((x) => x.perDay)) : null;
  if (rho != null) {
    const strength = Math.abs(rho) >= 0.5 ? "clearly" : Math.abs(rho) >= 0.3 ? "somewhat" : null;
    r.facts.push(
      strength
        ? `Weeks with more posts ${strength} had ${rho > 0 ? "more" : "fewer"} views a day (Spearman ${Math.round(rho * 100) / 100} over ${synced.length} weeks). ${LINKED}`
        : `How often you posted in a week made no clear difference to that week's views (Spearman ${Math.round(rho * 100) / 100} over ${synced.length} weeks).`,
    );
  } else r.notes.push({ level: "info", text: "I need 6 full weeks of numbers to check whether posting more often goes with more views." });
  return r;
};

// ---------- best_times: when posts did best, against each platform's usual ----------
export const bestTimes: Tool = async (ctx, a, range, period) => {
  const platform = plat(a.platform);
  const w = await windowFor(ctx, range, 180);
  const r = base(
    "best_times",
    "When your posts do best",
    w,
    [
      { key: "kind", label: "By" },
      { key: "when", label: "When" },
      { key: "posts", label: "Posts", align: "end" },
      { key: "rel", label: "Views vs your usual", align: "end" },
      { key: "er", label: "Engagement", align: "end" },
    ],
    "",
    period,
  );
  const [st, live] = await Promise.all([loadStats(ctx, w.from.getTime(), w.to.getTime(), platform), boardsFor(ctx, platform ?? "instagram", r)]);
  frame(r, ctx, w, st, !!range);
  // Instagram reports when followers are online, already in the creator's timezone.
  const hours = live.boards.flatMap(({ d }) => d.hours ?? []);
  if (hours.length >= 12) {
    const top = [...hours].sort((x, y) => y.value - x.value).slice(0, 3);
    r.facts.push(`Your Instagram followers are most often online around ${list(top.map((h) => h.label))} (${ctx.tz}), as Instagram reports it.`);
    r.sources = [...(r.sources ?? []), "Followers online by hour: read live from Instagram."];
  }
  const rows = A.relative(st.posts);
  const t = A.bestTimesOf(rows, ctx.tz);
  if (!t.enough) {
    r.facts.push(`Only ${plural(t.n, "post")} with numbers in ${w.label}; I need 10 before I can compare days and times fairly.`);
    r.empty = hours.length >= 12 ? "Not enough of your own posts yet to compare days and times; the follower hours above are the best guide for now." : "Not enough posts with numbers yet to compare days and times. Ask again after about 10 posts.";
    return r;
  }
  const order = (g: A.Group[], keys: string[]) => keys.map((k) => g.find((x) => x.label === k)).filter((x): x is A.Group => !!x);
  const blockKeys = A.BLOCKS;
  const add = (kind: string, g: A.Group) => r.rows.push({ id: `${kind}:${g.label}`, cells: { kind, when: g.label, posts: g.n, rel: g.enough ? A.fmtX(g.rel) : "Too few posts", er: g.enough ? A.fmtRate(g.er) : "" } });
  for (const g of order(t.days, A.WEEKDAYS)) add("Day", g);
  for (const g of order(t.blocks, blockKeys)) add("Time", g);
  r.found = r.returned = r.rows.length;
  const when = new Map(rows.map((x) => [x.p.key, A.localWhen(x.p.publishedAt, ctx.tz)]));
  const verdict = (pick: (k: string) => boolean, label: string, g: A.Group) => {
    const inG = rows.filter((x) => pick(x.p.key)).map((x) => x.rel);
    const rest = rows.filter((x) => !pick(x.p.key)).map((x) => x.rel);
    const p = A.mannWhitneyP(inG, rest);
    const test = p == null ? "too few posts to test it" : p < 0.05 ? `${A.fmtP(p)}, a real difference` : `${A.fmtP(p)}, could still be chance`;
    r.facts.push(`Best ${label} so far: ${g.label}. Posts then typically got ${A.fmtX(g.rel)} your usual views across ${plural(g.n, "post")} (${test}).`);
    return p;
  };
  const bestDay = t.days.find((g) => g.enough && g.n >= 3);
  const bestBlock = t.blocks.find((g) => g.enough && g.n >= 3);
  r.cards = [];
  if (bestDay) {
    const p = verdict((k) => A.WEEKDAYS[when.get(k)!.weekday] === bestDay.label, "day", bestDay);
    r.cards.push({ label: "Best day", value: bestDay.label, hint: `${A.fmtX(bestDay.rel)} your usual views${p != null && p < 0.05 ? "" : ", not yet certain"}` });
  }
  if (bestBlock) {
    const p = verdict((k) => A.blockOf(when.get(k)!.hour) === bestBlock.label, "time", bestBlock);
    r.cards.push({ label: "Best time", value: bestBlock.label.split(" (")[0], hint: `${A.fmtX(bestBlock.rel)} your usual views${p != null && p < 0.05 ? "" : ", not yet certain"}` });
  }
  if (!bestDay && !bestBlock) r.facts.push("No day or time has 3 or more posts yet, so none can be called best.");
  r.cards.push({ label: "Posts compared", value: String(t.n) });
  r.notes.push({ level: "info", text: `Each post is compared with the usual for its own platform, so a big platform can't win every slot. Times are in ${ctx.tz}.` });
  return r;
};

// ---------- formats: what kinds of posts work (Outlly has no "category" field, so: format, shape, caption, hashtags) ----------
const DIMENSIONS: [string, (p: A.StatPost) => string | string[] | null][] = [
  ["Format", (p) => p.format],
  ["Shape", (p) => p.orientation],
  ["Caption", (p) => A.captionBucket(p.captionLen)],
  ["Hashtags", (p) => A.hashtagBucket(p.hashtags.length)],
  ["Platform", (p) => pname(p.platform)],
];

export const formats: Tool = async (ctx, a, range, period) => {
  const platform = plat(a.platform);
  const w = await windowFor(ctx, range, 90);
  const r = base(
    "formats",
    "What kinds of posts work for you",
    w,
    [
      { key: "dim", label: "By" },
      { key: "group", label: "Group" },
      { key: "posts", label: "Posts", align: "end" },
      { key: "rel", label: "Views vs your usual", align: "end" },
      { key: "er", label: "Engagement", align: "end" },
    ],
    "",
    period,
  );
  const st = await loadStats(ctx, w.from.getTime(), w.to.getTime(), platform);
  frame(r, ctx, w, st, !!range);
  const rows = A.relative(st.posts);
  if (rows.length < 4) {
    r.facts.push(`Only ${plural(rows.length, "post")} with numbers in ${w.label}; I need at least 4 to compare kinds of posts.`);
    return nothingYet(r, ctx);
  }
  const groups = new Map<string, A.Group[]>();
  for (const [dim, key] of DIMENSIONS) {
    const g = A.segment(rows, key);
    groups.set(dim, g);
    for (const x of g) r.rows.push({ id: `${dim}:${x.label}`, cells: { dim, group: x.label, posts: x.n, rel: x.enough ? A.fmtX(x.rel) : "Too few posts", er: x.enough ? A.fmtRate(x.er) : "" } });
  }
  r.found = r.returned = r.rows.length;
  r.cards = [];
  const facts: string[] = [];
  for (const dim of ["Format", "Shape", "Caption", "Hashtags"]) {
    const ok = (groups.get(dim) ?? []).filter((x) => x.enough);
    if (ok.length < 2) continue;
    const top = ok[0];
    const low = ok[ok.length - 1];
    const keyOf = DIMENSIONS.find((d) => d[0] === dim)![1];
    const of = (label: string) => rows.filter((x) => {
      const k = keyOf(x.p);
      return Array.isArray(k) ? k.includes(label) : k === label;
    }).map((x) => x.rel);
    const p = A.mannWhitneyP(of(top.label), of(low.label));
    const test = p == null ? "" : p < 0.05 ? ` (${A.fmtP(p)}, a real difference)` : ` (${A.fmtP(p)}, could be chance)`;
    facts.push(`${dim}: ${top.label} does best, typically ${A.fmtX(top.rel)} your usual views across ${plural(top.n, "post")}; ${low.label} does least, ${A.fmtX(low.rel)} across ${plural(low.n, "post")}${test}.`);
    if (dim === "Format" || dim === "Shape") r.cards.push({ label: `Best ${dim.toLowerCase()}`, value: top.label, hint: `${A.fmtX(top.rel)} your usual views, ${plural(top.n, "post")}` });
    if (dim === "Format") r.cards.push({ label: "Weakest format", value: low.label, hint: `${A.fmtX(low.rel)} your usual views, ${plural(low.n, "post")}` });
  }
  if (!facts.length) facts.push("No kind of post has 3 or more posts on both sides yet, so I can't say which works better.");
  r.facts.push(...facts);
  // Patterns in the top posts: which trait is most over-represented in the best quarter.
  if (rows.length >= 8) {
    const sorted = [...rows].sort((x, y) => y.rel - x.rel);
    const top = sorted.slice(0, Math.max(2, Math.round(rows.length / 4)));
    let bestPattern: { text: string; lift: number } | null = null;
    for (const [dim, key] of DIMENSIONS.slice(0, 3)) {
      for (const g of groups.get(dim) ?? []) {
        if (!g.enough) continue;
        const inTop = top.filter((x) => key(x.p) === g.label).length / top.length;
        const overall = g.n / rows.length;
        if (inTop >= 0.5 && inTop - overall >= 0.2 && (!bestPattern || inTop - overall > bestPattern.lift))
          bestPattern = { lift: inTop - overall, text: `Your top ${top.length} posts: ${Math.round(inTop * 100)}% are ${g.label.toLowerCase()} (${dim.toLowerCase()}), against ${Math.round(overall * 100)}% of all your posts. ${LINKED}` };
      }
    }
    if (bestPattern) r.facts.push(bestPattern.text);
  }
  const tags = A.segment(rows, (p) => p.hashtags, 3).filter((x) => x.enough).slice(0, 3);
  if (tags.length) r.facts.push(`Hashtags that go with your best views: ${tags.map((x) => `${x.label} (${A.fmtX(x.rel)}, ${x.n} posts)`).join(", ")}.`);
  r.notes.push({ level: "info", text: "Outlly doesn't tag posts with categories, so I group them by format, shape, caption length, hashtags and platform. Each post is compared with the usual on its own platform." });
  return r;
};

// ---------- segments: high reach but low interaction, and the other three corners ----------
export const segments: Tool = async (ctx, a, range, period) => {
  const platform = plat(a.platform);
  const w = await windowFor(ctx, range, 90);
  const r = base(
    "segments",
    "Reach against interaction",
    w,
    [
      { key: "title", label: "Post" },
      { key: "where", label: "Platform" },
      { key: "group", label: "Group" },
      { key: "rel", label: "Views vs your usual", align: "end" },
      { key: "er", label: "Engagement", align: "end" },
    ],
    "",
    period,
  );
  const st = await loadStats(ctx, w.from.getTime(), w.to.getTime(), platform);
  frame(r, ctx, w, st, !!range);
  const rows = A.relative(st.posts);
  const q = A.quadrants(rows);
  if (!q) {
    r.facts.push(`Only ${plural(rows.filter((x) => x.p.views > 0).length, "post")} with views in ${w.label}; I need 6 to split them fairly.`);
    return nothingYet(r, ctx);
  }
  const NAMES = { highReachLowInteraction: "Seen a lot, few interactions", lowReachHighInteraction: "Seen less, strong interaction", stars: "Seen a lot, strong interaction", quiet: "Seen less, few interactions" } as const;
  for (const k of ["highReachLowInteraction", "lowReachHighInteraction", "stars", "quiet"] as const)
    for (const x of q[k]) r.rows.push({ id: x.p.key, cells: { title: x.p.title, where: pname(x.p.platform), group: NAMES[k], rel: A.fmtX(x.rel), er: A.fmtRate(x.er) }, links: x.p.url ? [{ label: `Open on ${pname(x.p.platform)}`, href: x.p.url }] : undefined });
  r.rows = r.rows.slice(0, 60);
  r.found = r.returned = r.rows.length;
  r.cards = (["stars", "highReachLowInteraction", "lowReachHighInteraction", "quiet"] as const).map((k) => ({ label: NAMES[k], value: String(q[k].length) }));
  r.facts.push(`Split at your own medians: ${A.fmtX(q.medianRel)} your usual views and ${A.fmtRate(q.medianEr)} engagement.`);
  const hi = q.highReachLowInteraction;
  if (hi.length)
    r.facts.push(`${plural(hi.length, "post")} reached more people than usual but got fewer interactions, for example ${hi.slice(0, 3).map((x) => `"${x.p.title}" (${A.fmtX(x.rel)} views, ${A.fmtRate(x.er)})`).join(", ")}.`);
  const lo = q.lowReachHighInteraction;
  if (lo.length) r.facts.push(`${plural(lo.length, "post")} reached fewer people but those who saw them engaged strongly, for example "${lo[0].p.title}" (${A.fmtRate(lo[0].er)}). More reach for that kind of post could pay off.`);
  if (q.stars[0]) {
    r.facts.push(`Strongest on both: "${q.stars[0].p.title}" (${A.fmtX(q.stars[0].rel)} your usual views, ${A.fmtRate(q.stars[0].er)}).`);
    r.focus = { postId: q.stars[0].p.key, title: q.stars[0].p.title };
  }
  const weakest = [...rows].filter((x) => x.p.views > 0).sort((x, y) => x.rel - y.rel).slice(0, 3);
  if (weakest.length) r.facts.push(`Underperformers: ${weakest.map((x) => `"${x.p.title}" (${A.fmtX(x.rel)} your usual views)`).join(", ")}.`);
  r.notes.push({ level: "info", text: "Groups compare each post with your own usual on the same platform, not with other creators." });
  return r;
};

// ---------- schedule: upcoming, missed, failed, missing captions ----------
const titleOf = (p: { title: string | null; hook: string | null; story?: string | null }) => short(p.title || p.hook || p.story || "Untitled", 60);
const emptyCaption = (t: { caption: string | null; description: string | null; title?: string | null }) => !(t.caption ?? "").trim() && !(t.description ?? "").trim();

export const schedule: Tool = async (ctx, a, range, period) => {
  const platform = plat(a.platform);
  const now = ctx.now.getTime();
  // A period in the future ("next week" isn't parsed, "this month" is) bounds the upcoming list; else the next 30 days.
  const upTo = range && range.to.getTime() > now ? range.to.getTime() : now + 30 * A.DAY_MS;
  const r = base(
    "schedule",
    "Your schedule",
    { from: ctx.now, to: new Date(upTo), label: `${dayLabel(ctx.now, ctx.tz)} to ${dayLabel(new Date(upTo - 1), ctx.tz)}`, tz: ctx.tz },
    [
      { key: "title", label: "Post" },
      { key: "when", label: "When" },
      { key: "where", label: "Platforms" },
      { key: "status", label: "Status" },
    ],
    "Nothing scheduled, missed or failed right now.",
    period,
  );
  const tf = { practice: false, ...(platform ? { platform } : {}), ...(ctx.scope ? { socialAccountId: { in: ctx.scope } } : {}) };
  const some = platform || ctx.scope ? { targets: { some: tf } } : {};
  const tsel = { where: tf, select: { platform: true, caption: true, description: true, socialAccountId: true } } as const;
  const psel = { id: true, title: true, hook: true, story: true, scheduledAt: true, targets: tsel } as const;
  const [up, missed, failed, recent] = await Promise.all([
    db.post.findMany({ where: { userId: ctx.ownerId, status: "scheduled", scheduledAt: { gte: ctx.now, lt: new Date(upTo) }, ...some }, orderBy: { scheduledAt: "asc" }, take: 300, select: psel }).catch(() => null),
    db.post.findMany({ where: { userId: ctx.ownerId, status: "scheduled", scheduledAt: { lt: new Date(now - 15 * 60000) }, ...some }, orderBy: { scheduledAt: "desc" }, take: 50, select: psel }).catch(() => null),
    db.postTarget
      .findMany({
        where: { post: { userId: ctx.ownerId }, ...tf, platformStatus: "failed", updatedAt: { gte: new Date(now - 30 * A.DAY_MS) } },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: { id: true, platform: true, errorMessage: true, updatedAt: true, post: { select: { id: true, title: true, hook: true, story: true } } },
      })
      .catch(() => null),
    db.post.count({ where: { userId: ctx.ownerId, status: { in: ["published", "partial"] }, publishedAt: { gte: new Date(now - 28 * A.DAY_MS) }, ...some } }).catch(() => null),
  ]);
  if (!up || !missed || !failed) {
    r.complete = false;
    r.notes.push({ level: "warn", text: "Part of your schedule couldn't be read just now, so this may be short. Ask again in a minute." });
  }
  const where = (ts: { platform: string }[]) => [...new Set(ts.map((t) => pname(t.platform)))].join(", ") || "Not picked";
  const when = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-IN", { timeZone: ctx.tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d) : "");
  let noCaption = 0;
  for (const p of up ?? []) {
    const blank = p.targets.filter(emptyCaption).map((t) => pname(t.platform));
    if (blank.length) noCaption++;
    r.rows.push({ id: p.id, cells: { title: titleOf(p), when: when(p.scheduledAt), where: where(p.targets), status: blank.length ? `Scheduled, no caption on ${list(blank)}` : "Scheduled" }, links: [{ label: "Open in Content", href: "/content" }] });
  }
  for (const p of missed ?? []) r.rows.push({ id: p.id, cells: { title: titleOf(p), when: when(p.scheduledAt), where: where(p.targets), status: "Missed: still waiting to go out" }, links: [{ label: "Open in Content", href: "/content" }] });
  for (const t of failed ?? [])
    r.rows.push({ id: t.id, cells: { title: titleOf(t.post), when: when(t.updatedAt), where: pname(t.platform), status: `Failed${t.errorMessage ? `: ${short(t.errorMessage, 80)}` : ""}` }, links: [{ label: "Open in Content", href: "/content" }] });
  r.found = r.returned = r.rows.length;
  const nUp = up?.length ?? 0;
  const week = (up ?? []).filter((p) => p.scheduledAt && p.scheduledAt.getTime() < now + 7 * A.DAY_MS).length;
  r.cards = [
    { label: "Scheduled", value: String(nUp), hint: `next ${Math.round((upTo - now) / A.DAY_MS)} days` },
    { label: "Next 7 days", value: String(week) },
    { label: "Missed", value: String(missed?.length ?? 0) },
    { label: "Failed (30 days)", value: String(failed?.length ?? 0) },
  ];
  r.facts.push(`${plural(nUp, "post")} scheduled from ${r.range!.label}; ${week} in the next 7 days.`);
  if (up?.[0]?.scheduledAt) r.facts.push(`Next up: "${titleOf(up[0])}" on ${when(up[0].scheduledAt)}.`);
  if (noCaption) r.facts.push(`${plural(noCaption, "scheduled post")} ${noCaption === 1 ? "has" : "have"} no caption on at least one platform.`);
  if (missed?.length) r.facts.push(`${plural(missed.length, "post")} missed ${missed.length === 1 ? "its" : "their"} time and ${missed.length === 1 ? "is" : "are"} still waiting to go out.`);
  if (failed?.length) r.facts.push(`${plural(failed.length, "post")} failed to publish in the last 30 days.`);
  if (recent != null) r.facts.push(`For comparison, ${plural(recent, "post")} went out in the last 28 days, about ${r1(recent / 4)} a week.`);
  return r;
};

// ---------- account: profile, plan and usage, connections ----------
const STATUS_NAME: Record<string, string> = { connected: "Connected", needs_reconnect: "Needs reconnecting", disconnected: "Disconnected" };

export const account: Tool = async (ctx, _a, _range, period) => {
  const r = base(
    "account",
    "Your account",
    null,
    [
      { key: "where", label: "Account" },
      { key: "status", label: "Status" },
      { key: "since", label: "Connected" },
    ],
    ctx.scope ? "None of the accounts you work on are connected." : "No social accounts connected yet.",
    period,
  );
  const [user, accts] = await Promise.all([
    db.user.findUnique({ where: { id: ctx.ownerId }, select: { name: true, timezone: true, createdAt: true, postingGoal: true } }).catch(() => null),
    db.socialAccount
      .findMany({ where: { userId: ctx.ownerId, ...(ctx.scope ? { id: { in: ctx.scope } } : {}) }, orderBy: { createdAt: "asc" }, select: { id: true, platform: true, username: true, platformUserId: true, status: true, createdAt: true } })
      .catch(() => null),
  ]);
  const real = (accts ?? []).filter((x) => isPlatform(x.platform) && !isPracticeAccount(x));
  for (const x of real) r.rows.push({ id: x.id, cells: { where: `${pname(x.platform)} ${at(x.username)}`, status: STATUS_NAME[x.status] ?? cap(x.status), since: dayLabel(x.createdAt, ctx.tz) }, links: x.status !== "connected" ? [{ label: "Reconnect in Settings", href: "/settings" }] : undefined });
  r.found = r.returned = r.rows.length;
  if (!accts) {
    r.complete = false;
    r.notes.push({ level: "warn", text: "Your connections couldn't be read just now." });
  }
  const live = real.filter((x) => x.status === "connected").length;
  const needs = real.filter((x) => x.status === "needs_reconnect");
  r.cards = [{ label: "Connected accounts", value: String(live), hint: needs.length ? `${needs.length} need reconnecting` : undefined }];
  r.facts.push(`${plural(live, "account")} connected${needs.length ? `; ${needs.map((x) => `${pname(x.platform)} ${at(x.username)}`).join(", ")} ${needs.length === 1 ? "needs" : "need"} reconnecting` : ""}.`);
  if (user) {
    r.facts.push(`Workspace: ${user.name}, timezone ${user.timezone}, on Outlly since ${dayLabel(user.createdAt, ctx.tz)}.`);
    if (user.postingGoal) r.facts.push(`Posting goal: ${user.postingGoal} posts a week.`);
  }
  if (ctx.actorId) {
    r.notes.push({ level: "info", text: "The plan, usage and billing belong to the workspace owner, so I only show the accounts you work on." });
    return r;
  }
  const [usage, ai, help] = await Promise.all([postUsage(ctx.ownerId).catch(() => null), aiQuota(ctx.ownerId, "ai").catch(() => null), aiQuota(ctx.ownerId, "support").catch(() => null)]);
  if (usage) {
    const posts = usage.postLimit > 0 ? `${usage.used} of ${usage.postLimit}` : `${usage.used}, no limit`;
    r.cards.unshift({ label: "Plan", value: usage.planName, hint: usage.accessEndsAt ? `until ${dayLabel(usage.accessEndsAt, ctx.tz)}` : undefined });
    r.cards.push({ label: `Posts this ${usage.postPeriod}`, value: posts });
    r.cards.push({ label: "Analytics history", value: plural(analyticsWindow(usage, 100000).maxDays, "day") });
    r.facts.push(`Plan: ${usage.planName}. Posts this ${usage.postPeriod}: ${posts}.`);
  } else r.notes.push({ level: "warn", text: "Your plan couldn't be read just now." });
  const quota = (q: Awaited<ReturnType<typeof aiQuota>> | null, what: string) => {
    if (!q) return;
    const today = q.limit ? `${q.used} of ${q.limit} today` : `${q.used} today, no daily limit`;
    const month = q.monthLimit ? `, ${q.monthUsed} of ${q.monthLimit} this month` : "";
    r.facts.push(`${what}: ${today}${month}.`);
    return today;
  };
  const t = quota(ai, "AI writing help used");
  quota(help, "Pip and help-chat AI used");
  if (t) r.cards.push({ label: "AI help today", value: ai!.limit ? `${ai!.used} of ${ai!.limit}` : String(ai!.used) });
  r.downloads.push({ label: "Open Billing", href: "/billing" });
  return r;
};

// ---------- post_insight: "why did it do better?" ----------
const fromLive = (p: LivePost, platform: string): A.PostLike => ({
  title: p.title || "Untitled",
  platform,
  publishedAt: Date.parse(p.publishedAt),
  views: p.views,
  likes: p.likes,
  comments: p.comments,
  shares: p.shares ?? null,
  saves: p.saves ?? null,
  captionLen: p.captionLength,
  hashtagCount: p.hashtags,
  duration: p.duration ?? null,
  format: p.format,
});
const fromStat = (p: A.StatPost): A.PostLike => ({
  title: p.title,
  platform: p.platform,
  publishedAt: p.publishedAt,
  views: p.hasMetrics ? p.views : null,
  likes: p.likes,
  comments: p.comments,
  shares: p.shares,
  captionLen: p.captionLen,
  hashtagCount: p.hashtags.length,
  duration: p.duration,
  format: p.format,
});

export const postInsight: Tool = async (ctx, a, range, period) => {
  const r = base(
    "post_insight",
    "What set this post apart",
    null,
    [
      { key: "what", label: "What" },
      { key: "post", label: "This post" },
      { key: "usual", label: "Your usual" },
      { key: "note", label: "Difference" },
    ],
    "I couldn't find that post among your published posts with numbers.",
    period,
  );
  let target: A.PostLike | null = null;
  let peers: A.PostLike[] = [];
  let label = "";
  let focusKey: string | null = null;
  const focus = (a.focus ?? "").slice(0, 200);
  const live = /^([^:]+):(.+)$/.exec(focus);
  if (live) {
    // From a top_posts row: "accountId:platformPostId". The account must be one this person may see.
    const accts = await accountsInScope(ctx, null).catch(() => [] as Acct[]);
    const acct = accts.find((x) => x.id === live[1]);
    if (acct) {
      const boards = await dashboards(ctx, [acct], r);
      const d: PlatformDashboard | undefined = boards[0]?.d;
      const p = d?.posts.find((x) => x.id === live[2]);
      // A platform can send a date that doesn't parse; such posts can't be placed in time, so they're skipped.
      const dated = (x: LivePost) => Number.isFinite(Date.parse(x.publishedAt));
      if (d && p && !dated(p)) r.empty = "The platform didn't send a usable publish date for that post, so I can't compare it with your others.";
      else if (d && p) {
        target = fromLive(p, acct.platform);
        peers = d.posts.filter((x) => x !== p && dated(x)).map((x) => fromLive(x, acct.platform));
        label = `the last ${d.rangeDays} days on ${pname(acct.platform)} ${at(acct.username)}`;
        focusKey = focus;
        r.sources = ["Read live from the platform just now."];
      }
    }
  } else {
    const w = await windowFor(ctx, range, 90);
    let id = focus || null;
    if (id) {
      const own = await db.postTarget.findFirst({ where: { id, ...targetScope(ctx, null) }, select: { id: true, platform: true, publishedAt: true } }).catch(() => null);
      if (!own) {
        id = null;
        // Not theirs, or gone: say so rather than quietly answering about a different post.
        r.notes.push({ level: "warn", text: "I couldn't find that post among yours, so this looks at your best post in the period instead." });
      }
      else {
        const at = own.publishedAt?.getTime() ?? ctx.now.getTime();
        const from = Math.max(w.earliest, at - 90 * A.DAY_MS);
        const st = await loadStats(ctx, from, ctx.now.getTime() + 60000, own.platform);
        const mine = st.posts.find((x) => x.key === own.id);
        if (mine) {
          target = fromStat(mine);
          peers = st.posts.filter((x) => x.key !== own.id).map(fromStat);
          label = `your ${pname(own.platform)} posts from ${dayLabel(new Date(from), ctx.tz)} on`;
          focusKey = own.id;
          frame(r, ctx, { ...w, from: new Date(from) }, st, false);
          r.range = null;
        }
      }
    }
    if (!id && !target) {
      // No post named: explain the best one in the period.
      const st = await loadStats(ctx, w.from.getTime(), w.to.getTime(), plat(a.platform));
      frame(r, ctx, w, st, !!range);
      const best = st.posts.filter((x) => x.hasMetrics).sort((x, y) => y.views - x.views)[0];
      if (best) {
        target = fromStat(best);
        peers = st.posts.filter((x) => x.key !== best.key && x.platform === best.platform).map(fromStat);
        label = `your other ${pname(best.platform)} posts in ${w.label}`;
        focusKey = best.key;
        r.facts.push(`Your best post in ${w.label} was "${best.title}" on ${pname(best.platform)}.`);
      }
    }
  }
  if (!target) return r;
  const { factors, peers: n } = A.explainPost(target, peers, ctx.tz);
  r.title = `What set "${short(target.title, 40)}" apart`;
  r.focus = focusKey ? { postId: focusKey, title: target.title } : null;
  r.ask.focus = focusKey;
  if (!factors.length) {
    r.empty = n === 0 ? "I need at least 3 other posts on the same platform to compare it with, and there aren't any yet." : `I need at least 3 other posts on the same platform to compare it with; there ${n === 1 ? "is" : "are"} ${n}.`;
    r.facts.push(n === 0 ? "There are no other posts on the same platform to compare it with yet, so I can't say what set it apart." : `Only ${plural(n, "other post")} on the same platform to compare with, so I can't say what set it apart.`);
    return r;
  }
  r.rows = factors.map((f, i) => ({ id: `f${i}`, cells: { what: f.label, post: f.post, usual: f.usual, note: f.note } }));
  r.found = r.returned = r.rows.length;
  r.facts.push(`Compared with ${plural(n, "other post")} (${label}).`);
  for (const f of factors.slice(0, 5)) r.facts.push(`${f.label}: ${f.post} against your usual ${f.usual}${f.note ? `, ${f.note}` : ""}.`);
  r.facts.push(`These differences go with the result; they don't prove what caused it.`);
  r.notes.push({ level: "info", text: "Possible reasons, from comparing this post with your own others. Platforms don't say why they show one post more than another." });
  return r;
};

// ---------- forecast: labelled an estimate, with its assumptions ----------
export const forecast: Tool = async (ctx, a, _range, period) => {
  const platform = plat(a.platform);
  const t = ctx.message;
  const days = /\b(next|coming) week\b|\b7 days\b/i.test(t) ? 7 : /\b(next|coming) (3|three) months\b|\b90 days\b|\bquarter\b/i.test(t) ? 90 : 30;
  const w = await windowFor(ctx, null, 180);
  const r = base(
    "forecast",
    `Estimated views, next ${days} days`,
    w,
    [
      { key: "week", label: "Week of" },
      { key: "views", label: "Views", align: "end" },
      { key: "kind", label: "" },
    ],
    "",
    period,
  );
  const st = await loadStats(ctx, w.from.getTime(), w.to.getTime(), platform);
  frame(r, ctx, w, st, false);
  const weeks = A.toWeeks(A.bucketDays(st.snaps, uniquePosts(st.posts), syncedFrom(w, st), w.to.getTime(), ctx.tz));
  const full = weeks.filter((x) => x.days === 7);
  const f = A.forecastOf(weeks, days);
  if (!f) {
    r.empty = `I need at least 6 full weeks of synced numbers to estimate anything; there ${full.length === 1 ? "is" : "are"} ${full.length}. A guess from less would just be noise.`;
    r.facts.push(`Only ${plural(full.length, "full week")} of numbers; a forecast needs 6, so there is no forecast yet.`);
    return r;
  }
  // Only a card that really holds a projection is marked as an estimate.
  r.estimate = true;
  const recent = full.slice(-f.weeksUsed);
  const pace = r1(A.mean(recent.map((x) => x.posts)));
  r.cards = [
    { label: `Expected views, next ${days} days`, value: A.fmtInt(f.total), hint: `likely ${A.fmtInt(f.low)} to ${A.fmtInt(f.high)}`, kind: "estimate" },
    { label: "Views a day now", value: A.fmtInt(f.perDayNow), kind: "estimate" },
    { label: "Trend behind it", value: `${A.fmtSigned(f.weeklyPct)} a week`, hint: `from ${f.weeksUsed} full weeks` },
  ];
  const lastKey = full[full.length - 1].key;
  const future = f.chunks.map((_, i) => A.shortDay(new Date(Date.parse(`${lastKey}T00:00:00Z`) + 7 * (i + 1) * A.DAY_MS).toISOString().slice(0, 10)));
  // Table rows are the headline's own daily projection cut into 7-day pieces, so they add up to it exactly.
  const pieces = f.chunks.map((c) => Math.round(c.total));
  if (pieces.length) pieces[pieces.length - 1] += Math.round(f.total) - pieces.reduce((s, v) => s + v, 0);
  r.rows = [
    ...full.slice(-6).map((x) => ({ id: x.key, cells: { week: A.shortDay(x.key), views: A.fmtInt(x.views), kind: "Actual" } })),
    ...future.map((k, i) => ({ id: `f${i}`, cells: { week: f.chunks[i].days < 7 ? `${k} (${plural(f.chunks[i].days, "day")})` : k, views: A.fmtInt(pieces[i]), kind: "Estimate" } })),
  ];
  r.found = r.returned = r.rows.length;
  r.facts.push(`Estimate, not a promise: about ${A.fmtInt(f.total)} views in the next ${days} days, likely between ${A.fmtInt(f.low)} and ${A.fmtInt(f.high)}.`);
  r.facts.push(`It assumes the trend of your last ${f.weeksUsed} full weeks (about ${A.fmtSigned(f.weeklyPct)} a week) carries on, and that you keep posting about ${pace} a week.`);
  r.notes.push({ level: "info", text: "How this is worked out: a straight line through your weekly views a day, with a 90% range from how much your weeks already wander. One viral post, a long break or a platform change can break it." });
  r.notes.push({ level: "info", text: "Followers aren't forecast: Outlly doesn't keep a follower history yet, only today's count." });
  return r;
};

// ---------- report: the full analysis, and a plan made only from what it found ----------
export const report: Tool = async (ctx, a, range, period) => {
  const w = await windowFor(ctx, range, 90);
  const wr: DateRange = { from: w.from, to: w.to, label: w.label, tz: w.tz };
  const r = base(
    "report",
    "Your performance report",
    w,
    [
      { key: "section", label: "Area" },
      { key: "finding", label: "What the numbers say" },
    ],
    "",
    period,
  );
  // One wide read (this period and the one before) that every part below reuses.
  const prev = previousRange(wr, ctx.now);
  const st = await loadStats(ctx, Math.max(w.earliest, prev.from.getTime()), w.to.getTime(), plat(a.platform));
  frame(r, ctx, w, st, !!range);
  if (!st.posts.length && !st.snaps.length) return nothingYet(r, ctx);
  const parts: [string, Tool][] = [
    ["Overview", overview],
    ["Platforms", comparePlatforms],
    ["Trend", trend],
    ["Formats", formats],
    ["Timing", bestTimes],
    ["Consistency", consistency],
    ["Reach vs interaction", segments],
  ];
  // Same ctx, so every part reuses the wide read above through the request memo.
  const got = await Promise.all(parts.map(([, f]) => f(ctx, { ...a, limit: 5 }, wr, period).catch(() => null)));
  const strategy: string[] = [];
  got.forEach((x, i) => {
    const name = parts[i][0];
    if (!x) {
      r.complete = false;
      r.notes.push({ level: "warn", text: `The ${name.toLowerCase()} part couldn't be worked out just now.` });
      return;
    }
    if (!x.complete) r.complete = false;
    for (const n of x.notes) if (n.level === "warn" && !r.notes.some((y) => y.text === n.text)) r.notes.push(n);
    const fs = x.facts.slice(0, name === "Overview" ? 3 : 2);
    fs.forEach((f, j) => r.rows.push({ id: `${name}:${j}`, cells: { section: j ? "" : name, finding: f } }));
    r.facts.push(...fs);
    for (const s of x.sources ?? []) if (!(r.sources ?? []).includes(s)) r.sources = [...(r.sources ?? []), s];
  });
  const [ov, , tr, , bt, cs, sg] = got;
  r.cards = [...(ov?.cards ?? []).slice(0, 3), ...(tr?.cards ?? []).slice(0, 1), ...(cs?.cards ?? []).slice(0, 1)];
  // The plan: each line comes from a number above, worked out again here from the same rows.
  const rows = A.relative(st.posts.filter((p) => p.publishedAt >= w.from.getTime()));
  const fmt = A.segment(rows, (p) => p.format).filter((x) => x.enough);
  if (fmt.length >= 2 && fmt[0].rel >= 1.2) strategy.push(`Make more ${fmt[0].label.toLowerCase()}: they typically get ${A.fmtX(fmt[0].rel)} your usual views (${plural(fmt[0].n, "post")}).`);
  const times = A.bestTimesOf(rows, ctx.tz);
  if (times.enough) {
    const d = times.days.find((g) => g.enough && g.n >= 3);
    if (d && d.rel >= 1.2) strategy.push(`Put your strongest posts out on ${d.label}s: posts then typically got ${A.fmtX(d.rel)} your usual views (${plural(d.n, "post")}; still worth testing).`);
  }
  const ups = uniquePosts(st.posts.filter((p) => p.publishedAt >= w.from.getTime()));
  const c = A.consistencyOf(A.toWeeks(A.bucketDays(st.snaps, ups, w.from.getTime(), w.to.getTime(), ctx.tz)), ups.map((p) => p.publishedAt), ctx.now.getTime());
  if (c.verdict === "Irregular" || c.verdict === "Fairly consistent") strategy.push(`Post every week: you posted in ${c.activeWeeks} of ${c.weeks} weeks, about ${r1(c.avg)} a week. Aim for at least ${Math.max(1, Math.ceil(c.avg))} every week.`);
  const q = A.quadrants(rows);
  if (q && q.highReachLowInteraction.length >= 2) strategy.push(`${plural(q.highReachLowInteraction.length, "post")} reached many people but few interacted: end posts like those with a question or a reason to comment.`);
  const weeks = A.toWeeks(A.bucketDays(st.snaps, ups, syncedFrom(w, st), w.to.getTime(), ctx.tz)).filter((x) => x.days === 7);
  const t = A.trendOf(weeks.map((x) => x.perDay));
  if (t.enough && t.significant && t.direction === "down") strategy.push(`Views a day are falling about ${A.fmtSigned(t.weeklyPct)} a week: compare your recent posts with your best kind above before changing everything.`);
  if (!strategy.length) strategy.push("Nothing stands out strongly enough yet to change course. Keep posting and ask again after a few more weeks of numbers.");
  strategy.slice(0, 5).forEach((s, i) => {
    r.rows.push({ id: `plan:${i}`, cells: { section: i ? "" : "Next month", finding: s } });
    r.facts.push(`Plan: ${s}`);
  });
  r.found = r.returned = r.rows.length;
  r.focus = sg?.focus ?? ov?.focus ?? null;
  void bt;
  r.notes.push({ level: "info", text: `Everything here comes from your own posts and numbers for ${w.label}. Links between things are ${LINKED.toLowerCase().replace(".", "")}.` });
  return r;
};

// ---------- proactive: at most three things worth saying when Pip opens ----------
export async function pipInsights(ctx: PipCtx): Promise<A.Insight[]> {
  const w = await windowFor(ctx, null, 90);
  const now = ctx.now.getTime();
  const [st, nocap] = await Promise.all([
    loadStats(ctx, w.from.getTime(), w.to.getTime(), null),
    db.post
      .findMany({
        where: { userId: ctx.ownerId, status: "scheduled", scheduledAt: { gte: ctx.now, lt: new Date(now + 7 * A.DAY_MS) }, ...(ctx.scope ? { targets: { some: { practice: false, socialAccountId: { in: ctx.scope } } } } : {}) },
        take: 200,
        select: { targets: { where: { practice: false, ...(ctx.scope ? { socialAccountId: { in: ctx.scope } } : {}) }, select: { caption: true, description: true } } },
      })
      .catch(() => []),
  ]);
  if (st.failed) return [];
  const ups = uniquePosts(st.posts);
  const weeks = A.toWeeks(A.bucketDays(st.snaps, ups, syncedFrom(w, st), w.to.getTime(), ctx.tz));
  const in14 = ups.filter((p) => p.publishedAt >= now - 14 * A.DAY_MS).length;
  const prev28 = ups.filter((p) => p.publishedAt < now - 14 * A.DAY_MS && p.publishedAt >= now - 42 * A.DAY_MS).length;
  return A.insightsFrom({
    weeks,
    postsLast14: in14,
    postsPrev28: prev28,
    scheduledNoCaption: nocap.filter((p) => p.targets.some(emptyCaption)).length,
    formats: A.segment(A.relative(st.posts), (p) => p.format),
  });
}

export const ANALYTICS: Record<Extract<PipTool, "overview" | "compare_platforms" | "trend" | "consistency" | "best_times" | "formats" | "segments" | "schedule" | "account" | "post_insight" | "forecast" | "report">, Tool> = {
  overview,
  compare_platforms: comparePlatforms,
  trend,
  consistency,
  best_times: bestTimes,
  formats,
  segments,
  schedule,
  account,
  post_insight: postInsight,
  forecast,
  report,
};

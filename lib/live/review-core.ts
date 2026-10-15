import type { Platform } from "../domain";
import type { Headline, LivePost } from "./types";

/**
 * Profile review, the pure half. The score is maths over the creator's own numbers, never a model's
 * opinion, so it moves only when the numbers do. Gemini (lib/live/review.ts) only writes the words.
 */

export type PillarKey = "reach" | "engagement" | "consistency" | "growth" | "content";

export interface PlatformFacts {
  platform: Platform;
  handle: string | null;
  followers: number | null;
  followersDelta: number | null;
  /** Views in the platform's own window (rangeDays). */
  views: number | null;
  viewsDelta: number | null;
  rangeDays: number;
  /** (likes + comments + shares) / views, in percent, over the recent posts. */
  engagementRate: number | null;
  postsInWindow: number;
  avgViews: number | null;
  /** Share (0-100) of recent posts reaching at least half the average views. */
  hitRate: number | null;
  bestHour: string | null;
  bestPost: { title: string; views: number } | null;
  weakestPost: { title: string; views: number } | null;
  avgCaption: number | null;
  avgHashtags: number | null;
  /** Average watched share of the video, 0-100, when the platform reports watch time. */
  retention: number | null;
  sample: number;
}

export interface StoredFacts {
  views: number;
  prevViews: number;
  engagement: number;
  prevEngagement: number;
  likes: number;
  comments: number;
  shares: number;
  bestDay: string | null;
  top: { title: string; platform: Platform; views: number } | null;
  hasData: boolean;
}

export interface ReviewFacts {
  name: string;
  goalPerWeek: number;
  publishedLast30: number;
  publishedPrev30: number;
  platforms: PlatformFacts[];
  stored: StoredFacts;
}

export interface Pillar {
  key: PillarKey;
  label: string;
  score: number;
  /** One line with the number behind the score. */
  note: string;
}

export interface ReviewStat {
  key: "followers" | "views" | "engagement" | "posts" | "avgViews" | "retention";
  label: string;
  value: number;
  delta: number | null;
  format: "int" | "pct" | "rate";
  hint: string;
}

export interface ReviewAction {
  title: string;
  body: string;
  impact: "high" | "medium" | "low";
  evidence?: string;
  href?: string;
}

export interface ProfileReview {
  source: "ai" | "rules";
  generatedAt: string;
  score: number | null;
  grade: string;
  headline: string;
  summary: string;
  pillars: Pillar[];
  stats: ReviewStat[];
  strengths: string[];
  weaknesses: string[];
  audience: string | null;
  contentMix: string | null;
  bestTimes: string | null;
  actions: ReviewAction[];
  perPlatform: { platform: Platform; verdict: string; score: number | null }[];
  platforms: Platform[];
  /** How many posts the numbers came from, so the review never reads as a guess. */
  sample: number;
  empty: boolean;
}

const NAME: Record<Platform, string> = { instagram: "Instagram", youtube: "YouTube", x: "X", tiktok: "TikTok", threads: "Threads", facebook: "Facebook", linkedin: "LinkedIn" };
const FOLLOWER_KEY: Partial<Record<Platform, string>> = { instagram: "followers", youtube: "subscribers", x: "followers" };
const DAY = 864e5;

export const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
export const fmtN = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
const pct = (n: number) => `${Math.round(Math.abs(n))}%`;
const trim = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Turns one live dashboard into the handful of numbers the review reasons about. */
export function platformFacts(input: {
  platform: Platform;
  handle?: string | null;
  headline: Headline[];
  posts: LivePost[];
  hours?: { label: string; value: number }[];
  rangeDays: number;
  now?: Date;
}): PlatformFacts {
  const { platform, headline, posts } = input;
  const now = (input.now ?? new Date()).getTime();
  const h = (k: string) => headline.find((x) => x.key === k);
  const fol = h(FOLLOWER_KEY[platform] ?? "followers");
  const vw = h("views");
  const recent = posts.slice(0, 24);
  const withViews = recent.filter((p) => typeof p.views === "number" && (p.views as number) >= 0);
  const views = withViews.map((p) => p.views as number);
  const totalViews = views.reduce((a, b) => a + b, 0);
  const inter = withViews.reduce((a, p) => a + (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0), 0);
  const avg = views.length ? totalViews / views.length : null;
  const sorted = [...withViews].sort((a, b) => (b.views as number) - (a.views as number));
  const watch = recent.filter((p) => p.avgWatch && p.duration && p.duration > 0);
  const best = input.hours?.length ? [...input.hours].sort((a, b) => b.value - a.value)[0] : null;
  const capLen = recent.map((p) => p.captionLength).filter((n) => typeof n === "number");
  return {
    platform,
    handle: input.handle ?? null,
    followers: fol?.value ?? null,
    followersDelta: fol?.delta ?? null,
    views: vw?.value ?? (views.length ? totalViews : null),
    viewsDelta: vw?.delta ?? null,
    rangeDays: input.rangeDays,
    engagementRate: totalViews > 0 ? round1((inter / totalViews) * 100) : null,
    postsInWindow: posts.filter((p) => now - new Date(p.publishedAt).getTime() <= input.rangeDays * DAY).length,
    avgViews: avg === null ? null : Math.round(avg),
    hitRate: views.length >= 4 && avg ? Math.round((views.filter((v) => v >= avg / 2).length / views.length) * 100) : null,
    bestHour: best && best.value > 0 ? best.label : null,
    bestPost: sorted[0] ? { title: trim(sorted[0].title || "Untitled"), views: sorted[0].views as number } : null,
    weakestPost: sorted.length >= 3 ? { title: trim(sorted[sorted.length - 1].title || "Untitled"), views: sorted[sorted.length - 1].views as number } : null,
    avgCaption: capLen.length ? Math.round(capLen.reduce((a, b) => a + b, 0) / capLen.length) : null,
    avgHashtags: recent.length ? round1(recent.reduce((a, p) => a + (p.hashtags ?? 0), 0) / recent.length) : null,
    retention: watch.length >= 2 ? Math.round(clamp((watch.reduce((a, p) => a + (p.avgWatch as number) / (p.duration as number), 0) / watch.length) * 100)) : null,
    sample: recent.length,
  };
}

/** Sum of values with per-item percent changes, back-solved into one combined percent change. */
export function combinedDelta(items: { value: number | null; delta: number | null }[]): number | null {
  let now = 0;
  let before = 0;
  for (const i of items) {
    if (i.value === null || i.delta === null || i.delta <= -100) continue;
    now += i.value;
    before += i.value / (1 + i.delta / 100);
  }
  return before > 0 ? round1((now / before - 1) * 100) : null;
}

const WEIGHTS: Record<PillarKey, number> = { engagement: 0.25, reach: 0.25, consistency: 0.2, growth: 0.15, content: 0.15 };

export function gradeFor(score: number | null) {
  if (score === null) return "Not enough data yet";
  if (score >= 80) return "Thriving";
  if (score >= 65) return "Strong";
  if (score >= 50) return "Growing";
  if (score >= 35) return "Finding its feet";
  return "Just getting started";
}

/** Combined numbers across platforms, preferring live platform numbers over what Outlly stored. */
export function combine(f: ReviewFacts) {
  const live = f.platforms;
  const followers = live.some((p) => p.followers !== null) ? live.reduce((a, p) => a + (p.followers ?? 0), 0) : null;
  const liveViews = live.some((p) => p.views !== null) ? live.reduce((a, p) => a + (p.views ?? 0), 0) : null;
  const views = liveViews ?? (f.stored.hasData ? f.stored.views : null);
  const storedDelta = f.stored.prevViews > 0 ? round1(((f.stored.views - f.stored.prevViews) / f.stored.prevViews) * 100) : null;
  const viewsDelta = liveViews !== null ? combinedDelta(live.map((p) => ({ value: p.views, delta: p.viewsDelta }))) : storedDelta;
  const rates = live.filter((p) => p.engagementRate !== null && (p.avgViews ?? 0) > 0);
  const engagement = rates.length
    ? round1(rates.reduce((a, p) => a + (p.engagementRate as number) * (p.avgViews as number), 0) / rates.reduce((a, p) => a + (p.avgViews as number), 0))
    : f.stored.hasData && f.stored.views > 0
      ? round1(f.stored.engagement)
      : null;
  const engagementDelta = !rates.length && f.stored.prevEngagement > 0 ? round1(((f.stored.engagement - f.stored.prevEngagement) / f.stored.prevEngagement) * 100) : null;
  const avgViewsList = live.filter((p) => p.avgViews !== null);
  const avgViews = avgViewsList.length ? Math.round(avgViewsList.reduce((a, p) => a + (p.avgViews as number), 0) / avgViewsList.length) : null;
  // Cross-posting puts one video on three platforms: count the busiest platform, not the sum.
  const livePerWeek = live.length ? Math.max(...live.map((p) => (p.postsInWindow / Math.max(7, p.rangeDays)) * 7)) : 0;
  const perWeek = round1(Math.max(livePerWeek, (f.publishedLast30 / 30) * 7));
  const hits = live.filter((p) => p.hitRate !== null);
  const hitRate = hits.length ? Math.round(hits.reduce((a, p) => a + (p.hitRate as number), 0) / hits.length) : null;
  const ret = live.filter((p) => p.retention !== null);
  const retention = ret.length ? Math.round(ret.reduce((a, p) => a + (p.retention as number), 0) / ret.length) : null;
  return {
    followers,
    followersDelta: combinedDelta(live.map((p) => ({ value: p.followers, delta: p.followersDelta }))),
    views,
    viewsDelta,
    engagement,
    engagementDelta,
    avgViews,
    perWeek,
    hitRate,
    retention,
  };
}

/** Five pillars, each 0-100 from a stated number. A pillar without data is left out, not guessed. */
export function pillars(f: ReviewFacts): Pillar[] {
  const c = combine(f);
  const goal = f.goalPerWeek > 0 ? f.goalPerWeek : 3;
  const out: Pillar[] = [];
  if (c.avgViews !== null && c.avgViews > 0) {
    const ratio = c.followers ? c.avgViews / c.followers : null;
    const score = ratio !== null ? 100 * (1 - Math.exp(-ratio / 0.5)) : (Math.log10(c.avgViews) - 1) * 25;
    out.push({ key: "reach", label: "Reach", score: Math.round(clamp(score)), note: ratio !== null ? `${fmtN(c.avgViews)} average views per post against ${fmtN(c.followers as number)} followers.` : `${fmtN(c.avgViews)} average views per post.` });
  } else if (c.views !== null && f.stored.hasData) {
    const perPost = f.publishedLast30 ? f.stored.views / f.publishedLast30 : f.stored.views;
    out.push({ key: "reach", label: "Reach", score: Math.round(clamp((Math.log10(Math.max(1, perPost)) - 1) * 25)), note: `${fmtN(perPost)} views per post published through Outlly.` });
  }
  if (c.engagement !== null) out.push({ key: "engagement", label: "Engagement", score: Math.round(clamp(100 * (1 - Math.exp(-c.engagement / 3)))), note: `${c.engagement}% of viewers liked, commented or shared.` });
  if (f.platforms.length || f.publishedLast30 || f.publishedPrev30) out.push({ key: "consistency", label: "Consistency", score: Math.round(clamp((c.perWeek / goal) * 100)), note: `${c.perWeek} posts a week against a goal of ${goal}.` });
  if (c.viewsDelta !== null) out.push({ key: "growth", label: "Growth", score: Math.round(clamp(50 + c.viewsDelta)), note: `Views ${c.viewsDelta >= 0 ? "up" : "down"} ${pct(c.viewsDelta)} on the period before.` });
  if (c.hitRate !== null) out.push({ key: "content", label: "Hit rate", score: c.hitRate, note: `${c.hitRate}% of recent posts reached at least half your average views.` });
  return out;
}

export function overall(ps: Pillar[]): number | null {
  if (ps.length < 2) return null;
  const w = ps.reduce((a, p) => a + WEIGHTS[p.key], 0);
  return Math.round(ps.reduce((a, p) => a + p.score * WEIGHTS[p.key], 0) / w);
}

export function stats(f: ReviewFacts): ReviewStat[] {
  const c = combine(f);
  const liveDays = f.platforms[0]?.rangeDays ?? 30;
  const days = f.platforms.length ? liveDays : 30;
  const out: ReviewStat[] = [];
  if (c.followers !== null) out.push({ key: "followers", label: "Followers", value: c.followers, delta: c.followersDelta, format: "int", hint: `Across ${f.platforms.map((p) => NAME[p.platform]).join(", ")}` });
  if (c.views !== null) out.push({ key: "views", label: "Views", value: c.views, delta: c.viewsDelta, format: "int", hint: `Last ${days} days` });
  if (c.engagement !== null) out.push({ key: "engagement", label: "Engagement rate", value: c.engagement, delta: c.engagementDelta, format: "pct", hint: "Likes, comments and shares per view" });
  out.push({ key: "posts", label: "Posts a week", value: c.perWeek, delta: null, format: "rate", hint: `Goal: ${f.goalPerWeek > 0 ? f.goalPerWeek : 3}` });
  if (c.avgViews !== null) out.push({ key: "avgViews", label: "Average views", value: c.avgViews, delta: null, format: "int", hint: "Per recent post" });
  if (c.retention !== null) out.push({ key: "retention", label: "Watched", value: c.retention, delta: null, format: "pct", hint: "Average share of each video watched" });
  return out;
}

function platformScore(p: PlatformFacts, goal: number): number | null {
  return overall(pillars({ name: "", goalPerWeek: goal, publishedLast30: 0, publishedPrev30: 0, platforms: [p], stored: { views: 0, prevViews: 0, engagement: 0, prevEngagement: 0, likes: 0, comments: 0, shares: 0, bestDay: null, top: null, hasData: false } }));
}

const ACTIONS: Record<PillarKey, (f: ReviewFacts, c: ReturnType<typeof combine>) => ReviewAction> = {
  consistency: (f, c) => {
    const goal = f.goalPerWeek > 0 ? f.goalPerWeek : 3;
    return { title: `Get to ${goal} posts a week`, body: `You are at ${c.perWeek} a week. Batch two ideas on one day and schedule them from Create, so a busy week does not leave a gap.`, impact: "high", evidence: `${c.perWeek} posts a week, goal ${goal}`, href: "/create" };
  },
  engagement: (_f, c) => ({ title: "End every caption with one question", body: "Ask something people can answer in two words. Reply to the first replies within the hour so the thread keeps going.", impact: "high", evidence: `${c.engagement ?? 0}% engagement rate`, href: "/inbox" }),
  growth: (f) => {
    const best = f.platforms.map((p) => p.bestPost).filter(Boolean).sort((a, b) => b!.views - a!.views)[0] ?? (f.stored.top ? { title: f.stored.top.title, views: f.stored.top.views } : null);
    return { title: "Make a part two of your best post", body: best ? `"${best.title}" reached ${fmtN(best.views)}. Make a follow-up with the same angle and a new first line.` : "Take the angle of your best recent post and make a follow-up with a new first line.", impact: "medium", evidence: best ? `${fmtN(best.views)} views on your top post` : undefined, href: "/create" };
  },
  reach: (_f, c) => ({ title: "Put the payoff in the first second", body: "Open on the result, then explain how you got there. A clear first line stops the scroll before people decide to move on.", impact: "medium", evidence: c.avgViews !== null ? `${fmtN(c.avgViews)} average views per post` : undefined, href: "/create" }),
  content: (_f, c) => ({ title: "Recycle what already landed", body: "Repost a top performer from six to eight weeks ago with a fresh hook. Proven ideas lift the posts around them.", impact: "medium", evidence: c.hitRate !== null ? `${c.hitRate}% hit rate` : undefined, href: "/content" }),
};

/** The no-model review: every sentence is built from the numbers, so it is safe to show without Gemini. */
export function rulesReview(f: ReviewFacts, now = new Date()): ProfileReview {
  const ps = pillars(f);
  const score = overall(ps);
  const c = combine(f);
  const sample = f.platforms.reduce((a, p) => a + p.sample, 0) + f.publishedLast30;
  const empty = !ps.length || (c.views === null && !f.platforms.length);
  const sortedP = [...ps].sort((a, b) => b.score - a.score);
  const top = sortedP[0];
  const low = sortedP.length > 1 ? sortedP[sortedP.length - 1] : null;
  const bestHour = f.platforms.find((p) => p.bestHour)?.bestHour ?? null;
  const bestTimes = f.stored.bestDay && bestHour ? `${f.stored.bestDay}s around ${bestHour}` : f.stored.bestDay ? `${f.stored.bestDay}s` : bestHour ? `Around ${bestHour}` : null;
  const headline = empty
    ? "Publish a few posts and the review fills in."
    : top && low && top.key !== low.key
      ? `${top.label} is carrying you. ${low.label} is the next lever.`
      : `${top.label} is where you stand out.`;
  const summary = empty
    ? "Connect Instagram, YouTube or X, or publish through Outlly, and this page scores your reach, engagement, consistency and growth from your real numbers."
    : [
        c.views !== null ? `You pulled ${fmtN(c.views)} views${c.viewsDelta !== null ? `, ${c.viewsDelta >= 0 ? "up" : "down"} ${pct(c.viewsDelta)} on the period before` : ""}.` : "",
        c.engagement !== null ? `${c.engagement}% of viewers engaged.` : "",
        `You post ${c.perWeek} times a week.`,
      ].filter(Boolean).join(" ");
  const actions = [...ps].sort((a, b) => a.score - b.score).slice(0, 3).map((p) => ACTIONS[p.key](f, c));
  if (bestTimes && actions.length < 4) actions.push({ title: `Post on ${bestTimes.replace(/^Around /, "")}`, body: "That is when your numbers say your audience shows up. Schedule the next post for that slot and compare.", impact: "low", evidence: "Your best day and hour from the last month", href: "/calendar" });
  const goal = f.goalPerWeek > 0 ? f.goalPerWeek : 3;
  return {
    source: "rules",
    generatedAt: now.toISOString(),
    score,
    grade: gradeFor(score),
    headline,
    summary,
    pillars: ps,
    stats: stats(f),
    strengths: ps.filter((p) => p.score >= 60).map((p) => p.note),
    weaknesses: ps.filter((p) => p.score < 45).map((p) => p.note),
    audience: null,
    contentMix: f.platforms.some((p) => p.avgCaption !== null)
      ? f.platforms.filter((p) => p.avgCaption !== null).map((p) => `${NAME[p.platform]}: captions average ${p.avgCaption} characters with ${p.avgHashtags ?? 0} hashtags.`).join(" ")
      : null,
    bestTimes,
    actions,
    perPlatform: f.platforms.map((p) => ({
      platform: p.platform,
      score: platformScore(p, goal),
      verdict: [
        p.avgViews !== null ? `${fmtN(p.avgViews)} average views` : null,
        p.engagementRate !== null ? `${p.engagementRate}% engagement` : null,
        p.followers !== null ? `${fmtN(p.followers)} followers${p.followersDelta ? ` (${p.followersDelta >= 0 ? "+" : "-"}${pct(p.followersDelta)})` : ""}` : null,
      ].filter(Boolean).join(", ") || "Not enough posts to judge yet.",
    })),
    platforms: f.platforms.map((p) => p.platform),
    sample,
    empty,
  };
}

/* -------------------------------------------------------------------- */
/* Gemini output: checked and cleaned before it reaches the page          */
/* -------------------------------------------------------------------- */

export interface AiReviewOut {
  headline?: string;
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  audience?: string;
  contentMix?: string;
  bestTimes?: string;
  actions?: { title?: string; body?: string; impact?: string; evidence?: string }[];
  perPlatform?: { platform?: string; verdict?: string }[];
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
/** House style: no emoji, no em or en dashes, no runaway length. */
export function clean(s: unknown, max = 400): string {
  if (typeof s !== "string") return "";
  const t = s.replace(EMOJI, "").replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t;
}

const HREF: [RegExp, string][] = [
  [/schedul|calendar|time|slot/i, "/calendar"],
  [/repl|comment|inbox|question/i, "/inbox"],
  [/recycl|repost|old post|archive/i, "/content"],
];

/** Lays the model's words over the maths. Anything missing or malformed falls back to the rules text. */
export function mergeAi(base: ProfileReview, ai: AiReviewOut | null, now = new Date()): ProfileReview {
  if (!ai) return base;
  const list = (xs: unknown, n: number, max: number) => (Array.isArray(xs) ? xs.map((x) => clean(x, max)).filter(Boolean).slice(0, n) : []);
  const actions = Array.isArray(ai.actions)
    ? ai.actions
        .map((a) => ({ title: clean(a?.title, 70), body: clean(a?.body, 260), evidence: clean(a?.evidence, 140) || undefined, impact: (["high", "medium", "low"].includes(String(a?.impact)) ? a.impact : "medium") as ReviewAction["impact"] }))
        .filter((a) => a.title && a.body)
        .slice(0, 5)
        .map((a) => ({ ...a, href: HREF.find(([re]) => re.test(`${a.title} ${a.body}`))?.[1] ?? "/create" }))
    : [];
  const verdicts = new Map((Array.isArray(ai.perPlatform) ? ai.perPlatform : []).map((p) => [String(p?.platform ?? "").toLowerCase(), clean(p?.verdict, 220)]));
  const strengths = list(ai.strengths, 4, 200);
  const weaknesses = list(ai.weaknesses, 4, 200);
  return {
    ...base,
    source: "ai",
    generatedAt: now.toISOString(),
    headline: clean(ai.headline, 110) || base.headline,
    summary: clean(ai.summary, 600) || base.summary,
    strengths: strengths.length ? strengths : base.strengths,
    weaknesses: weaknesses.length ? weaknesses : base.weaknesses,
    audience: clean(ai.audience, 300) || base.audience,
    contentMix: clean(ai.contentMix, 300) || base.contentMix,
    bestTimes: clean(ai.bestTimes, 160) || base.bestTimes,
    actions: actions.length ? actions : base.actions,
    perPlatform: base.perPlatform.map((p) => ({ ...p, verdict: verdicts.get(p.platform) || p.verdict })),
  };
}

import "server-only";
import { createHash } from "node:crypto";
import { db } from "../db";
import { env } from "../env";
import { CORE_PLATFORMS, type Platform } from "../domain";
import { gemini } from "../ai/creative";
import { getAnalytics } from "../analytics";
import { connectedPlatforms } from "./connected";
import { platformDashboard } from "./index";
import { combine, mergeAi, platformFacts, rulesReview, type AiReviewOut, type ProfileReview, type ReviewFacts } from "./review-core";

export type { ProfileReview } from "./review-core";

/** A deep review is kept for a day: the numbers it reads move slowly, and every run costs a model call. */
const AI_TTL_MS = 24 * 60 * 60_000;
/** Regenerating is throttled per creator, on top of the route's rate limit. */
const REGEN_GAP_MS = 2 * 60_000;
const key = (userId: string) => `review:v1:${userId}`;

export function aiAvailable() {
  return !!env.GEMINI_API_KEY;
}

/** Everything the review reasons about, gathered from the live dashboards (cached 90 s) and stored metrics. */
export async function collectFacts(userId: string): Promise<ReviewFacts> {
  const since30 = new Date(Date.now() - 30 * 864e5);
  const since60 = new Date(Date.now() - 60 * 864e5);
  const [user, connected, a, last30, prev30] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { name: true, postingGoal: true } }),
    connectedPlatforms(userId),
    getAnalytics(userId, 30),
    db.post.count({ where: { userId, status: { in: ["published", "partial"] }, publishedAt: { gte: since30 } } }),
    db.post.count({ where: { userId, status: { in: ["published", "partial"] }, publishedAt: { gte: since60, lt: since30 } } }),
  ]);
  const live = CORE_PLATFORMS.filter((p) => connected[p]);
  const dashes = await Promise.all(live.map((p) => platformDashboard(userId, p).catch(() => null)));
  const platforms = dashes
    .filter((d): d is NonNullable<typeof d> => !!d && d.status === "ok")
    .map((d) => platformFacts({ platform: d.platform, handle: d.profile?.handle ?? null, headline: d.headline, posts: d.posts, hours: d.hours, rangeDays: d.rangeDays }));
  return {
    name: user?.name?.split(" ")[0] ?? "",
    goalPerWeek: user?.postingGoal ?? 3,
    publishedLast30: last30,
    publishedPrev30: prev30,
    platforms,
    stored: {
      views: a.totals.views,
      prevViews: a.previous.views,
      engagement: a.totals.engagement,
      prevEngagement: a.previous.engagement,
      likes: a.totals.likes,
      comments: a.totals.comments,
      shares: a.totals.shares,
      bestDay: a.bestDay,
      top: a.top ? { title: a.top.title, platform: a.top.platform, views: a.top.views } : null,
      hasData: a.hasData,
    },
  };
}

type Saved = { at: number; sig: string; review: ProfileReview };

async function readSaved(userId: string): Promise<Saved | null> {
  const row = await db.setting.findUnique({ where: { key: key(userId) } }).catch(() => null);
  if (!row) return null;
  try {
    const s = JSON.parse(row.value) as Saved;
    return s?.review ? s : null;
  } catch {
    return null;
  }
}

/** Rounded so a few extra views between refreshes don't count as "new numbers". */
function signature(f: ReviewFacts) {
  const r = (n: number | null) => (n === null ? null : Number(n.toPrecision(2)));
  const shape = { p: f.platforms.map((p) => [p.platform, r(p.followers), r(p.views), p.postsInWindow]), s: [r(f.stored.views), f.publishedLast30], g: f.goalPerWeek };
  return createHash("sha256").update(JSON.stringify(shape)).digest("base64url").slice(0, 16);
}

/**
 * The review shown on load: the saved Gemini review while it is fresh, otherwise the rules review,
 * worked out on the spot. `stale` says the numbers moved since the saved one was written.
 */
export async function currentReview(userId: string): Promise<{ review: ProfileReview; ai: boolean; stale: boolean; nextRegenAt: string | null }> {
  const [facts, saved] = await Promise.all([collectFacts(userId), readSaved(userId)]);
  const rules = rulesReview(facts);
  if (saved && Date.now() - saved.at < AI_TTL_MS && !rules.empty) {
    // Words from the saved run, today's maths: the tiles and the score never lag the numbers.
    const review = { ...saved.review, score: rules.score, grade: rules.grade, pillars: rules.pillars, stats: rules.stats, sample: rules.sample };
    return { review, ai: aiAvailable(), stale: saved.sig !== signature(facts), nextRegenAt: regenAt(saved) };
  }
  return { review: rules, ai: aiAvailable(), stale: false, nextRegenAt: saved ? regenAt(saved) : null };
}

const regenAt = (s: Saved) => (Date.now() - s.at < REGEN_GAP_MS ? new Date(s.at + REGEN_GAP_MS).toISOString() : null);

export class ReviewError extends Error {
  constructor(public code: "NO_AI" | "TOO_SOON" | "NO_DATA" | "AI_DOWN", message: string, public retryAt?: string) {
    super(message);
  }
}

/** Runs the Gemini deep review now and saves it. Failures are never saved, so the next try starts clean. */
export async function deepReview(userId: string): Promise<ProfileReview> {
  if (!aiAvailable()) throw new ReviewError("NO_AI", "The Gemini deep review is not switched on for this workspace yet. Your score and tiles still come from your real numbers.");
  const saved = await readSaved(userId);
  if (saved && Date.now() - saved.at < REGEN_GAP_MS) throw new ReviewError("TOO_SOON", "You just ran a review. Give it a couple of minutes before the next one.", regenAt(saved) ?? undefined);
  const facts = await collectFacts(userId);
  const base = rulesReview(facts);
  if (base.empty) throw new ReviewError("NO_DATA", "There is not enough to review yet. Connect an account or publish a few posts first.");
  const c = combine(facts);
  const brief = {
    creator: facts.name || "the creator",
    goalPostsPerWeek: facts.goalPerWeek,
    score: base.score,
    pillars: base.pillars.map((p) => ({ pillar: p.label, score: p.score, basis: p.note })),
    combined: c,
    platforms: facts.platforms,
    publishedThroughOutlly: { last30Days: facts.publishedLast30, previous30Days: facts.publishedPrev30, views: facts.stored.views, previousViews: facts.stored.prevViews, engagementPct: Number(facts.stored.engagement.toFixed(2)), bestDay: facts.stored.bestDay, topPost: facts.stored.top },
  };
  const ai = await gemini<AiReviewOut>(
    "You are a frank, kind growth coach for short-form video creators. Use ONLY the numbers in the JSON you are given. Never invent a statistic, benchmark, competitor, study or audience detail that the numbers do not show. Quote real numbers when you make a point. Plain words, short sentences, no emoji, no hype, no em dashes. Speak to the creator as you.",
    `Here is a creator's profile as JSON:\n${JSON.stringify(brief)}\n\nWrite an in-depth review. Reply as JSON with exactly these keys:\n{"headline": max 12 words, the one thing that matters most,\n"summary": 3 to 4 sentences on where they stand and why,\n"strengths": 2 to 4 short sentences, each citing a number,\n"weaknesses": 2 to 4 short sentences, each citing a number,\n"audience": 1 to 2 sentences on what the numbers say about who watches and when (say so plainly if the data cannot tell),\n"contentMix": 1 to 2 sentences on formats, caption length and hashtags,\n"bestTimes": one short phrase, or "" if the data has none,\n"actions": 3 to 5 items {"title": max 8 words, "body": max 40 words of what to do this week, "impact": "high"|"medium"|"low", "evidence": the numbers behind it},\n"perPlatform": one {"platform": the platform id as given, "verdict": max 30 words} per platform in the data}`,
    { temperature: 0.5, timeoutMs: 25_000 },
  ).catch(() => null);
  if (!ai) throw new ReviewError("AI_DOWN", "Gemini didn't answer just now. Try again in a minute.");
  const review = mergeAi(base, ai);
  const value: Saved = { at: Date.now(), sig: signature(facts), review };
  await db.setting.upsert({ where: { key: key(userId) }, create: { key: key(userId), value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
  return review;
}

export interface LiveTotals {
  views: number | null;
  followers: number | null;
  source: "live" | "stored" | "none";
  windowDays: number;
  platforms: { platform: Platform; views: number | null; followers: number | null }[];
  fetchedAt: string;
}

/** The numbers behind the live counter. Reads the same 90 s dashboard cache, so polling costs the platforms nothing extra. */
export async function liveTotals(userId: string): Promise<LiveTotals> {
  const connected = await connectedPlatforms(userId);
  const live = CORE_PLATFORMS.filter((p) => connected[p]);
  const dashes = (await Promise.all(live.map((p) => platformDashboard(userId, p).catch(() => null)))).filter((d): d is NonNullable<typeof d> => !!d && d.status === "ok");
  if (dashes.length) {
    const facts = dashes.map((d) => platformFacts({ platform: d.platform, headline: d.headline, posts: d.posts, rangeDays: d.rangeDays }));
    const sum = (k: "views" | "followers") => (facts.some((f) => f[k] !== null) ? facts.reduce((a, f) => a + (f[k] ?? 0), 0) : null);
    const fetched = dashes.map((d) => d.fetchedAt).sort()[0];
    return { views: sum("views"), followers: sum("followers"), source: "live", windowDays: dashes[0].rangeDays, platforms: facts.map((f) => ({ platform: f.platform, views: f.views, followers: f.followers })), fetchedAt: fetched };
  }
  const a = await getAnalytics(userId, 30);
  return {
    views: a.hasData ? a.totals.views : null,
    followers: null,
    source: a.hasData ? "stored" : "none",
    windowDays: 30,
    platforms: a.byPlatform.filter((p) => p.views > 0).map((p) => ({ platform: p.platform, views: p.views, followers: null })),
    fetchedAt: new Date().toISOString(),
  };
}

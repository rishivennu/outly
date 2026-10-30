import "server-only";
import { subDays } from "date-fns";
import { db } from "../db";
import { cached } from "../cache";
import { env } from "../env";
import { HttpError } from "../http";
import { gemini } from "../ai/creative";
import { SAMPLE_DOMAIN } from "./sample";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];
export const isRange = (n: number): n is Range => (RANGES as readonly number[]).includes(n);

export type BehaviorStats = {
  generatedAt: string;
  rangeDays: number;
  sample: boolean;
  totals: { users: number; newUsers: number; prevNewUsers: number; dau: number; wau: number; mau: number; stickiness: number; activeInRange: number; paying: number; weeklyReportOptIn: number };
  funnel: { key: string; label: string; count: number; pct: number; stepPct: number }[];
  retention: { key: "d1" | "w1" | "d30"; label: string; eligible: number; retained: number; rate: number }[];
  cohorts: { label: string; start: string; size: number; weeks: (number | null)[] }[];
  frequency: { bucket: string; users: number }[];
  segments: { key: string; label: string; users: number; share: number; description: string }[];
  weekday: { day: string; active: number }[];
  series: { day: string; label: string; active: number; signups: number; posts: number; published: number }[];
  platforms: { platform: string; connected: number; needsReconnect: number; targets: number; published: number; failed: number; successRate: number | null }[];
  posts: { total: number; inRange: number; byStatus: Record<string, number>; publishRate: number; scheduledShare: number; approvalShare: number; avgPerCreator: number; creators: number; medianHoursToFirstPublish: number | null; practiceTargets: number };
  errors: { code: string; count: number }[];
  plans: { paidUsers: number; freeUsers: number; paidAvgActiveDays: number; freeAvgActiveDays: number };
  topUsers: { id: string; name: string; email: string; activeDays: number; posts: number; published: number; platforms: string[]; lastActiveAt: string | null; plan: string }[];
};

export type BehaviorResult = {
  headline: string;
  summary: string;
  health: "strong" | "steady" | "at_risk";
  confidence: "low" | "medium" | "high";
  segments: { name: string; share: string; behavior: string; action: string }[];
  insights: { title: string; detail: string; evidence: string; impact: "high" | "medium" | "low" }[];
  risks: { title: string; detail: string; severity: "high" | "medium" | "low" }[];
  recommendations: { title: string; detail: string; metric: string; effort: "low" | "medium" | "high" }[];
  experiments: { hypothesis: string; test: string; successMetric: string }[];
  changes: string[];
};

export type AnalysisSummary = { id: string; version: number; createdAt: string; createdBy: string; model: string | null; rangeDays: number; focus: string | null; headline: string; health: BehaviorResult["health"]; durationMs: number };
export type AnalysisFull = AnalysisSummary & { result: BehaviorResult; stats: AiSnapshot };

/* ------------------------------------------------------------------ */
/* Pure computation (exported for tests)                                */
/* ------------------------------------------------------------------ */

export type BehaviorInput = {
  users: { id: string; name: string; email: string; createdAt: Date; lastActiveAt: Date | null; weeklyReport: boolean }[];
  activity: { userId: string; day: string }[];
  accounts: { userId: string; platform: string; status: string }[];
  mediaUsers: string[];
  postCounts: { userId: string; status: string; count: number }[];
  firstPublish: { userId: string; at: Date }[];
  posts: { userId: string; status: string; createdAt: Date; publishedAt: Date | null; scheduledAt: Date | null; requireApproval: boolean }[];
  targets: { platform: string; platformStatus: string; practice: boolean; errorCode: string | null; userId: string }[];
  paid: { userId: string; plan: string }[];
};

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (k: string, n: number) => dayKey(new Date(Date.parse(k + "T00:00:00Z") + n * DAY));
const ratio = (a: number, b: number) => (b ? a / b : 0);
const round = (n: number, p = 3) => Math.round(n * 10 ** p) / 10 ** p;
const PUBLISHED = new Set(["published", "partial"]);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function computeBehavior(input: BehaviorInput, days: number, now = new Date()): BehaviorStats {
  const today = dayKey(now);
  const rangeStart = addDays(today, -(days - 1));
  const prevStart = addDays(today, -(2 * days - 1));
  const { users } = input;

  const daysByUser = new Map<string, Set<string>>();
  for (const a of input.activity) (daysByUser.get(a.userId) ?? daysByUser.set(a.userId, new Set()).get(a.userId)!).add(a.day);
  const activeDaysIn = (uid: string, from: string, to = today) => {
    let n = 0;
    for (const d of daysByUser.get(uid) ?? []) if (d >= from && d <= to) n++;
    return n;
  };
  const distinctSince = (from: string) => new Set(input.activity.filter((a) => a.day >= from && a.day <= today).map((a) => a.userId)).size;

  const dau = distinctSince(today);
  const wau = distinctSince(addDays(today, -6));
  const mau = distinctSince(addDays(today, -29));
  const activeInRange = distinctSince(rangeStart);
  const paidSet = new Map(input.paid.map((p) => [p.userId, p.plan]));
  const newUsers = users.filter((u) => dayKey(u.createdAt) >= rangeStart).length;
  const prevNewUsers = users.filter((u) => dayKey(u.createdAt) >= prevStart && dayKey(u.createdAt) < rangeStart).length;

  // ---- funnel (nested: each step counts users who also did every step before it)
  const connected = new Set(input.accounts.map((a) => a.userId));
  const uploaded = new Set(input.mediaUsers);
  const created = new Set(input.postCounts.filter((p) => p.count > 0).map((p) => p.userId));
  const published = new Set(input.postCounts.filter((p) => p.count > 0 && PUBLISHED.has(p.status)).map((p) => p.userId));
  const steps: [string, string, Set<string> | null][] = [
    ["signup", "Signed up", null],
    ["connect", "Connected a platform", connected],
    ["upload", "Uploaded a video", uploaded],
    ["post", "Created a post", created],
    ["publish", "Published", published],
    ["paid", "Paying", new Set(paidSet.keys())],
  ];
  let pool = users.map((u) => u.id);
  let prev = pool.length;
  const funnel = steps.map(([key, label, set]) => {
    if (set) pool = pool.filter((id) => set.has(id));
    const row = { key, label, count: pool.length, pct: round(ratio(pool.length, users.length)), stepPct: round(ratio(pool.length, prev)) };
    prev = pool.length;
    return row;
  });

  // ---- retention, measured on users who signed up in the last 120 days
  const recent = users.filter((u) => now.getTime() - u.createdAt.getTime() <= 120 * DAY);
  const ret = (key: "d1" | "w1" | "d30", label: string, minAge: number, from: number, to: number) => {
    const eligible = recent.filter((u) => addDays(dayKey(u.createdAt), minAge) <= today);
    const retained = eligible.filter((u) => {
      const s = dayKey(u.createdAt);
      return activeDaysIn(u.id, addDays(s, from), addDays(s, to)) > 0;
    }).length;
    return { key, label, eligible: eligible.length, retained, rate: round(ratio(retained, eligible.length)) };
  };
  const retention = [ret("d1", "Came back the next day", 1, 1, 1), ret("w1", "Came back in week one", 7, 1, 7), ret("d30", "Still active days 8 to 30", 30, 8, 30)];

  // ---- weekly sign-up cohorts (Monday starts), last 8 weeks
  const dow = (now.getUTCDay() + 6) % 7;
  const thisMonday = addDays(today, -dow);
  const cohorts = Array.from({ length: 8 }, (_, i) => {
    const start = addDays(thisMonday, -7 * (7 - i));
    const end = addDays(start, 6);
    const members = users.filter((u) => dayKey(u.createdAt) >= start && dayKey(u.createdAt) <= end);
    const weeks = Array.from({ length: 8 }, (_, w) => {
      const ws = addDays(start, 7 * w);
      if (ws > today || !members.length) return null;
      return round(ratio(members.filter((u) => activeDaysIn(u.id, ws, addDays(ws, 6)) > 0).length, members.length));
    });
    const d = new Date(start + "T00:00:00Z");
    return { label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }), start, size: members.length, weeks };
  });

  // ---- how often people come back inside the range
  const existing = users.filter((u) => dayKey(u.createdAt) <= today);
  const freqBuckets: [string, (n: number) => boolean][] = [["0 days", (n) => n === 0], ["1 day", (n) => n === 1], ["2 to 3", (n) => n >= 2 && n <= 3], ["4 to 7", (n) => n >= 4 && n <= 7], ["8 to 14", (n) => n >= 8 && n <= 14], ["15+", (n) => n >= 15]];
  const act = new Map(existing.map((u) => [u.id, activeDaysIn(u.id, rangeStart)]));
  const frequency = freqBuckets.map(([bucket, f]) => ({ bucket, users: [...act.values()].filter(f).length }));

  // ---- segments (mutually exclusive, first match wins)
  const powerAt = Math.max(4, Math.round(days * 0.27));
  const segDefs: { key: string; label: string; description: string; test: (u: BehaviorInput["users"][number], n: number) => boolean }[] = [
    { key: "new", label: "New this week", description: "Signed up in the last 7 days", test: (u) => now.getTime() - u.createdAt.getTime() < 7 * DAY },
    { key: "power", label: "Power creators", description: `Active on ${powerAt}+ days in the range`, test: (_, n) => n >= powerAt },
    { key: "regular", label: "Regulars", description: `Active on 3 to ${powerAt - 1} days`, test: (_, n) => n >= 3 },
    { key: "casual", label: "Casual", description: "Active on 1 or 2 days", test: (_, n) => n >= 1 },
    { key: "dormant", label: "Dormant", description: "No activity in the range", test: () => true },
  ];
  const segCount = new Map(segDefs.map((s) => [s.key, 0]));
  for (const u of existing) {
    const n = act.get(u.id) ?? 0;
    const s = segDefs.find((d) => d.test(u, n))!;
    segCount.set(s.key, (segCount.get(s.key) ?? 0) + 1);
  }
  const segments = segDefs.map((s) => ({ key: s.key, label: s.label, description: s.description, users: segCount.get(s.key) ?? 0, share: round(ratio(segCount.get(s.key) ?? 0, existing.length)) }));

  // ---- weekday rhythm and daily series
  const weekdayCount = new Array(7).fill(0);
  const actByDay = new Map<string, Set<string>>();
  for (const a of input.activity) {
    if (a.day < rangeStart || a.day > today) continue;
    (actByDay.get(a.day) ?? actByDay.set(a.day, new Set()).get(a.day)!).add(a.userId);
  }
  for (const [d, s] of actByDay) weekdayCount[new Date(d + "T00:00:00Z").getUTCDay()] += s.size;
  const weekday = [1, 2, 3, 4, 5, 6, 0].map((i) => ({ day: WEEKDAYS[i], active: weekdayCount[i] }));

  const rangePosts = input.posts.filter((p) => dayKey(p.createdAt) >= rangeStart);
  const series = Array.from({ length: days }, (_, i) => {
    const k = addDays(rangeStart, i);
    return {
      day: k,
      label: new Date(k + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
      active: actByDay.get(k)?.size ?? 0,
      signups: users.filter((u) => dayKey(u.createdAt) === k).length,
      posts: rangePosts.filter((p) => dayKey(p.createdAt) === k).length,
      published: input.posts.filter((p) => p.publishedAt && dayKey(p.publishedAt) === k).length,
    };
  });

  // ---- platforms
  const names = new Set([...input.accounts.map((a) => a.platform), ...input.targets.map((t) => t.platform)]);
  const real = input.targets.filter((t) => !t.practice);
  const platforms = [...names]
    .map((platform) => {
      const acc = input.accounts.filter((a) => a.platform === platform);
      const t = real.filter((x) => x.platform === platform);
      const ok = t.filter((x) => x.platformStatus === "published").length;
      const bad = t.filter((x) => x.platformStatus === "failed").length;
      return { platform, connected: acc.filter((a) => a.status === "connected").length, needsReconnect: acc.filter((a) => a.status === "needs_reconnect").length, targets: t.length, published: ok, failed: bad, successRate: ok + bad ? round(ratio(ok, ok + bad)) : null };
    })
    .sort((a, b) => b.targets - a.targets || b.connected - a.connected);

  // ---- posts
  const byStatus: Record<string, number> = {};
  for (const p of rangePosts) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  const creators = new Set(rangePosts.map((p) => p.userId)).size;
  const created0 = new Map(users.map((u) => [u.id, u.createdAt.getTime()]));
  const hours = input.firstPublish
    .map((f) => (created0.has(f.userId) ? (f.at.getTime() - created0.get(f.userId)!) / 3_600_000 : NaN))
    .filter((h) => Number.isFinite(h) && h >= 0)
    .sort((a, b) => a - b);
  const median = hours.length ? (hours.length % 2 ? hours[(hours.length - 1) / 2] : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2) : null;
  const posts = {
    total: input.postCounts.reduce((t, p) => t + p.count, 0),
    inRange: rangePosts.length,
    byStatus,
    publishRate: round(ratio(rangePosts.filter((p) => PUBLISHED.has(p.status)).length, rangePosts.length)),
    scheduledShare: round(ratio(rangePosts.filter((p) => p.scheduledAt).length, rangePosts.length)),
    approvalShare: round(ratio(rangePosts.filter((p) => p.requireApproval).length, rangePosts.length)),
    avgPerCreator: round(ratio(rangePosts.length, creators), 1),
    creators,
    medianHoursToFirstPublish: median === null ? null : round(median, 1),
    practiceTargets: input.targets.filter((t) => t.practice).length,
  };
  const errCount = new Map<string, number>();
  for (const t of real) if (t.platformStatus === "failed") errCount.set(t.errorCode || "UNKNOWN", (errCount.get(t.errorCode || "UNKNOWN") ?? 0) + 1);
  const errors = [...errCount.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count).slice(0, 6);

  // ---- paid versus free
  const paidIds = existing.filter((u) => paidSet.has(u.id));
  const freeIds = existing.filter((u) => !paidSet.has(u.id));
  const avgAct = (list: typeof existing) => round(ratio(list.reduce((t, u) => t + (act.get(u.id) ?? 0), 0), list.length), 1);

  // ---- most engaged people (admin screen only, never sent to the model)
  const postsBy = new Map<string, { posts: number; published: number }>();
  for (const p of input.postCounts) {
    const r = postsBy.get(p.userId) ?? { posts: 0, published: 0 };
    r.posts += p.count;
    if (PUBLISHED.has(p.status)) r.published += p.count;
    postsBy.set(p.userId, r);
  }
  const platformsBy = new Map<string, Set<string>>();
  for (const a of input.accounts) if (a.status === "connected") (platformsBy.get(a.userId) ?? platformsBy.set(a.userId, new Set()).get(a.userId)!).add(a.platform);
  const topUsers = existing
    .map((u) => ({ id: u.id, name: u.name, email: u.email, activeDays: act.get(u.id) ?? 0, posts: postsBy.get(u.id)?.posts ?? 0, published: postsBy.get(u.id)?.published ?? 0, platforms: [...(platformsBy.get(u.id) ?? [])].sort(), lastActiveAt: u.lastActiveAt?.toISOString() ?? null, plan: paidSet.get(u.id) ?? "Free" }))
    .filter((u) => u.activeDays > 0 || u.posts > 0)
    .sort((a, b) => b.activeDays - a.activeDays || b.published - a.published || b.posts - a.posts)
    .slice(0, 10);

  return {
    generatedAt: now.toISOString(),
    rangeDays: days,
    sample: users.some((u) => u.email.endsWith("@" + SAMPLE_DOMAIN)),
    totals: { users: users.length, newUsers, prevNewUsers, dau, wau, mau, stickiness: round(ratio(dau, mau)), activeInRange, paying: paidSet.size, weeklyReportOptIn: users.filter((u) => u.weeklyReport).length },
    funnel,
    retention,
    cohorts,
    frequency,
    segments,
    weekday,
    series,
    platforms,
    posts,
    errors,
    plans: { paidUsers: paidIds.length, freeUsers: freeIds.length, paidAvgActiveDays: avgAct(paidIds), freeAvgActiveDays: avgAct(freeIds) },
    topUsers,
  };
}

/** What the model sees: aggregates only. No names, emails or ids leave the server. */
export function anonymise(s: BehaviorStats) {
  const weekly: { weekOf: string; active: number; signups: number; posts: number; published: number }[] = [];
  for (let i = 0; i < s.series.length; i += 7) {
    const chunk = s.series.slice(i, i + 7);
    weekly.push({ weekOf: chunk[0].day, active: Math.max(...chunk.map((c) => c.active)), signups: chunk.reduce((t, c) => t + c.signups, 0), posts: chunk.reduce((t, c) => t + c.posts, 0), published: chunk.reduce((t, c) => t + c.published, 0) });
  }
  const { topUsers, series, ...rest } = s;
  void series;
  return {
    ...rest,
    weekly,
    topUsersShape: topUsers.map((u) => ({ activeDays: u.activeDays, posts: u.posts, published: u.published, platforms: u.platforms.length, paid: u.plan !== "Free" })),
  };
}
export type AiSnapshot = ReturnType<typeof anonymise>;

/* ------------------------------------------------------------------ */
/* Database loader                                                       */
/* ------------------------------------------------------------------ */

async function load(days: number): Promise<BehaviorInput> {
  const now = new Date();
  const since = subDays(now, Math.max(days * 2, 130));
  const rangeStart = subDays(now, days);
  const [users, activity, accounts, media, postCounts, firstPublish, posts, targets, subs] = await Promise.all([
    db.user.findMany({ select: { id: true, name: true, email: true, createdAt: true, lastActiveAt: true, weeklyReport: true } }),
    db.userActivityDay.findMany({ where: { day: { gte: dayKey(since) } }, select: { userId: true, day: true } }),
    db.socialAccount.findMany({ select: { userId: true, platform: true, status: true } }),
    db.media.groupBy({ by: ["userId"], _count: true }),
    db.post.groupBy({ by: ["userId", "status"], _count: true }),
    db.post.groupBy({ by: ["userId"], _min: { publishedAt: true }, where: { publishedAt: { not: null } } }),
    db.post.findMany({ where: { OR: [{ createdAt: { gte: rangeStart } }, { publishedAt: { gte: rangeStart } }] }, select: { userId: true, status: true, createdAt: true, publishedAt: true, scheduledAt: true, requireApproval: true } }),
    db.postTarget.findMany({ where: { createdAt: { gte: rangeStart } }, select: { platform: true, platformStatus: true, practice: true, errorCode: true, post: { select: { userId: true } } } }),
    db.subscription.findMany({ where: { status: { in: ["active", "past_due"] } }, select: { userId: true, plan: { select: { name: true } } } }),
  ]);
  return {
    users,
    activity,
    accounts,
    mediaUsers: media.map((m) => m.userId),
    postCounts: postCounts.map((p) => ({ userId: p.userId, status: p.status, count: p._count })),
    firstPublish: firstPublish.filter((f) => f._min.publishedAt).map((f) => ({ userId: f.userId, at: f._min.publishedAt! })),
    posts,
    targets: targets.map((t) => ({ platform: t.platform, platformStatus: t.platformStatus, practice: t.practice, errorCode: t.errorCode, userId: t.post.userId })),
    paid: subs.map((s) => ({ userId: s.userId, plan: s.plan?.name ?? "Paid" })),
  };
}

/** Several admins on the page share one computation per 20 s. */
export function behavior(days: Range = 30) {
  return cached(`admin:behavior:${days}`, 20_000, async () => computeBehavior(await load(days), days));
}

/* ------------------------------------------------------------------ */
/* Gemini analysis, every run kept as a numbered version                */
/* ------------------------------------------------------------------ */

const SYSTEM = `You are the product analyst for Outlly, a web app where short-form video creators upload a video once and publish it to Instagram, YouTube, X, TikTok, Facebook, LinkedIn and Threads, with AI-written hooks and captions, scheduling and team approval.
You read aggregate user-behaviour data and explain it to the founding team.
Rules: use ONLY the numbers given. Never invent a statistic, benchmark, study or user quote. Rates are fractions (0.25 = 25%); write them as percentages. When a group is too small to conclude anything (under about 20 people), say so plainly and lower your confidence. Plain words, short sentences, no emoji, no hype, no em-dashes.`;

const clean = (v: unknown, max = 600) =>
  typeof v === "string" ? v.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, max) : "";
const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);
const list = <T>(v: unknown, n: number, map: (x: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(v) ? v.slice(0, n).map((x) => (x && typeof x === "object" ? map(x as Record<string, unknown>) : null)).filter((x): x is T => !!x) : [];
const LMH = ["low", "medium", "high"] as const;

/** Coerces whatever the model returned into the exact shape the screen renders. */
export function normaliseResult(raw: unknown): BehaviorResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const headline = clean(r.headline, 160);
  const summary = clean(r.summary, 1200);
  if (!headline && !summary) return null;
  return {
    headline: headline || summary.split(". ")[0],
    summary,
    health: pick(r.health, ["strong", "steady", "at_risk"] as const, "steady"),
    confidence: pick(r.confidence, LMH, "medium"),
    segments: list(r.segments, 6, (x) => (clean(x.name) ? { name: clean(x.name, 60), share: clean(x.share, 40), behavior: clean(x.behavior), action: clean(x.action) } : null)),
    insights: list(r.insights, 8, (x) => (clean(x.title) ? { title: clean(x.title, 120), detail: clean(x.detail), evidence: clean(x.evidence, 300), impact: pick(x.impact, LMH, "medium") } : null)),
    risks: list(r.risks, 6, (x) => (clean(x.title) ? { title: clean(x.title, 120), detail: clean(x.detail), severity: pick(x.severity, LMH, "medium") } : null)),
    recommendations: list(r.recommendations, 8, (x) => (clean(x.title) ? { title: clean(x.title, 120), detail: clean(x.detail), metric: clean(x.metric, 160), effort: pick(x.effort, LMH, "medium") } : null)),
    experiments: list(r.experiments, 5, (x) => (clean(x.hypothesis) ? { hypothesis: clean(x.hypothesis, 300), test: clean(x.test, 400), successMetric: clean(x.successMetric, 200) } : null)),
    changes: Array.isArray(r.changes) ? r.changes.slice(0, 8).map((c) => clean(c, 300)).filter(Boolean) : [],
  };
}

export function buildPrompt(snapshot: AiSnapshot, focus: string | null, previous: { version: number; createdAt: string; result: BehaviorResult; stats: AiSnapshot } | null) {
  const prev = previous
    ? `\n\nThe previous analysis was version ${previous.version} on ${previous.createdAt.slice(0, 10)}. Its headline was "${previous.result.headline}". Its key numbers were: ${JSON.stringify({ totals: previous.stats.totals, funnel: previous.stats.funnel.map((f) => [f.key, f.count]), retention: previous.stats.retention.map((r) => [r.key, r.rate]) })}. In "changes", list what moved since then, with numbers.`
    : `\n\nThis is the first analysis, so "changes" must be an empty list.`;
  const ask = focus ? `\n\nThe team asked you to focus on: """${focus}""". Answer that directly in the summary and the first insight, using the data.` : "";
  return `Here is Outlly's user-behaviour snapshot for the last ${snapshot.rangeDays} days as JSON:\n${JSON.stringify(snapshot)}${prev}${ask}

Reply as JSON with exactly these keys:
{"headline": one sentence, max 18 words,
 "summary": 3 to 5 sentences on how people actually use the product,
 "health": "strong" | "steady" | "at_risk",
 "confidence": "low" | "medium" | "high" (how much data backs this),
 "segments": [{"name","share": e.g. "18% of users","behavior": what they do,"action": how to serve them}] (3 to 5),
 "insights": [{"title","detail","evidence": the exact numbers used,"impact":"high"|"medium"|"low"}] (3 to 6),
 "risks": [{"title","detail","severity":"high"|"medium"|"low"}] (1 to 4),
 "recommendations": [{"title","detail","metric": the number that should move,"effort":"low"|"medium"|"high"}] (3 to 6, most valuable first),
 "experiments": [{"hypothesis","test","successMetric"}] (1 to 3),
 "changes": [strings]}`;
}

const toSummary = (r: { id: string; version: number; createdAt: Date; createdBy: string; model: string | null; rangeDays: number; focus: string | null; result: string; durationMs: number }): AnalysisSummary => {
  const res = safeParse<BehaviorResult>(r.result);
  return { id: r.id, version: r.version, createdAt: r.createdAt.toISOString(), createdBy: r.createdBy, model: r.model, rangeDays: r.rangeDays, focus: r.focus, headline: res?.headline ?? "(unreadable result)", health: pick(res?.health, ["strong", "steady", "at_risk"] as const, "steady"), durationMs: r.durationMs };
};
function safeParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export async function listAnalyses(opts: { before?: number; take?: number } = {}) {
  const take = Math.min(Math.max(opts.take ?? 20, 1), 50);
  const rows = await db.behaviorAnalysis.findMany({
    where: opts.before ? { version: { lt: opts.before } } : undefined,
    orderBy: { version: "desc" },
    take: take + 1,
    select: { id: true, version: true, createdAt: true, createdBy: true, model: true, rangeDays: true, focus: true, result: true, durationMs: true },
  });
  return { items: rows.slice(0, take).map(toSummary), more: rows.length > take, total: await db.behaviorAnalysis.count() };
}

export async function getAnalysis(id: string): Promise<AnalysisFull | null> {
  const r = await db.behaviorAnalysis.findUnique({ where: { id } });
  if (!r) return null;
  const result = normaliseResult(safeParse(r.result));
  const stats = safeParse<AiSnapshot>(r.stats);
  if (!result || !stats) return null;
  return { ...toSummary(r), result, stats };
}

export const aiReady = () => !!env.GEMINI_API_KEY;

export async function runAnalysis(opts: { rangeDays: Range; focus?: string | null; by: string }): Promise<AnalysisFull> {
  if (!aiReady()) throw new HttpError(503, "Gemini isn't set up. Add GEMINI_API_KEY to the server environment, redeploy, then run the analysis.", "NO_AI");
  const stats = computeBehavior(await load(opts.rangeDays), opts.rangeDays);
  const snapshot = anonymise(stats);
  const focus = opts.focus?.trim().slice(0, 300) || null;
  const last = await db.behaviorAnalysis.findFirst({ orderBy: { version: "desc" } });
  const previous = last ? (() => {
    const result = normaliseResult(safeParse(last.result));
    const st = safeParse<AiSnapshot>(last.stats);
    return result && st ? { version: last.version, createdAt: last.createdAt.toISOString(), result, stats: st } : null;
  })() : null;

  let model: string | null = null;
  const t0 = Date.now();
  const raw = await gemini<unknown>(SYSTEM, buildPrompt(snapshot, focus, previous), {
    temperature: 0.35,
    timeoutMs: 25_000,
    models: ["gemini-3.6-flash", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"],
    onModel: (m) => (model = m),
  });
  const result = normaliseResult(raw);
  if (!result) throw new HttpError(502, "Gemini didn't send back a usable analysis. Nothing was saved. Try again in a minute.", "AI_FAILED");
  if (!previous) result.changes = [];
  const durationMs = Date.now() - t0;

  for (let attempt = 0; attempt < 3; attempt++) {
    const top = await db.behaviorAnalysis.findFirst({ orderBy: { version: "desc" }, select: { version: true } });
    try {
      const row = await db.behaviorAnalysis.create({
        data: { version: (top?.version ?? 0) + 1, rangeDays: opts.rangeDays, focus, model, stats: JSON.stringify(snapshot), result: JSON.stringify(result), createdBy: opts.by, durationMs },
      });
      return { ...toSummary(row), result, stats: snapshot };
    } catch (e) {
      // Two admins pressed Run at the same moment: take the next number.
      if ((e as { code?: string }).code !== "P2002" || attempt === 2) throw e;
    }
  }
  throw new Error("unreachable");
}

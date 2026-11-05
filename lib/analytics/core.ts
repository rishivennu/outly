/**
 * 1140: the pure rules behind the analytics hub. No server imports, so the overview, the per-profile
 * dashboards, the reports and the tests all agree on the same maths and the same honesty rules.
 *
 * Two rules decide most of this file:
 *  - a metric a platform does not report is missing, never 0;
 *  - numbers are only added across platforms when they mean the same thing on each of them.
 */

export type StoredMetric = "views" | "likes" | "comments" | "shares" | "saves";
export const STORED_METRICS: StoredMetric[] = ["views", "likes", "comments", "shares", "saves"];

/**
 * What Outlly can report per platform for posts published through it, from the per-post readers that
 * actually exist (lib/insights/post.ts CAN). Platforms missing here have no per-post reader, so their
 * stored numbers stay empty rather than reading as zeroes.
 */
export const STORED_BY_PLATFORM: Record<string, StoredMetric[]> = {
  instagram: ["views", "likes", "comments", "shares", "saves"],
  youtube: ["views", "likes", "comments", "shares"],
  facebook: ["views", "likes", "comments"],
};

export const METRIC_TITLE: Record<StoredMetric | "engagement", string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  engagement: "Engagement",
};

/** Platforms that report nothing per post: listed by name so the page can say why a column is absent. */
export const hasStoredReader = (platform: string) => !!STORED_BY_PLATFORM[platform];

/**
 * The KPI cards to show for a selection. A metric is offered when at least one selected platform reports
 * it, and `partial` names the selected platforms that do not, so a combined card can say what it leaves out.
 */
export function kpiMetrics(platforms: string[]): { metric: StoredMetric | "engagement"; from: string[]; missing: string[] }[] {
  const live = platforms.filter(hasStoredReader);
  const out: { metric: StoredMetric | "engagement"; from: string[]; missing: string[] }[] = [];
  for (const m of STORED_METRICS) {
    const from = live.filter((p) => STORED_BY_PLATFORM[p].includes(m));
    if (!from.length) continue;
    out.push({ metric: m, from, missing: live.filter((p) => !STORED_BY_PLATFORM[p].includes(m)) });
  }
  if (live.length) out.push({ metric: "engagement", from: live, missing: [] });
  return out;
}

/** Interactions per view, as a percentage. Null when there is nothing honest to divide by. */
export function engagementPct(t: { views: number; likes: number; comments: number; shares: number; saves?: number }): number | null {
  if (!t.views) return null;
  return ((t.likes + t.comments + t.shares + (t.saves ?? 0)) / t.views) * 100;
}

/** Percent change, or null when there is no previous number to compare with. */
export function changePct(now: number, before: number): number | null {
  if (!before) return null;
  return ((now - before) / before) * 100;
}

/* ------------------------------------------------------------------ ranges */

export const DAY_MS = 864e5;
export const dayKey = (d: Date | number) => new Date(d).toISOString().slice(0, 10);

export interface RangeWindow {
  /** Inclusive start, midnight UTC of the first day. */
  from: string;
  /** Exclusive end, midnight UTC after the last day. */
  to: string;
  days: number;
  custom: boolean;
  /** True when the plan's history window cut the request short. */
  clamped: boolean;
}

/**
 * Turn a request into a window, inside the plan's history (lib/billing/plan-rules analyticsWindow).
 * A bad or backwards custom range falls back to the day count, so a typed URL can never read further
 * back than the plan allows.
 */
export function resolveRange(input: { days?: number; from?: string | null; to?: string | null }, maxDays: number, now: Date | number = Date.now()): RangeWindow {
  const end = new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00.000Z").getTime() + DAY_MS;
  const earliest = end - Math.max(1, maxDays) * DAY_MS;
  const parse = (s: string | null | undefined) => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const t = Date.parse(`${s}T00:00:00.000Z`);
    return Number.isFinite(t) ? t : null;
  };
  const f = parse(input.from);
  const t = parse(input.to);
  if (f !== null && t !== null && t >= f) {
    const to = Math.min(t + DAY_MS, end);
    const from = Math.max(f, earliest);
    if (to > from) {
      return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), days: Math.round((to - from) / DAY_MS), custom: true, clamped: f < earliest || t + DAY_MS > end };
    }
  }
  const want = Math.max(1, Math.floor(input.days ?? 30) || 30);
  const days = Math.min(want, Math.max(1, maxDays));
  return { from: new Date(end - days * DAY_MS).toISOString(), to: new Date(end).toISOString(), days, custom: false, clamped: want > days };
}

/** "1 to 7 Nov 2026", for a heading that has to say exactly what it covers. */
export function rangeLabel(w: Pick<RangeWindow, "from" | "to">) {
  const a = new Date(w.from);
  const b = new Date(Date.parse(w.to) - DAY_MS);
  const fmt = (d: Date, opts: { month?: boolean; year?: boolean }) =>
    d.toLocaleDateString("en-GB", { day: "numeric", ...(opts.month === false ? {} : { month: "short" }), ...(opts.year ? { year: "numeric" } : {}), timeZone: "UTC" });
  if (dayKey(a) === dayKey(b)) return fmt(b, { year: true });
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  // "1 to 3 Nov 2026" inside one month, "30 Dec 2025 to 1 Jan 2026" across a year.
  return `${fmt(a, { month: !(sameYear && a.getUTCMonth() === b.getUTCMonth()), year: !sameYear })} to ${fmt(b, { year: true })}`;
}

/* ------------------------------------------------------------------ headline */

export interface HeadlineFacts {
  views: number;
  previousViews: number;
  followerGain: { platform: string; name: string; metric: string; gain: number } | null;
  bestPlatform: { platform: string; name: string } | null;
  bestDay: string | null;
  posts: number;
  rangePhrase: string;
  accountName: string | null;
}

export interface HeadlineOut {
  /** Which fact leads the sentence, so the page can style the number it already owns. */
  variant: "followers" | "views" | "posts" | "none";
  /** The sentence, split so the number can be styled on its own. */
  before: string;
  value: number | null;
  after: string;
  /** One extra line, only when the numbers support it. */
  notes: string[];
}

/**
 * The page's one big sentence, chosen from what the numbers actually hold. Follower growth leads when
 * there is a real gain to report, because it is the thing a creator checks first; otherwise views lead.
 * Nothing here says anything the facts do not contain.
 */
export function headline(f: HeadlineFacts): HeadlineOut {
  const who = f.accountName ? `${f.accountName} ` : "";
  const notes: string[] = [];
  const c = changePct(f.views, f.previousViews);
  if (c !== null) notes.push(Math.abs(c) < 1 ? "About the same as the period before." : `${Math.round(Math.abs(c))}% ${c >= 0 ? "more" : "fewer"} than the period before.`);
  if (f.bestPlatform && f.views > 0) notes.push(`${f.bestPlatform.name} is where you are landing hardest.`);
  if (f.bestDay) notes.push(`${f.bestDay}s are your day.`);
  if (f.followerGain && f.followerGain.gain > 0) {
    return { variant: "followers", before: `Your ${f.followerGain.name} ${f.followerGain.metric === "subscribers" ? "channel" : "profile"} gained `, value: f.followerGain.gain, after: ` ${f.followerGain.metric} ${f.rangePhrase}.`, notes };
  }
  if (f.views > 0) return { variant: "views", before: `${who ? `${who}content got ` : "Your content got "}`, value: f.views, after: ` views ${f.rangePhrase}.`, notes };
  if (f.posts > 0) return { variant: "posts", before: "You published ", value: f.posts, after: ` ${f.posts === 1 ? "post" : "posts"} ${f.rangePhrase}.`, notes: ["No view counts have come back from the platforms for them yet."] };
  return { variant: "none", before: "Nothing published through Outlly ", value: null, after: `${f.rangePhrase}.`, notes: [] };
}

/* ------------------------------------------------------------------ standouts */

export type RankKey = "views" | "engaged" | "shares" | "saves";
export const RANKS: { k: RankKey; label: string }[] = [
  { k: "views", label: "Most viewed" },
  { k: "engaged", label: "Most engaged" },
  { k: "shares", label: "Most shared" },
  { k: "saves", label: "Most saved" },
];

export interface StandoutPost {
  targetId: string;
  postId: string;
  title: string;
  thumbnailUrl: string | null;
  platform: string;
  accountId: string | null;
  username: string | null;
  url: string | null;
  publishedAt: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  /** Interactions per view, or null when the platform gave no views. */
  engagement: number | null;
}

/** The ranking the list is sorted by. An unsupported metric sorts last rather than pretending to be 0. */
export function rankStandouts(posts: StandoutPost[], by: RankKey): StandoutPost[] {
  const score = (p: StandoutPost) => (by === "views" ? p.views : by === "engaged" ? (p.engagement ?? -1) : by === "shares" ? p.shares : p.saves);
  return [...posts].sort((a, b) => score(b) - score(a) || b.views - a.views);
}

/** How a post did against the average of the posts in the same window. Null when there is no average yet. */
export function vsAverage(value: number, average: number): number | null {
  if (!average || !Number.isFinite(average)) return null;
  return ((value - average) / average) * 100;
}

/** Ranking metrics the selected platforms can actually fill, so the filter never offers an empty sort. */
export const ranksFor = (platforms: string[]) => {
  const live = platforms.filter(hasStoredReader);
  return RANKS.filter((r) => r.k === "views" || r.k === "engaged" || live.some((p) => STORED_BY_PLATFORM[p].includes(r.k as StoredMetric)));
};

/* ------------------------------------------------------------------ snapshots and growth */

export interface SnapshotPoint {
  day: string;
  followers: number | null;
  posts: number | null;
  views: number | null;
}

/**
 * Follower growth from the daily snapshots Outlly keeps. Only days the platform actually answered on are
 * used, and a single day is not a trend: `enough` is false until there are two, so the chart can say
 * "no history yet" instead of drawing a flat line through invented zeroes.
 */
export function growth(points: SnapshotPoint[]): { first: number | null; last: number | null; gain: number | null; days: number; enough: boolean } {
  const have = points.filter((p) => typeof p.followers === "number").sort((a, b) => a.day.localeCompare(b.day));
  if (have.length < 2) return { first: have[0]?.followers ?? null, last: have[0]?.followers ?? null, gain: null, days: have.length, enough: false };
  const first = have[0].followers as number;
  const last = have[have.length - 1].followers as number;
  return { first, last, gain: last - first, days: have.length, enough: true };
}

/* ------------------------------------------------------------------ combining and comparing */

/** Metrics that mean the same thing on every platform that reports them, so a comparison may use them. */
export const COMPARABLE: (StoredMetric | "engagement" | "posts")[] = ["views", "likes", "comments", "engagement", "posts"];

/**
 * The sentence under a combined KPI row. It names the platforms counted and the ones left out, and says
 * plainly what is not added up.
 */
export function combinedNote(platforms: { platform: string; name: string }[], missing: { platform: string; name: string }[]): string {
  const list = (xs: { name: string }[]) => (xs.length > 1 ? `${xs.slice(0, -1).map((x) => x.name).join(", ")} and ${xs[xs.length - 1].name}` : (xs[0]?.name ?? ""));
  if (!platforms.length) return "No platform has sent numbers for these posts yet.";
  const parts = [`Added up across ${list(platforms)}, from posts published through Outlly.`];
  if (missing.length) parts.push(`${list(missing)} ${missing.length > 1 ? "do" : "does"} not report every one of these, so it is left out of those cards.`);
  parts.push("Followers and reach are never added across platforms: each platform counts them its own way.");
  return parts.join(" ");
}

/** A like-for-like comparison of two accounts on one metric. Null when either side has no number. */
export function compareValue(a: number | null | undefined, b: number | null | undefined): { diff: number; pct: number | null } | null {
  if (typeof a !== "number" || typeof b !== "number") return null;
  return { diff: a - b, pct: b ? ((a - b) / b) * 100 : null };
}

/** How fresh a number is, in the words the cards use. */
export function freshness(lastSyncAt: string | null, now = Date.now()): { label: string; stale: boolean } {
  if (!lastSyncAt) return { label: "Not synced yet", stale: true };
  const ms = Math.max(0, now - Date.parse(lastSyncAt));
  const mins = Math.round(ms / 60_000);
  const label = mins < 2 ? "Synced just now" : mins < 60 ? `Synced ${mins} min ago` : ms < 48 * 3600_000 ? `Synced ${Math.round(mins / 60)} h ago` : `Synced ${Math.round(mins / 1440)} d ago`;
  return { label, stale: ms > 24 * 3600_000 };
}

/** What a shown number is: straight from the platform, a short cache, or Outlly's own stored history. */
export type Provenance = "live" | "cached" | "snapshot" | "unavailable";
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  live: "Live from the platform",
  cached: "Cached a moment ago",
  snapshot: "From Outlly's saved history",
  unavailable: "Not available",
};

/**
 * 1140: the per-profile dashboard maths. Pure, so the page and the tests share it.
 *
 * Everything here is worked out from posts the platform already returned. A platform that reports no views
 * leaves `views` null on every row rather than filling the table with zeroes, and a bucket with no posts is
 * never listed at all.
 */

export interface FormatPost {
  format: string;
  publishedAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares?: number | null;
  saves?: number | null;
}

export interface Bucket {
  label: string;
  posts: number;
  /** Total views in this bucket, or null when the platform reported views for none of its posts. */
  views: number | null;
  avgViews: number | null;
  /** Interactions per view across this bucket, or null when there is nothing honest to divide by. */
  engagement: number | null;
}

function fold(label: string, posts: FormatPost[]): Bucket {
  const withViews = posts.filter((p) => typeof p.views === "number");
  const views = withViews.length ? withViews.reduce((a, p) => a + (p.views as number), 0) : null;
  const acts = withViews.reduce((a, p) => a + (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0), 0);
  return {
    label,
    posts: posts.length,
    views,
    avgViews: views !== null && withViews.length ? views / withViews.length : null,
    engagement: views ? (acts / views) * 100 : null,
  };
}

/** Which formats this profile actually publishes (Reels, carousels, images, stories, shorts, videos), busiest first. */
export function formatBreakdown(posts: FormatPost[]): Bucket[] {
  const by = new Map<string, FormatPost[]>();
  for (const p of posts) {
    const label = (p.format || "Post").replace(/s$/, "");
    (by.get(label) ?? by.set(label, []).get(label)!).push(p);
  }
  return [...by].map(([label, ps]) => fold(label, ps)).sort((a, b) => b.posts - a.posts || (b.views ?? 0) - (a.views ?? 0));
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Local weekday of an ISO time in a timezone, without pulling in a date library. */
function localParts(iso: string, timeZone: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const f = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", hour: "2-digit", hour12: false });
  const parts = f.formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  return { weekday, hour: Number.isFinite(hour) ? hour % 24 : null };
}

/** The days this profile publishes on, in the creator's own timezone. Monday first, empty days included. */
export function activeDays(posts: FormatPost[], timeZone = "UTC"): Bucket[] {
  const by = new Map<string, FormatPost[]>(DAYS.map((d) => [d, []]));
  for (const p of posts) {
    const l = localParts(p.publishedAt, timeZone);
    if (l && by.has(l.weekday)) by.get(l.weekday)!.push(p);
  }
  return DAYS.map((d) => fold(d, by.get(d) ?? []));
}

/** The hours of the day this profile publishes in, in the creator's timezone. Only hours it actually used. */
export function activeHours(posts: FormatPost[], timeZone = "UTC"): (Bucket & { hour: number })[] {
  const by = new Map<number, FormatPost[]>();
  for (const p of posts) {
    const l = localParts(p.publishedAt, timeZone);
    if (!l || l.hour === null) continue;
    (by.get(l.hour) ?? by.set(l.hour, []).get(l.hour)!).push(p);
  }
  return [...by]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, ps]) => ({ hour, ...fold(`${String(hour).padStart(2, "0")}:00`, ps) }));
}

/** The best bucket by average views, or null when nothing has a view count or there is only one bucket. */
export function bestBucket(buckets: Bucket[]): Bucket | null {
  const have = buckets.filter((b) => b.posts > 0 && b.avgViews !== null);
  if (have.length < 2) return null;
  return have.reduce((a, b) => ((b.avgViews as number) > (a.avgViews as number) ? b : a));
}

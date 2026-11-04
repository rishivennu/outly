/**
 * Pip's analysis maths (1123), the pure part: no database, no clock, no model. Tested in
 * tests/round-1123-pip.test.ts. Every function either returns a number worked out from the creator's own
 * posts or says there isn't enough data to say anything; nothing here guesses.
 *
 * Numbers: Outlly's synced metrics are deltas (each TargetMetric row is what changed since the last sync),
 * so the sum over a period is what happened in that period, and the sum over all rows is the lifetime total.
 */
export const DAY_MS = 864e5;

export type StatPost = {
  /** PostTarget id: one post on one platform. */
  key: string;
  postId: string;
  platform: string;
  accountId: string | null;
  title: string;
  url: string | null;
  publishedAt: number;
  format: string;
  orientation: "Vertical" | "Horizontal" | "Square" | null;
  duration: number | null;
  captionLen: number;
  hashtags: string[];
  views: number;
  likes: number;
  comments: number;
  shares: number;
  /** False when Outlly has no numbers for it yet (just published, or the platform hasn't reported). */
  hasMetrics: boolean;
};
export type Snap = { at: number; platform: string; key: string; views: number; likes: number; comments: number; shares: number };

export const interactionsOf = (x: { likes: number; comments: number; shares: number }) => x.likes + x.comments + x.shares;
/** Interactions per hundred views, or null with no views (never 0%, which would read as "nobody engaged"). */
export const erOf = (interactions: number, views: number) => (views > 0 ? (interactions / views) * 100 : null);

// ---------- basic statistics ----------
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
export function quantile(xs: number[], q: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export function changePct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

/** Least squares on y against 0..n-1. */
export function linreg(ys: number[]) {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0, n, residualSd: 0 };
  const xm = (n - 1) / 2;
  const ym = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - xm) * (ys[i] - ym);
    sxx += (i - xm) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const intercept = ym - slope * xm;
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    ssr += (ys[i] - (intercept + slope * i)) ** 2;
    sst += (ys[i] - ym) ** 2;
  }
  return { slope, intercept, r2: sst ? Math.max(0, 1 - ssr / sst) : 0, n, residualSd: n > 2 ? Math.sqrt(ssr / (n - 2)) : 0 };
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26, accurate to about 1e-7). */
export function normCdf(z: number) {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/**
 * Mann-Kendall trend test: is a series going one way more often than chance would allow? Distribution free,
 * so one viral week doesn't decide it. Needs 6+ points; p is two-sided (normal approximation).
 */
export function mannKendall(ys: number[]): { s: number; p: number; n: number } | null {
  const n = ys.length;
  if (n < 6) return null;
  let s = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(ys[j] - ys[i]);
  const v = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = s > 0 ? (s - 1) / Math.sqrt(v) : s < 0 ? (s + 1) / Math.sqrt(v) : 0;
  return { s, p: Math.min(1, 2 * (1 - normCdf(Math.abs(z)))), n };
}

/** Average ranks (ties share a rank). */
function ranks(xs: number[]) {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = Array(xs.length).fill(0);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

/** Mann-Whitney U: do two groups of posts really differ, or is it noise? Two-sided p; null below 5 per group. */
export function mannWhitneyP(a: number[], b: number[]): number | null {
  if (a.length < 5 || b.length < 5) return null;
  const r = ranks([...a, ...b]);
  const ra = r.slice(0, a.length).reduce((x, y) => x + y, 0);
  const u = ra - (a.length * (a.length + 1)) / 2;
  const mu = (a.length * b.length) / 2;
  const sd = Math.sqrt((a.length * b.length * (a.length + b.length + 1)) / 12);
  if (!sd) return 1;
  const z = (Math.abs(u - mu) - 0.5) / sd;
  return Math.min(1, 2 * (1 - normCdf(Math.max(0, z))));
}

/** Spearman rank correlation, or null below 6 pairs. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 6) return null;
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

/** Robust z-scores (median and MAD), so one spike can't hide another. Falls back to the standard deviation. */
export function robustZ(xs: number[]) {
  const m = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - m))) * 1.4826;
  const sd = mad || stdev(xs);
  return xs.map((x) => (sd ? (x - m) / sd : 0));
}

// ---------- formatting ----------
export const fmtInt = (n: number) => new Intl.NumberFormat("en-IN").format(Math.round(n));
export const fmtRate = (n: number | null) => (n == null ? "Not available" : `${Math.round(n * 10) / 10}%`);
export const fmtSigned = (n: number | null) => (n == null ? "New" : `${n >= 0 ? "+" : ""}${Math.round(n * 10) / 10}%`);
export const fmtX = (n: number) => `${Math.round(n * 10) / 10}x`;
export const fmtP = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${Math.round(p * 1000) / 1000}`);

// ---------- calendar in the creator's timezone ----------
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dayFmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}
/** YYYY-MM-DD on the wall clock in tz. */
export const localDay = (at: number, tz: string) => dayFmt(tz).format(new Date(at));
/** Every local day from `from` up to (not including) `to`, DST safe. */
export function dayKeys(from: number, to: number, tz: string): string[] {
  const out: string[] = [];
  const last = localDay(Math.max(from, to - 1), tz);
  for (let t = from; ; t += 6 * 3600_000) {
    const k = localDay(Math.min(t, to - 1), tz);
    if (out[out.length - 1] !== k) out.push(k);
    if (k === last || t >= to) break;
  }
  return out;
}
/** Monday of the week a day key falls in, as a day key. */
export function weekOf(dayKey: string) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const wd = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - wd * DAY_MS).toISOString().slice(0, 10);
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Oct" from a day key. */
export const shortDay = (k: string) => `${Number(k.slice(8, 10))} ${MON[Number(k.slice(5, 7)) - 1]}`;
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const partsCache = new Map<string, Intl.DateTimeFormat>();
/** Weekday (0 = Monday) and hour on the wall clock in tz. */
export function localWhen(at: number, tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" });
    partsCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday), hour: Number(p.hour) % 24 };
}
export const BLOCKS = ["Midnight to 3am", "3am to 6am", "6am to 9am", "9am to noon", "Noon to 3pm", "3pm to 6pm", "6pm to 9pm", "9pm to midnight"];
export const blockOf = (hour: number) => BLOCKS[Math.floor(hour / 3)];

// ---------- buckets ----------
export type Buckets = { keys: string[]; views: number[]; inter: number[]; posts: number[] };

/** Day buckets for the snapshots and publish times that fall in [from, to), optionally one platform only. */
export function bucketDays(snaps: Snap[], posts: StatPost[], from: number, to: number, tz: string, platform?: string): Buckets {
  const keys = dayKeys(from, to, tz);
  const at = new Map(keys.map((k, i) => [k, i]));
  const b: Buckets = { keys, views: Array(keys.length).fill(0), inter: Array(keys.length).fill(0), posts: Array(keys.length).fill(0) };
  for (const s of snaps) {
    if (s.at < from || s.at >= to || (platform && s.platform !== platform)) continue;
    const i = at.get(localDay(s.at, tz));
    if (i === undefined) continue;
    b.views[i] += s.views;
    b.inter[i] += interactionsOf(s);
  }
  for (const p of posts) {
    if (p.publishedAt < from || p.publishedAt >= to || (platform && p.platform !== platform)) continue;
    const i = at.get(localDay(p.publishedAt, tz));
    if (i !== undefined) b.posts[i] += 1;
  }
  return b;
}

export type Week = { key: string; days: number; views: number; inter: number; posts: number; perDay: number; er: number | null };
/** Day buckets rolled into Monday weeks. perDay keeps a part week (the current one) comparable with full ones. */
export function toWeeks(b: Buckets): Week[] {
  const out: Week[] = [];
  b.keys.forEach((k, i) => {
    const w = weekOf(k);
    let cur = out[out.length - 1];
    if (!cur || cur.key !== w) {
      cur = { key: w, days: 0, views: 0, inter: 0, posts: 0, perDay: 0, er: null };
      out.push(cur);
    }
    cur.days++;
    cur.views += b.views[i];
    cur.inter += b.inter[i];
    cur.posts += b.posts[i];
  });
  for (const w of out) {
    w.perDay = w.days ? w.views / w.days : 0;
    w.er = erOf(w.inter, w.views);
  }
  return out;
}

// ---------- trend, anomalies, forecast ----------
export type Trend = { enough: false; n: number } | { enough: true; n: number; weeklyPct: number; direction: "up" | "down" | "flat"; p: number | null; significant: boolean; r2: number };

/** Direction and size of a weekly series, with a significance test so "rising" means more than noise. */
export function trendOf(values: number[]): Trend {
  const n = values.length;
  if (n < 4 || values.every((v) => v === 0)) return { enough: false, n };
  const lr = linreg(values);
  const m = mean(values);
  const weeklyPct = m > 0 ? (lr.slope / m) * 100 : 0;
  const mk = mannKendall(values);
  const significant = !!mk && mk.p < 0.05;
  const direction = Math.abs(weeklyPct) < 2 || (!significant && lr.r2 < 0.25) ? "flat" : weeklyPct > 0 ? "up" : "down";
  return { enough: true, n, weeklyPct, direction, p: mk?.p ?? null, significant, r2: lr.r2 };
}

export type Anomaly = { index: number; label: string; value: number; ratio: number; kind: "spike" | "dip" };
/** Points far from the typical value (robust z of 3 or more). Needs `minN` points; zeros are kept, they're real. */
export function anomaliesOf(values: number[], labels: string[], minN = 6, threshold = 3): Anomaly[] {
  if (values.length < minN) return [];
  const m = median(values);
  const z = robustZ(values);
  const out: Anomaly[] = [];
  z.forEach((zz, i) => {
    if (Math.abs(zz) < threshold) return;
    // A "dip" to zero in a series that's mostly zero isn't news.
    if (zz < 0 && m <= 0) return;
    out.push({ index: i, label: labels[i], value: values[i], ratio: m > 0 ? values[i] / m : 0, kind: zz > 0 ? "spike" : "dip" });
  });
  return out.sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1)).slice(0, 5);
}

export type Forecast = { total: number; low: number; high: number; perDayNow: number; perDayEnd: number; weeksUsed: number; weeklyPct: number; chunks: { days: number; total: number }[] };
/**
 * Straight-line projection of views per day from full weeks, over `days` ahead, with a rough 90% band from how
 * far the weeks already wander from the line. Null below 6 weeks or with no views: too little to project.
 */
export function forecastOf(weeks: Week[], days: number): Forecast | null {
  const full = weeks.filter((w) => w.days === 7);
  if (full.length < 6 || full.every((w) => w.views === 0)) return null;
  const ys = full.map((w) => w.perDay);
  const lr = linreg(ys);
  const n = ys.length;
  let total = 0;
  let low = 0;
  let high = 0;
  const band = 1.645 * lr.residualSd;
  // The same days cut into 7-day pieces (the last can be shorter), so a per-week table adds up to the total.
  const chunks: { days: number; total: number }[] = [];
  for (let d = 0; d < days; d++) {
    const x = n - 1 + (d + 4) / 7; // the line is fitted at each week's middle
    const y = Math.max(0, lr.intercept + lr.slope * x);
    total += y;
    if (d % 7 === 0) chunks.push({ days: 0, total: 0 });
    chunks[chunks.length - 1].days++;
    chunks[chunks.length - 1].total += y;
    low += Math.max(0, y - band);
    high += y + band;
  }
  const m = mean(ys);
  return { total, low, high, perDayNow: Math.max(0, lr.intercept + lr.slope * (n - 1)), perDayEnd: Math.max(0, lr.intercept + lr.slope * (n - 1 + days / 7)), weeksUsed: n, weeklyPct: m > 0 ? (lr.slope / m) * 100 : 0, chunks };
}

// ---------- consistency ----------
export type Consistency = {
  weeks: number;
  perWeek: number[];
  activeWeeks: number;
  avg: number;
  cv: number;
  longestGapDays: number;
  daysSinceLast: number | null;
  verdict: "Very consistent" | "Fairly consistent" | "Irregular" | "Not enough posts";
};
/** How evenly someone posts: weeks with a post, how much the weekly count swings, and the longest gap. */
export function consistencyOf(weeks: Week[], publishTimes: number[], now: number): Consistency {
  const perWeek = weeks.map((w) => w.posts);
  const activeWeeks = perWeek.filter((n) => n > 0).length;
  const avg = mean(perWeek);
  const cv = avg ? stdev(perWeek) / avg : 0;
  const t = [...new Set(publishTimes)].sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < t.length; i++) gap = Math.max(gap, (t[i] - t[i - 1]) / DAY_MS);
  const daysSinceLast = t.length ? (now - t[t.length - 1]) / DAY_MS : null;
  if (daysSinceLast != null) gap = Math.max(gap, daysSinceLast);
  const share = weeks.length ? activeWeeks / weeks.length : 0;
  const verdict = t.length < 3 || weeks.length < 2 ? "Not enough posts" : share >= 0.85 && cv <= 0.5 ? "Very consistent" : share >= 0.6 ? "Fairly consistent" : "Irregular";
  return { weeks: weeks.length, perWeek, activeWeeks, avg, cv, longestGapDays: Math.round(gap), daysSinceLast: daysSinceLast == null ? null : Math.floor(daysSinceLast), verdict };
}

// ---------- relative performance and segments ----------
/**
 * Each post's views as a multiple of the usual (median) for its own platform, so a YouTube video and a tweet can
 * sit in the same table without the bigger platform winning every comparison.
 */
export function relative(posts: StatPost[]) {
  const by = new Map<string, number[]>();
  for (const p of posts) if (p.hasMetrics) by.set(p.platform, [...(by.get(p.platform) ?? []), p.views]);
  const med = new Map([...by].map(([k, v]) => [k, median(v)]));
  // A platform whose usual is 0 views has no baseline, so its posts are left out rather than given a made-up multiple.
  return posts.filter((p) => p.hasMetrics && (med.get(p.platform) ?? 0) > 0).map((p) => {
    const m = med.get(p.platform)!;
    return { p, rel: p.views / m, er: erOf(interactionsOf(p), p.views) };
  });
}

export type Group = { label: string; n: number; rel: number; views: number; er: number | null; enough: boolean };
/** Groups posts by one trait; a group needs `minN` posts before it counts as better or worse. */
export function segment(rows: ReturnType<typeof relative>, keyOf: (p: StatPost) => string | string[] | null, minN = 3): Group[] {
  const g = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = keyOf(r.p);
    for (const key of Array.isArray(k) ? k : k ? [k] : []) g.set(key, [...(g.get(key) ?? []), r]);
  }
  return [...g]
    .map(([label, rs]) => {
      const ers = rs.map((r) => r.er).filter((x): x is number => x != null);
      return { label, n: rs.length, rel: median(rs.map((r) => r.rel)), views: median(rs.map((r) => r.p.views)), er: ers.length ? median(ers) : null, enough: rs.length >= minN };
    })
    .sort((a, b) => Number(b.enough) - Number(a.enough) || b.rel - a.rel);
}

export const captionBucket = (n: number) => (n === 0 ? "No caption" : n < 50 ? "Short caption (under 50 characters)" : n < 150 ? "Medium caption (50 to 150)" : n < 300 ? "Long caption (150 to 300)" : "Very long caption (300+)");
export const hashtagBucket = (n: number) => (n === 0 ? "No hashtags" : n <= 3 ? "1 to 3 hashtags" : n <= 10 ? "4 to 10 hashtags" : "11+ hashtags");

/** "Short video (60s or less)" etc., from the uploaded file. */
export function formatOf(mime: string, duration: number | null) {
  if (mime.startsWith("image/")) return "Image";
  if (duration == null || !Number.isFinite(duration)) return "Video (length unknown)";
  if (duration <= 60) return "Short video (60s or less)";
  if (duration <= 180) return "Mid-length video (1 to 3 min)";
  return "Long video (over 3 min)";
}
export function orientationOf(w: number | null, h: number | null): StatPost["orientation"] {
  if (!w || !h) return null;
  const r = w / h;
  return r < 0.9 ? "Vertical" : r > 1.1 ? "Horizontal" : "Square";
}
export const hashtagsIn = (s: string | null | undefined) => [...new Set(((s ?? "").match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.toLowerCase()))];

export type Quadrants = {
  medianRel: number;
  medianEr: number;
  highReachLowInteraction: ReturnType<typeof relative>;
  lowReachHighInteraction: ReturnType<typeof relative>;
  stars: ReturnType<typeof relative>;
  quiet: ReturnType<typeof relative>;
} | null;
/** Splits posts at the creator's own medians of relative views and engagement rate. Needs 6 posts with views. */
export function quadrants(rows: ReturnType<typeof relative>): Quadrants {
  const xs = rows.filter((r) => r.p.views > 0 && r.er != null);
  if (xs.length < 6) return null;
  const mr = median(xs.map((r) => r.rel));
  const me = median(xs.map((r) => r.er!));
  const q: NonNullable<Quadrants> = { medianRel: mr, medianEr: me, highReachLowInteraction: [], lowReachHighInteraction: [], stars: [], quiet: [] };
  for (const r of xs) {
    const hi = r.rel > mr;
    const eng = r.er! > me;
    (hi && !eng ? q.highReachLowInteraction : !hi && eng ? q.lowReachHighInteraction : hi && eng ? q.stars : q.quiet).push(r);
  }
  for (const k of ["highReachLowInteraction", "lowReachHighInteraction", "stars", "quiet"] as const) q[k].sort((a, b) => b.rel - a.rel);
  return q;
}

// ---------- best times ----------
export type Times = { enough: false; n: number } | { enough: true; n: number; days: Group[]; blocks: Group[] };
/** When posts went out vs how they did, relative to each platform's usual. Needs 10 posts with numbers. */
export function bestTimesOf(rows: ReturnType<typeof relative>, tz: string, minPosts = 10): Times {
  if (rows.length < minPosts) return { enough: false, n: rows.length };
  const when = new Map(rows.map((r) => [r.p.key, localWhen(r.p.publishedAt, tz)]));
  const days = segment(rows, (p) => WEEKDAYS[when.get(p.key)!.weekday], 2);
  const blocks = segment(rows, (p) => blockOf(when.get(p.key)!.hour), 2);
  return { enough: true, n: rows.length, days, blocks };
}

// ---------- one post vs the usual ----------
export type PostLike = {
  title: string;
  platform: string;
  publishedAt: number;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves?: number | null;
  captionLen: number;
  hashtagCount: number;
  duration: number | null;
  format: string;
};
export type Factor = { label: string; post: string; usual: string; note: string; strength: number };

/** What sets one post apart from the creator's other posts on the same platform. Linked, never "caused". */
export function explainPost(p: PostLike, peers: PostLike[], tz: string): { factors: Factor[]; peers: number } {
  const others = peers.filter((x) => x !== p && x.views != null);
  const out: Factor[] = [];
  if (others.length < 3 || p.views == null) return { factors: out, peers: others.length };
  const medV = median(others.map((x) => x.views!));
  const ratio = medV > 0 ? p.views / medV : null;
  if (ratio != null) out.push({ label: "Views", post: fmtInt(p.views), usual: fmtInt(medV), note: `${fmtX(ratio)} your usual`, strength: 10 });
  const inter = (x: PostLike) => (x.likes ?? 0) + (x.comments ?? 0) + (x.shares ?? 0) + (x.saves ?? 0);
  const per1k = (n: number | null | undefined, v: number | null) => (n != null && v ? (n / v) * 1000 : null);
  const er = p.views ? (inter(p) / p.views) * 100 : null;
  const ers = others.map((x) => (x.views ? (inter(x) / x.views) * 100 : null)).filter((x): x is number => x != null);
  if (er != null && ers.length >= 3) {
    const m = median(ers);
    out.push({ label: "Engagement rate", post: fmtRate(er), usual: fmtRate(m), note: m > 0 ? `${fmtX(er / m)} your usual` : "", strength: m > 0 ? Math.abs(Math.log(Math.max(er, 0.01) / m)) * 5 : 0 });
  }
  for (const [label, get] of [["Shares per 1,000 views", (x: PostLike) => per1k(x.shares, x.views)], ["Comments per 1,000 views", (x: PostLike) => per1k(x.comments, x.views)], ["Saves per 1,000 views", (x: PostLike) => per1k(x.saves, x.views)]] as const) {
    const v = get(p);
    const vs = others.map(get).filter((x): x is number => x != null);
    if (v == null || vs.length < 3) continue;
    const m = median(vs);
    if (m <= 0 && v <= 0) continue;
    const r = m > 0 ? v / m : 2;
    if (r >= 1.3 || r <= 0.7) out.push({ label, post: (Math.round(v * 10) / 10).toString(), usual: (Math.round(m * 10) / 10).toString(), note: m > 0 ? `${fmtX(r)} your usual` : "more than usual", strength: Math.abs(Math.log(Math.max(r, 0.01))) * 4 });
  }
  const capM = median(others.map((x) => x.captionLen));
  if (capM > 0 && (p.captionLen >= capM * 1.5 || p.captionLen <= capM * 0.6)) out.push({ label: "Caption length", post: `${p.captionLen} characters`, usual: `${Math.round(capM)} characters`, note: p.captionLen > capM ? "longer than usual" : "shorter than usual", strength: 2 });
  const tagM = median(others.map((x) => x.hashtagCount));
  if (Math.abs(p.hashtagCount - tagM) >= 3) out.push({ label: "Hashtags", post: String(p.hashtagCount), usual: String(Math.round(tagM)), note: p.hashtagCount > tagM ? "more than usual" : "fewer than usual", strength: 1.5 });
  const fmts = new Map<string, number>();
  for (const x of others) fmts.set(x.format, (fmts.get(x.format) ?? 0) + 1);
  const common = [...fmts].sort((a, b) => b[1] - a[1])[0];
  if (common && common[0] !== p.format) out.push({ label: "Format", post: p.format, usual: `${common[0]} (most of your posts)`, note: "a different format from usual", strength: 2.5 });
  if (p.duration != null) {
    const ds = others.map((x) => x.duration).filter((x): x is number => x != null);
    if (ds.length >= 3) {
      const m = median(ds);
      if (m > 0 && (p.duration >= m * 1.5 || p.duration <= m * 0.6)) out.push({ label: "Length", post: `${Math.round(p.duration)}s`, usual: `${Math.round(m)}s`, note: p.duration > m ? "longer than usual" : "shorter than usual", strength: 2 });
    }
  }
  const w = localWhen(p.publishedAt, tz);
  const sameSlot = others.filter((x) => {
    const o = localWhen(x.publishedAt, tz);
    return o.weekday === w.weekday && blockOf(o.hour) === blockOf(w.hour);
  });
  out.push({ label: "Posted", post: `${WEEKDAYS[w.weekday]}, ${blockOf(w.hour).toLowerCase()}`, usual: sameSlot.length ? `${sameSlot.length} other posts went out then` : "you rarely post then", note: "", strength: 0.5 });
  return { factors: out.sort((a, b) => b.strength - a.strength), peers: others.length };
}

// ---------- proactive insights ----------
export type Insight = { id: string; level: "warn" | "info" | "good"; title: string; body: string; evidence: string; ask: string };
export type InsightInput = {
  /** Full weeks, oldest first. */
  weeks: Week[];
  postsLast14: number;
  postsPrev28: number;
  scheduledNoCaption: number;
  formats: Group[];
};
/**
 * At most three things worth saying when Pip opens, each with the numbers behind it. Thresholds are strict on
 * purpose: a creator who sees a nudge every time stops reading them.
 */
export function insightsFrom(x: InsightInput): Insight[] {
  const out: Insight[] = [];
  const full = x.weeks.filter((w) => w.days === 7);
  const last4 = full.slice(-4);
  if (last4.length === 4 && last4.every((w) => w.views >= 100 && w.er != null)) {
    const e = last4.map((w) => w.er!);
    const falling = e[0] > e[1] && e[1] > e[2] && e[2] > e[3];
    if (falling && (e[0] - e[3]) / e[0] >= 0.1)
      out.push({
        id: `er-down-${last4[3].key}`,
        level: "warn",
        title: "Engagement has dropped three weeks running",
        body: "Fewer people are liking, commenting or sharing per view than a month ago.",
        evidence: `Engagement rate by week: ${e.map((v) => fmtRate(v)).join(", ")} (weeks from ${shortDay(last4[0].key)}).`,
        ask: "Why is my engagement dropping?",
      });
  }
  if (x.postsPrev28 >= 4) {
    const usual = x.postsPrev28 / 2;
    if (x.postsLast14 <= usual * 0.5)
      out.push({
        id: `freq-down-${x.postsLast14}-${x.postsPrev28}`,
        level: "warn",
        title: "You're posting less often",
        body: "Your posting pace has slowed compared with the month before.",
        evidence: `${x.postsLast14} posts in the last 14 days, against ${x.postsPrev28} in the 28 days before (about ${Math.round(usual)} every 14 days).`,
        ask: "Am I posting consistently?",
      });
  }
  if (x.scheduledNoCaption > 0)
    out.push({
      id: `nocap-${x.scheduledNoCaption}`,
      level: "warn",
      title: x.scheduledNoCaption === 1 ? "A scheduled post has no caption" : `${x.scheduledNoCaption} scheduled posts have no caption`,
      body: "They'll go out without any text unless you add one.",
      evidence: `${x.scheduledNoCaption} of your posts scheduled for the next 7 days have an empty caption on at least one platform.`,
      ask: "Show my upcoming scheduled posts",
    });
  const ok = x.formats.filter((g) => g.enough && g.n >= 4);
  if (ok.length >= 2 && ok[0].rel >= 1.5 * ok[ok.length - 1].rel && ok[0].rel >= 1.2)
    out.push({
      id: `fmt-${ok[0].label}`,
      level: "info",
      title: `${ok[0].label} is your strongest format`,
      body: `Those posts usually get more views than your other formats.`,
      evidence: `${ok[0].label}: typically ${fmtX(ok[0].rel)} your usual views across ${ok[0].n} posts; ${ok[ok.length - 1].label}: ${fmtX(ok[ok.length - 1].rel)} across ${ok[ok.length - 1].n}.`,
      ask: "Which formats work best for me?",
    });
  const t = trendOf(full.map((w) => w.perDay));
  if (t.enough && t.significant && t.direction === "up")
    out.push({
      id: `views-up-${full[full.length - 1]?.key}`,
      level: "good",
      title: "Your views are on a real upswing",
      body: "Views per day have risen steadily, more than chance would explain.",
      evidence: `About ${fmtSigned(t.weeklyPct)} a week over ${t.n} weeks (${fmtP(t.p!)}).`,
      ask: "Show my views trend",
    });
  const rank = { warn: 0, info: 1, good: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]).slice(0, 3);
}

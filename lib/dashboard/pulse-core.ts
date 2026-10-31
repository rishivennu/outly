/**
 * The analytics dashboard's numbers (1080), the pure part. Tested in tests/round-1080-pulse.test.ts.
 * Days are UTC calendar days, like the Analytics page, so the two always agree.
 */
export const PULSE_RANGES = [7, 30, 90] as const;
export type PulseRange = (typeof PULSE_RANGES)[number];
export const isPulseRange = (n: number): n is PulseRange => (PULSE_RANGES as readonly number[]).includes(n);

export type Series = { views: number[]; interactions: number[]; posts: number[] };
export type TopPost = { postId: string; title: string; thumbnailUrl: string | null; platform: string; views: number };
export interface Pulse {
  days: PulseRange;
  /** ISO dates (YYYY-MM-DD) of the current period, oldest first. */
  dates: string[];
  /** Platforms with an account or any numbers, in PLATFORMS order. */
  platforms: string[];
  /** "all" plus one per platform; arrays line up with `dates`. */
  cur: Record<string, Series>;
  prev: Record<string, Series>;
  /** Top five posts by views in this period, "all" and per platform. */
  top: Record<string, TopPost[]>;
  hasData: boolean;
}

export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** `days` day keys ending today (UTC). */
export function dayKeys(now: number, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(now - i * 864e5));
  return out;
}

const empty = (n: number): Series => ({ views: Array(n).fill(0), interactions: Array(n).fill(0), posts: Array(n).fill(0) });

export type MetricIn = { at: number; platform: string; postId: string; views: number; likes: number; comments: number; shares: number };
export type SentIn = { at: number; platform: string };

/** Buckets metric snapshots and sent posts into the current and previous period, per platform and overall. */
export function bucket(now: number, days: number, platforms: readonly string[], metrics: MetricIn[], sent: SentIn[]) {
  const curKeys = dayKeys(now, days);
  const prevKeys = dayKeys(now - days * 864e5, days);
  const ci = new Map(curKeys.map((k, i) => [k, i]));
  const pi = new Map(prevKeys.map((k, i) => [k, i]));
  const keys = ["all", ...platforms];
  const cur = Object.fromEntries(keys.map((k) => [k, empty(days)])) as Record<string, Series>;
  const prev = Object.fromEntries(keys.map((k) => [k, empty(days)])) as Record<string, Series>;
  const add = (s: Record<string, Series>, plat: string, i: number, f: keyof Series, v: number) => {
    s.all[f][i] += v;
    if (s[plat]) s[plat][f][i] += v;
  };
  const perPost = new Map<string, number>();
  for (const m of metrics) {
    const k = dayKey(m.at);
    const inter = m.likes + m.comments + m.shares;
    const c = ci.get(k);
    if (c !== undefined) {
      add(cur, m.platform, c, "views", m.views);
      add(cur, m.platform, c, "interactions", inter);
      const pk = `${m.postId}|${m.platform}`;
      perPost.set(pk, (perPost.get(pk) ?? 0) + m.views);
    } else {
      const p = pi.get(k);
      if (p !== undefined) {
        add(prev, m.platform, p, "views", m.views);
        add(prev, m.platform, p, "interactions", inter);
      }
    }
  }
  for (const s of sent) {
    const k = dayKey(s.at);
    const c = ci.get(k);
    if (c !== undefined) add(cur, s.platform, c, "posts", 1);
    else {
      const p = pi.get(k);
      if (p !== undefined) add(prev, s.platform, p, "posts", 1);
    }
  }
  const ranked = [...perPost].map(([k, views]) => ({ postId: k.split("|")[0], platform: k.split("|")[1], views })).sort((a, b) => b.views - a.views);
  return { dates: curKeys, cur, prev, ranked };
}

export const total = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** Percent change, or null when there is nothing to compare with (a first week reads "New", not "+Infinity%"). */
export function delta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

/** Interactions per hundred views. */
export const rate = (interactions: number, views: number) => (views ? (interactions / views) * 100 : 0);

/** Resample a series to `n` points (linear), so a 7-day line can morph into a 90-day one point for point. */
export function resample(a: number[], n: number): number[] {
  if (!a.length) return Array(n).fill(0);
  if (a.length === 1) return Array(n).fill(a[0]);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (a.length - 1);
    const lo = Math.floor(x);
    const hi = Math.min(a.length - 1, lo + 1);
    out.push(a[lo] + (a[hi] - a[lo]) * (x - lo));
  }
  return out;
}

/** A round axis top: 1, 2, 2.5 or 5 times a power of ten, at least the max. */
export function niceMax(v: number): number {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** 1,234 / 12.3K / 4.5M: short enough for a KPI card or an axis. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a < 10_000) return Math.round(n).toLocaleString("en-US");
  if (a < 1_000_000) return `${(n / 1000).toFixed(a < 100_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * 1154: when a change between two periods may be shown, and what to say instead when it may not. Pure, so Home
 * (PulseHome) and Analytics (AnalyticsView) apply one rule and never disagree. Tested in tests/round-1154-trend.test.ts.
 *
 * Stored numbers are increments written by the metric sync (lib/insights/post.ts snapshotTarget), so:
 *  - a period the sync has not covered yet is unknown, not zero (no "-100%" because a sync is late);
 *  - a previous period that started before Outlly began counting holds only part of its views (and a post's first
 *    snapshot carries everything it gathered before that), so comparing with it says nothing true.
 */
export type Trend =
  | { kind: "change"; pct: number }
  /** Nothing in the period before, numbers in this one. */
  | { kind: "new" }
  /** Nothing in either period. */
  | { kind: "none" }
  /** Outlly started counting after the period before began: no fair comparison yet. */
  | { kind: "history" }
  /** Nothing stored for this period and no sync has confirmed that since it began. */
  | { kind: "pending" }
  /** The newest sync is over a day and a half older than the period's end, so this period is still incomplete. */
  | { kind: "stale" };

export interface Coverage {
  /** Earliest metric row ever stored for this scope (ms), null when none ever was. */
  trackedSince: number | null;
  /** Metric rows stored inside the current period. */
  rows: number;
  /** Newest successful sync of an account in this scope (ms), or null. */
  lastSync: number | null;
}
export interface Periods {
  curStart: number;
  prevStart: number;
  /** Exclusive end of the current period (ms); omitted means it runs until now. */
  curEnd?: number;
}

/** A day of slack: a period's first snapshot usually lands some hours after its midnight. */
const SLACK_MS = 864e5;
/** Syncs run several times a day; one older than this means the period is missing numbers, not that they fell. */
export const STALE_MS = 36 * 3600e3;

/** Percent change between two periods, only when the comparison is fair. Without `cov` (counts Outlly owns, like posts sent) only the zero rules apply. */
export function trend(cur: number, prev: number, p: Periods, cov?: Coverage | null, now: number = Date.now()): Trend {
  if (!cur && !prev) return { kind: "none" };
  if (cov) {
    // Numbers but no first row (the lookup failed): coverage is unknown, so do not compare.
    if (cov.trackedSince === null) return { kind: "history" };
    if (cov.trackedSince > p.prevStart + SLACK_MS) return { kind: "history" };
    if (!cur && !cov.rows && (cov.lastSync === null || cov.lastSync < p.curStart)) return { kind: "pending" };
    if (cov.lastSync !== null && cov.lastSync < Math.min(now, p.curEnd ?? now) - STALE_MS) return { kind: "stale" };
  }
  if (!prev) return { kind: "new" };
  return { kind: "change", pct: ((cur - prev) / prev) * 100 };
}

/** For downloads (PDF/CSV): the earlier number only when a comparison is fair, else null plus the reason in words. */
export function fairPrevious(cur: number, prev: number, p: Periods, cov?: Coverage | null): { previousViews: number | null; compareNote: string | null } {
  const t = trend(cur, prev, p, cov);
  return t.kind === "change" ? { previousViews: prev, compareNote: null } : { previousViews: null, compareNote: TREND_LONG[t.kind] };
}

/** A rate's change in percentage points (engagement). Same gates, judged on the views behind it; no views, no rate. */
export function pointsTrend(rate: number, prevRate: number, views: number, prevViews: number, p: Periods, cov?: Coverage | null): Trend {
  const base = trend(views, prevViews, p, cov);
  if (base.kind !== "change") return base;
  if (!views) return { kind: "none" };
  return { kind: "change", pct: rate - prevRate };
}

/** Badge words: short enough for a two-column card on a 320px phone. */
export const TREND_SHORT: Record<Exclude<Trend["kind"], "change">, string> = { new: "New", none: "No data", history: "No history", pending: "Not synced", stale: "Syncing" };
/** The same, said in full (screen readers and the tooltip). */
export const TREND_LONG: Record<Exclude<Trend["kind"], "change">, string> = {
  new: "Nothing in the period before to compare with.",
  none: "No numbers in this period or the one before.",
  history: "Outlly started counting recently, so there is nothing fair to compare with yet.",
  pending: "No numbers have synced for this period yet.",
  stale: "The last sync was over a day ago, so this period is not complete yet.",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Below these a "best day" is noise, not a pattern. */
export const BEST_DAY_MIN = { days: 14, views: 100, activeDays: 7, perWeekday: 2, lift: 1.25 } as const;

/**
 * "Mondays bring you the most views" only when the range can show a pattern: at least two of every weekday, enough
 * views on enough days, the day itself busy on two or more dates and still clearly ahead with its single biggest
 * date left out (so one viral post is not called a habit). The lift reported is that cautious one.
 * Days are UTC calendar days, like every other number on the page.
 */
export function bestWeekday(series: { date: string; views: number }[]): { day: string; lift: number } | null {
  if (series.length < BEST_DAY_MIN.days) return null;
  const sum = Array(7).fill(0) as number[];
  const n = Array(7).fill(0) as number[];
  const busy = Array(7).fill(0) as number[];
  for (const s of series) {
    const wd = new Date(`${s.date}T00:00:00Z`).getUTCDay();
    sum[wd] += s.views;
    n[wd]++;
    if (s.views > 0) busy[wd]++;
  }
  const total = sum.reduce((a, b) => a + b, 0);
  const active = series.filter((s) => s.views > 0).length;
  if (total < BEST_DAY_MIN.views || active < BEST_DAY_MIN.activeDays || n.some((c) => c < BEST_DAY_MIN.perWeekday)) return null;
  const mean = sum.map((s, i) => s / n[i]);
  const best = mean.indexOf(Math.max(...mean));
  // One viral day is not a weekly habit: the day must still lead, by the same margin, with its biggest date left out,
  // and must be busy on two or more dates besides that one.
  const top = series.reduce((m, s) => (s.views > m.views ? s : m), series[0]);
  const topWd = new Date(`${top.date}T00:00:00Z`).getUTCDay();
  if (busy[best] - (best === topWd && top.views > 0 ? 1 : 0) < BEST_DAY_MIN.perWeekday) return null;
  const without = (i: number) => (sum[i] - (i === topWd ? top.views : 0)) / (n[i] - (i === topWd ? 1 : 0));
  const rest = (total - top.views) / (series.length - 1);
  if (!rest || without(best) < Math.max(...mean.map((_, i) => without(i)))) return null;
  const lift = without(best) / rest;
  if (lift < BEST_DAY_MIN.lift) return null;
  return { day: WEEKDAYS[best], lift };
}

/** Below these "X is where you are landing hardest" is not a claim worth making. */
export const LEAD_MIN = { views: 50, share: 0.5, overNext: 1.5 } as const;

/** The platform that brought most of the views, only when there is a real field to lead (two platforms or more) and a clear lead. */
export function leadPlatform<T extends { platform: string; views: number }>(rows: T[]): { row: T; share: number } | null {
  const ranked = rows.filter((r) => r.views > 0).sort((a, b) => b.views - a.views);
  const total = ranked.reduce((a, r) => a + r.views, 0);
  if (ranked.length < 2 || total < LEAD_MIN.views) return null;
  const share = ranked[0].views / total;
  if (share < LEAD_MIN.share || ranked[0].views < ranked[1].views * LEAD_MIN.overNext) return null;
  // Never "100%" while another platform has views.
  return { row: ranked[0], share: Math.min(99, Math.round(share * 100)) };
}

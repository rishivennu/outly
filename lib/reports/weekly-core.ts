/** Pure parts of the Monday report, unit-tested without a database. */
export interface ReportTarget {
  platform: string;
  publishedAt: Date | null;
  title: string;
  views: number;
  likes: number;
  comments: number;
}

export interface WeeklyStats {
  published: number;
  views: number;
  likes: number;
  comments: number;
  byPlatform: { platform: string; posts: number; views: number }[];
  top: { title: string; platform: string; views: number } | null;
  upcoming: number;
}

export function summarize(targets: ReportTarget[], upcoming: number): WeeklyStats {
  const by = new Map<string, { posts: number; views: number }>();
  let views = 0, likes = 0, comments = 0;
  let top: WeeklyStats["top"] = null;
  for (const t of targets) {
    views += t.views;
    likes += t.likes;
    comments += t.comments;
    const b = by.get(t.platform) ?? { posts: 0, views: 0 };
    b.posts++;
    b.views += t.views;
    by.set(t.platform, b);
    if (!top || t.views > top.views) top = { title: t.title, platform: t.platform, views: t.views };
  }
  return {
    published: targets.length,
    views, likes, comments,
    byPlatform: [...by.entries()].map(([platform, v]) => ({ platform, ...v })).sort((a, b) => b.views - a.views),
    top: top && top.views > 0 ? top : null,
    upcoming,
  };
}

/** Local weekday (0 = Sunday) and hour in a time zone. */
export function localParts(now: Date, tz: string) {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" });
    const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
    return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), hour: Number(p.hour) };
  } catch {
    return { day: now.getUTCDay(), hour: now.getUTCHours() };
  }
}

/** Due on Monday from 9 am in the creator's own time zone, at most once every 6 days. `force` (cron) skips the clock check. */
export function reportDue(u: { weeklyReport: boolean; lastReportAt: Date | null; timezone: string }, now: Date, force = false) {
  if (!u.weeklyReport) return false;
  if (u.lastReportAt && now.getTime() - u.lastReportAt.getTime() < 6 * 864e5) return false;
  if (force) return true;
  const { day, hour } = localParts(now, u.timezone);
  return day === 1 && hour >= 9;
}

export const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);

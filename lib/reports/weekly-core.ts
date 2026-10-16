import { weekDay, weekStart } from "../retention/core";
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

/* ---------------- Home "Last week" recap (10-16 UX round) ---------------- */


/** Holds last week's key once the creator hides the card. Lives here, not in the client component, so the server can read the real string. */
export const RECAP_COOKIE = "outlly_recap_hide";

/** Monday and Tuesday only: by Wednesday last week is old news and "This week" says enough. */
export const recapVisible = (now: Date, tz: string) => weekDay(now, tz) <= 2;

/** Last week's local Monday 00:00 and this week's, plus a stable key ("2026-10-05") for "hide until next week". */
export function recapWindow(now: Date, tz: string) {
  const thisMonday = weekStart(now, tz);
  const lastMonday = new Date(thisMonday.getTime() - 7 * 864e5);
  // noon, so a DST shift can never push the label into the neighbouring day
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(d.getTime() + 12 * 36e5));
  const short = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(d.getTime() + 12 * 36e5));
  const lastSunday = new Date(thisMonday.getTime() - 864e5);
  return { since: lastMonday, until: thisMonday, key: day(lastMonday), label: `${short(lastMonday)} to ${short(lastSunday)}` };
}

export interface RecapCopy {
  headline: string;
  versus: string | null;
  goal: string | null;
  cta: { label: string; href: string };
}

/**
 * The words on the card. Posts are compared with the week before (a fair count); views are not,
 * because older posts have had longer to collect them.
 */
export function recapCopy(s: Pick<WeeklyStats, "published" | "views" | "upcoming">, prevPublished: number, goal: number): RecapCopy {
  const posts = `${s.published} post${s.published === 1 ? "" : "s"}`;
  const headline = !s.published ? "Nothing went out last week." : s.views > 0 ? `${posts} out, ${compact(s.views)} view${s.views === 1 ? "" : "s"} so far.` : `${posts} out last week.`;
  const versus =
    s.published === prevPublished
      ? prevPublished
        ? "Same as the week before."
        : null
      : s.published > prevPublished
        ? `Up from ${prevPublished} the week before.`
        : `Down from ${prevPublished} the week before.`;
  const goalLine = goal > 0 ? (s.published >= goal ? `You hit your goal of ${goal} a week.` : `${s.published} of your ${goal} a week.`) : null;
  const short = Math.max(0, goal - s.upcoming);
  const cta = short > 0 ? { label: short === 1 ? "Plan one more for this week" : `Plan ${short} more for this week`, href: "/create/bulk" } : { label: "See this week", href: "/calendar" };
  return { headline, versus, goal: goalLine, cta };
}

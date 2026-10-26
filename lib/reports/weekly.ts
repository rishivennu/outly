import "server-only";
import { db } from "../db";
import { env } from "../env";
import { getConfig } from "../settings";
import { sendEmail, templates } from "../email";
import { PLATFORM_META, isPlatform } from "../domain";
import { recapCopy, recapVisible, recapWindow, reportDue, summarize, type RecapCopy, type WeeklyStats } from "./weekly-core";

/** Posts that went out in [since, until), with their latest numbers. `names` swaps platform ids for display names (email). */
async function statsBetween(userId: string, since: Date, until: Date, upcomingWhere: { gt: Date; lt?: Date }, names: boolean): Promise<WeeklyStats> {
  const [targets, upcoming] = await Promise.all([
    db.postTarget.findMany({
      where: { post: { userId }, practice: false, platformStatus: "published", publishedAt: { gte: since, lt: until } },
      select: { platform: true, publishedAt: true, title: true, caption: true, post: { select: { hook: true, title: true } }, metrics: { orderBy: { capturedAt: "desc" }, take: 1, select: { views: true, likes: true, comments: true } } },
      take: 500,
    }),
    db.post.count({ where: { userId, status: "scheduled", scheduledAt: upcomingWhere } }),
  ]);
  return summarize(
    targets.map((t) => ({
      platform: names && isPlatform(t.platform) ? PLATFORM_META[t.platform].name : t.platform,
      publishedAt: t.publishedAt,
      title: (t.title || t.post.title || t.post.hook || t.caption || "Untitled post").split("\n")[0].slice(0, 90),
      views: t.metrics[0]?.views ?? 0,
      likes: t.metrics[0]?.likes ?? 0,
      comments: t.metrics[0]?.comments ?? 0,
    })),
    upcoming,
  );
}

export async function weeklyStats(userId: string, now = new Date()): Promise<WeeklyStats> {
  return statsBetween(userId, new Date(now.getTime() - 7 * 864e5), new Date(now.getTime() + 1), { gt: now }, true);
}

export interface Recap {
  key: string;
  label: string;
  stats: WeeklyStats;
  copy: RecapCopy;
  emailOn: boolean;
}

/**
 * Home "Last week": Monday and Tuesday only, for someone who has posted before. Counts posts (one per post,
 * not per platform) and compares with the week before; views are the latest numbers, so "so far".
 */
export async function lastWeekRecap(u: { id: string; timezone: string; postingGoal: number; weeklyReport: boolean }, now = new Date()): Promise<Recap | null> {
  const tz = u.timezone || "UTC";
  if (!recapVisible(now, tz)) return null;
  const w = recapWindow(now, tz);
  const ever = await db.postTarget.count({ where: { post: { userId: u.id }, practice: false, platformStatus: "published", publishedAt: { lt: w.until } } });
  if (!ever) return null;
  const nextMonday = new Date(w.until.getTime() + 7 * 864e5);
  const [stats, lastPosts, prevPosts] = await Promise.all([
    statsBetween(u.id, w.since, w.until, { gt: now, lt: nextMonday }, false),
    postsOut(u.id, w.since, w.until),
    postsOut(u.id, new Date(w.since.getTime() - 7 * 864e5), w.since),
  ]);
  const s = { ...stats, published: lastPosts };
  return { key: w.key, label: w.label, stats: s, copy: recapCopy(s, prevPosts, u.postingGoal), emailOn: u.weeklyReport };
}

/** Posts (not platform copies) with anything published in the window. */
async function postsOut(userId: string, since: Date, until: Date) {
  const rows = await db.postTarget.findMany({ where: { post: { userId }, practice: false, platformStatus: "published", publishedAt: { gte: since, lt: until } }, select: { postId: true }, distinct: ["postId"] });
  return rows.length;
}

/** Sends to everyone whose Monday report is due. Skips people who never posted (nothing to say). */
export async function sendWeeklyReports(now = new Date(), opts: { force?: boolean; limit?: number } = {}) {
  const users = await db.user.findMany({
    where: { weeklyReport: true, OR: [{ lastReportAt: null }, { lastReportAt: { lt: new Date(now.getTime() - 6 * 864e5) } }], posts: { some: { status: { not: "draft" } } } },
    select: { id: true, name: true, email: true, timezone: true, weeklyReport: true, lastReportAt: true },
    take: opts.limit ?? 50,
  });
  let sent = 0;
  const one = async (u: (typeof users)[number]) => {
    if (!reportDue(u, now, opts.force)) return;
    // claim first, so two instances never send the same report twice
    const claimed = await db.user.updateMany({ where: { id: u.id, OR: [{ lastReportAt: null }, { lastReportAt: u.lastReportAt }] }, data: { lastReportAt: now } });
    if (!claimed.count) return;
    const stats = await weeklyStats(u.id, now);
    await sendEmail({ to: u.email, kind: "weekly_report", subject: stats.published ? `Your week: ${stats.published} post${stats.published === 1 ? "" : "s"} out` : "Your week on Outlly", html: templates.weeklyReport({ name: u.name, stats, url: `${env.APP_URL}/analytics`, settingsUrl: `${env.APP_URL}/settings` }) }).catch(() => {});
    sent++;
  };
  // Five at a time: the run takes about a fifth of the time it did one-by-one, without flooding the DB pool or the mail API.
  for (let i = 0; i < users.length; i += 5) await Promise.all(users.slice(i, i + 5).map(one));
  return { checked: users.length, sent };
}

let lastRun = 0;
/** Called from the in-process sweeper: at most every 10 minutes. */
export async function maybeSendWeeklyReports() {
  if (Date.now() - lastRun < 10 * 60_000) return;
  lastRun = Date.now();
  if ((await getConfig("site")).maintenance) return;
  await sendWeeklyReports();
}

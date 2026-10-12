import "server-only";
import { db } from "../db";
import { env } from "../env";
import { getConfig } from "../settings";
import { sendEmail, templates } from "../email";
import { PLATFORM_META, isPlatform } from "../domain";
import { reportDue, summarize, type WeeklyStats } from "./weekly-core";

export async function weeklyStats(userId: string, now = new Date()): Promise<WeeklyStats> {
  const since = new Date(now.getTime() - 7 * 864e5);
  const [targets, upcoming] = await Promise.all([
    db.postTarget.findMany({
      where: { post: { userId }, practice: false, platformStatus: "published", publishedAt: { gte: since, lte: now } },
      select: { platform: true, publishedAt: true, title: true, caption: true, post: { select: { hook: true, title: true } }, metrics: { orderBy: { capturedAt: "desc" }, take: 1, select: { views: true, likes: true, comments: true } } },
      take: 500,
    }),
    db.post.count({ where: { userId, status: "scheduled", scheduledAt: { gt: now } } }),
  ]);
  return summarize(
    targets.map((t) => ({
      platform: isPlatform(t.platform) ? PLATFORM_META[t.platform].name : t.platform,
      publishedAt: t.publishedAt,
      title: (t.title || t.post.title || t.post.hook || t.caption || "Untitled post").split("\n")[0].slice(0, 90),
      views: t.metrics[0]?.views ?? 0,
      likes: t.metrics[0]?.likes ?? 0,
      comments: t.metrics[0]?.comments ?? 0,
    })),
    upcoming,
  );
}

/** Sends to everyone whose Monday report is due. Skips people who never posted (nothing to say). */
export async function sendWeeklyReports(now = new Date(), opts: { force?: boolean; limit?: number } = {}) {
  const users = await db.user.findMany({
    where: { weeklyReport: true, OR: [{ lastReportAt: null }, { lastReportAt: { lt: new Date(now.getTime() - 6 * 864e5) } }], posts: { some: { status: { not: "draft" } } } },
    select: { id: true, name: true, email: true, timezone: true, weeklyReport: true, lastReportAt: true },
    take: opts.limit ?? 50,
  });
  let sent = 0;
  for (const u of users) {
    if (!reportDue(u, now, opts.force)) continue;
    // claim first, so two instances never send the same report twice
    const claimed = await db.user.updateMany({ where: { id: u.id, OR: [{ lastReportAt: null }, { lastReportAt: u.lastReportAt }] }, data: { lastReportAt: now } });
    if (!claimed.count) continue;
    const stats = await weeklyStats(u.id, now);
    await sendEmail({ to: u.email, kind: "weekly_report", subject: stats.published ? `Your week: ${stats.published} post${stats.published === 1 ? "" : "s"} out` : "Your week on Outlly", html: templates.weeklyReport({ name: u.name, stats, url: `${env.APP_URL}/analytics`, settingsUrl: `${env.APP_URL}/settings` }) }).catch(() => {});
    sent++;
  }
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

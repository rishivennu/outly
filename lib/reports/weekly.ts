import "server-only";
import { db } from "../db";
import { env } from "../env";
import { getConfig } from "../settings";
import { sendEmail, templates } from "../email";
import { PLATFORM_META, isPlatform } from "../domain";
import { entitlements } from "../billing/entitlements";
import { hasPerk } from "../billing/plan-rules";
import { intelligenceBlock, recapCopy, recapVisible, recapWindow, reportDue, summarize, withinEmailBudget, type IntelBlock, type RecapCopy, type WeeklyStats } from "./weekly-core";
import { overview } from "../intelligence/service";
import { weeklyIntelligence, type WeeklyIntelligence } from "../intelligence/report-core";
import { baselineItems, type IntelligencePulse } from "../intelligence/pulse-core";

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

/** R1243: the owner's own brand, last 28 days, judged on the saved objective (overview reads it from the brand profile). */
async function ownerIntelligence(userId: string): Promise<WeeklyIntelligence> {
  return weeklyIntelligence(await overview({ id: userId, scope: null }, { days: 28, accountIds: null }));
}

/** R1325: the owner's Intelligence pulse, for the "Your baselines" section. */
async function ownerPulse(userId: string): Promise<IntelligencePulse | null> {
  return import("../intelligence/pulse").then((m) => m.intelligencePulse(userId));
}

/**
 * R1325: "Your baselines" appended to the block (at most three platforms, each with its sample), plus the same lines
 * in the plain text. A pulse that fails or has nothing measured leaves the block as it was.
 */
export function withBaselines(block: IntelBlock, pulse: IntelligencePulse | null, appUrl: string): IntelBlock {
  const items = baselineItems(pulse);
  if (!items.length) return block;
  const href = `${appUrl.replace(/\/+$/, "")}/intelligence#intel-baselines`;
  const section = { label: "Your baselines", items: items.map((i) => ({ ...i, href: null })) };
  const text = [block.text, "", `${section.label}:`, ...items.map((i) => `- ${i.title}: ${i.detail}`), `Open your baselines: ${href}`].join("\n");
  return { ...block, sections: [...block.sections, section], text };
}

/** R1243: never lets the intelligence block stop the weekly email: any failure is logged and the block is left out. */
export async function intelligenceFor(
  userId: string,
  load: (userId: string) => Promise<WeeklyIntelligence> = ownerIntelligence,
  pulse: (userId: string) => Promise<IntelligencePulse | null> = ownerPulse,
): Promise<IntelBlock | null> {
  try {
    const block = intelligenceBlock(await load(userId), env.APP_URL);
    // R1325: baselines are a bonus; their failure never costs the block.
    const p = await pulse(userId).catch((e) => (console.warn("[weekly] baselines_skipped", userId, e instanceof Error ? e.message : String(e)), null));
    return withBaselines(block, p, env.APP_URL);
  } catch (e) {
    console.warn("[weekly] intelligence_skipped", userId, e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** R1243: the weekly html, with the intelligence block when there is one and it keeps the email under the clip budget. */
export function weeklyHtml(o: { name: string; stats: WeeklyStats; intel: IntelBlock | null }): string {
  const base = { name: o.name, stats: o.stats, url: `${env.APP_URL}/analytics`, settingsUrl: `${env.APP_URL}/settings` };
  if (!o.intel) return templates.weeklyReport(base);
  const html = templates.weeklyReport({ ...base, intel: o.intel });
  if (withinEmailBudget(html)) return html;
  console.warn("[weekly] intelligence_dropped_over_budget");
  return templates.weeklyReport(base);
}

/** Sends to everyone whose Monday report is due. Skips people who never posted (nothing to say). */
export async function sendWeeklyReports(now = new Date(), opts: { force?: boolean; limit?: number; only?: string[]; intel?: (userId: string) => Promise<WeeklyIntelligence>; pulse?: (userId: string) => Promise<IntelligencePulse | null> } = {}) {
  // R1245: `only` narrows a forced run to given users; tests on a shared database use it so they do not send to everyone.
  const users = await db.user.findMany({
    where: { ...(opts.only ? { id: { in: opts.only } } : {}), weeklyReport: true, OR: [{ lastReportAt: null }, { lastReportAt: { lt: new Date(now.getTime() - 6 * 864e5) } }], posts: { some: { status: { not: "draft" } } } },
    select: { id: true, name: true, email: true, timezone: true, weeklyReport: true, lastReportAt: true },
    take: opts.limit ?? 50,
  });
  let sent = 0;
  const one = async (u: (typeof users)[number]) => {
    if (!reportDue(u, now, opts.force)) return;
    // claim first, so two instances never send the same report twice
    const claimed = await db.user.updateMany({ where: { id: u.id, OR: [{ lastReportAt: null }, { lastReportAt: u.lastReportAt }] }, data: { lastReportAt: now } });
    if (!claimed.count) return;
    // Plans without the digest perk (1096) still get claimed above, so they don't sit "due" and crowd every batch.
    if (!hasPerk(await entitlements(u.id), "weekly-digest")) return;
    const [stats, intel] = await Promise.all([weeklyStats(u.id, now), intelligenceFor(u.id, opts.intel, opts.pulse)]);
    await sendEmail({ to: u.email, kind: "weekly_report", subject: stats.published ? `Your week: ${stats.published} post${stats.published === 1 ? "" : "s"} out` : "Your week on Outlly", html: weeklyHtml({ name: u.name, stats, intel }) }).catch(() => {});
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

import "server-only";
import { db } from "../db";
import { env } from "../env";
import { getConfig } from "../settings";
import { sendEmail, templates } from "../email";
import { goalState, noticeKey, nudgeDue, weekStamp } from "./core";
import { notify, sweepAccountHealth } from "./notices";

/** One date per real post (practice runs excluded): when its first platform went live. */
export async function publishedDates(userId: string, since: Date) {
  const rows = await db.postTarget.findMany({
    where: { post: { userId }, practice: false, platformStatus: "published", publishedAt: { gte: since } },
    select: { postId: true, publishedAt: true },
    take: 2000,
  });
  const first = new Map<string, number>();
  for (const r of rows) {
    const t = r.publishedAt!.getTime();
    if (!first.has(r.postId) || t < first.get(r.postId)!) first.set(r.postId, t);
  }
  return [...first.values()].map((t) => new Date(t));
}

export async function goalFor(u: { id: string; postingGoal: number; timezone: string }, now = new Date()) {
  return goalState(await publishedDates(u.id, new Date(now.getTime() - 13 * 7 * 864e5)), u.postingGoal, now, u.timezone);
}

/** Friday nudge for creators behind on their own weekly goal. Only people who have posted before, at most once a week. */
export async function sendGoalNudges(now = new Date()) {
  const users = await db.user.findMany({
    where: { postingGoal: { gt: 0 }, OR: [{ nudgeAt: null }, { nudgeAt: { lt: new Date(now.getTime() - 5 * 864e5) } }], posts: { some: { status: { in: ["published", "partial"] } } } },
    select: { id: true, name: true, email: true, timezone: true, postingGoal: true, nudgeAt: true },
    take: 100,
  });
  let sent = 0;
  for (const u of users) {
    const g = await goalFor(u, now);
    if (!nudgeDue(u, g.done, now)) continue;
    const claimed = await db.user.updateMany({ where: { id: u.id, OR: [{ nudgeAt: null }, { nudgeAt: u.nudgeAt }] }, data: { nudgeAt: now } });
    if (!claimed.count) continue;
    const left = g.goal - g.done;
    await notify(u.id, {
      kind: "goal_nudge",
      tone: "info",
      title: `${left} more post${left === 1 ? "" : "s"} to hit your goal`,
      body: `${g.done} of ${g.goal} out this week. The weekend is still yours.`,
      href: "/create",
      action: "Create a post",
      key: noticeKey.nudge(u.id, weekStamp(now, u.timezone)),
    });
    await sendEmail({
      to: u.email,
      kind: "nudge",
      subject: `${left} more post${left === 1 ? "" : "s"} to hit your weekly goal`,
      html: templates.nudge({ name: u.name.split(" ")[0], done: g.done, goal: g.goal, streak: g.streak, url: `${env.APP_URL}/create`, settingsUrl: `${env.APP_URL}/home#goal` }),
    }).catch(() => {});
    sent++;
  }
  return { checked: users.length, sent };
}

let lastRun = 0;
/** From the in-process sweeper: account health and goal nudges, at most every 10 minutes, never in maintenance. */
export async function maybeRunRetention() {
  if (Date.now() - lastRun < 10 * 60_000) return;
  lastRun = Date.now();
  if ((await getConfig("site")).maintenance) return;
  await sweepAccountHealth().catch((e) => console.error("[retention] accounts", e));
  await sendGoalNudges().catch((e) => console.error("[retention] nudges", e));
}

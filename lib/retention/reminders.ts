import "server-only";
import { db } from "../db";
import { PLATFORM_META, isPlatform } from "../domain";
import { isPracticeAccount } from "../social/registry";
import { LEADS } from "../notify-core";
import { loadNotifyPrefs } from "../notify";
import { notify } from "./notices";

/*
 * 1118: "Your YouTube post goes live in 15 minutes." Run by the minute sweeper. A post gets one reminder per
 * scheduled time (moving it makes a new one), at the lead time its owner picked. Practice-only posts stay quiet.
 */

const MAX_LEAD = Math.max(...LEADS);
const names = (ps: string[]) => {
  const n = [...new Set(ps)].map((p) => (isPlatform(p) ? PLATFORM_META[p].name : p));
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
};

/** Pure: does a post scheduled `minutesLeft` from now get its reminder, for this lead? */
export const reminderDue = (minutesLeft: number, lead: number) => minutesLeft > 0 && minutesLeft <= lead;
export const remindKey = (postId: string, at: Date) => `remind:${postId}:${at.getTime()}`;
export const inWords = (m: number) => (m >= 60 ? "1 hour" : m === 1 ? "1 minute" : `${m} minutes`);

export async function sweepReminders(now = new Date()) {
  const posts = await db.post.findMany({
    where: { status: "scheduled", scheduledAt: { gt: now, lte: new Date(now.getTime() + MAX_LEAD * 60_000) } },
    select: { id: true, userId: true, title: true, hook: true, scheduledAt: true, targets: { select: { platform: true, practice: true, socialAccount: { select: { id: true, platformUserId: true } } } } },
    take: 300,
  });
  const leads = new Map<string, { on: boolean; lead: number }>();
  let sent = 0;
  for (const p of posts) {
    const real = p.targets.filter((t) => !t.practice && !(t.socialAccount && isPracticeAccount(t.socialAccount)));
    if (!real.length || !p.scheduledAt) continue;
    if (!leads.has(p.userId)) {
      const pr = await loadNotifyPrefs(p.userId);
      leads.set(p.userId, { on: pr.ev.remind, lead: pr.lead });
    }
    const pref = leads.get(p.userId)!;
    const left = Math.ceil((p.scheduledAt.getTime() - now.getTime()) / 60_000);
    if (!pref.on || !reminderDue(left, pref.lead)) continue;
    const key = remindKey(p.id, p.scheduledAt);
    if (await db.notice.findUnique({ where: { key }, select: { id: true } })) continue;
    const title = (p.title || p.hook || "").split("\n")[0].slice(0, 60);
    const where = names(real.map((t) => t.platform));
    const r = await notify(
      p.userId,
      {
        kind: "remind",
        tone: "info",
        title: "Upcoming post",
        body: `${title ? `"${title}" ` : `Your ${where} post `}goes live${title ? ` on ${where}` : ""} in ${inWords(left)}.`,
        href: `/create?post=${p.id}`,
        action: "Review it",
        key,
      },
      { now, minutesLeft: left },
    );
    if (r.created) sent++;
  }
  // A reminder is only news until its post goes out: file the old ones as read.
  await db.notice.updateMany({ where: { kind: "remind", readAt: null, createdAt: { lt: new Date(now.getTime() - 2 * 3600_000) } }, data: { readAt: now } });
  return { checked: posts.length, sent };
}

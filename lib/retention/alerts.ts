import "server-only";
import { db } from "../db";
import { PLATFORM_META, isPlatform } from "../domain";
import { isPracticeAccount } from "../social/registry";
import { dayStamp, parseAlertPrefs, spikeLabel, spikeRatio } from "../alerts-core";
import { noticeKey } from "./core";
import { notify } from "./notices";

const CHUNK = 500;

type Acct = { id: string; platform: string; platformUserId: string; username: string | null; userId: string; user: { alertPrefs: string | null; timezone: string } };

/**
 * Engagement spikes (1037): an account whose views in the last 24 hours beat its daily average of the 7 days
 * before by the owner's chosen multiple. Built for scale: accounts are walked in pages of 500 by id, practice
 * accounts and owners who switched spikes off are dropped before any metric is read, and the database sums
 * views per post target only for that page's accounts (the (targetId, capturedAt) index serves both windows).
 * One alert per account per local day, so a long spike never repeats.
 */
export async function sweepSpikes(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 864e5);
  const weekBefore = new Date(dayAgo.getTime() - 7 * 864e5);
  let cursor: string | undefined;
  let checked = 0;
  let sent = 0;
  for (;;) {
    const page: Acct[] = await db.socialAccount.findMany({
      where: { status: { not: "disconnected" } },
      select: { id: true, platform: true, platformUserId: true, username: true, userId: true, user: { select: { alertPrefs: true, timezone: true } } },
      orderBy: { id: "asc" },
      take: CHUNK,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!page.length) break;
    cursor = page[page.length - 1].id;
    const live = page.filter((a) => !isPracticeAccount(a) && parseAlertPrefs(a.user.alertPrefs).spike);
    if (live.length) {
      const r = await sweepPage(live, now, dayAgo, weekBefore);
      checked += r.checked;
      sent += r.sent;
    }
    if (page.length < CHUNK) break;
  }
  return { checked, sent };
}

async function sweepPage(accts: Acct[], now: Date, dayAgo: Date, weekBefore: Date) {
  const ids = accts.map((a) => a.id);
  // Target -> account, only for real (non-practice) targets with numbers in the 8-day window.
  const targets = await db.postTarget.findMany({
    where: { socialAccountId: { in: ids }, practice: false, metrics: { some: { capturedAt: { gte: weekBefore, lte: now } } } },
    select: { id: true, socialAccountId: true },
  });
  if (!targets.length) return { checked: 0, sent: 0 };
  const owner = new Map(targets.map((t) => [t.id, t.socialAccountId!]));
  const inPage = { socialAccountId: { in: ids }, practice: false };
  const [today, before] = await Promise.all([
    db.targetMetric.groupBy({ by: ["targetId"], where: { capturedAt: { gte: dayAgo, lte: now }, target: inPage }, _sum: { views: true } }),
    db.targetMetric.groupBy({ by: ["targetId"], where: { capturedAt: { gte: weekBefore, lt: dayAgo }, target: inPage }, _sum: { views: true } }),
  ]);
  const sum = (groups: typeof today) => {
    const m = new Map<string, number>();
    for (const g of groups) {
      const a = owner.get(g.targetId);
      if (a) m.set(a, (m.get(a) ?? 0) + (g._sum.views ?? 0));
    }
    return m;
  };
  const last24 = sum(today);
  const prior = sum(before);

  let checked = 0;
  let sent = 0;
  for (const a of accts) {
    const views = last24.get(a.id) ?? 0;
    if (views <= 0) continue;
    checked++;
    const prefs = parseAlertPrefs(a.user.alertPrefs);
    const r = spikeRatio(views, prior.get(a.id) ?? 0, prefs.spikeX);
    if (r === null) continue;
    const name = isPlatform(a.platform) ? PLATFORM_META[a.platform].name : a.platform;
    const who = a.username ? `@${a.username.replace(/^@/, "")}` : name;
    const res = await notify(
      a.userId,
      {
        kind: "engagement_spike",
        tone: "info",
        title: `${who} is taking off on ${name}`,
        body: `${views.toLocaleString("en-US")} views in the last 24 hours, ${spikeLabel(r)}. A good moment to reply to comments or post a follow-up.`,
        href: `/analytics?account=${encodeURIComponent(a.id)}`,
        action: "See the numbers",
        key: noticeKey.spike(a.id, dayStamp(now, a.user.timezone)),
      },
      { email: prefs.email },
    );
    if (res.created) sent++;
  }
  return { checked, sent };
}

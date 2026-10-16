import "server-only";
import { db } from "../db";
import { getAnalytics } from "../analytics";
import { getBestTimes } from "../schedule/best-time-server";
import { isPlatform, type Platform } from "../domain";
import { weekStart } from "./core";
import { pctChange, weekStrip, type StripDay } from "./pulse-core";

export interface SendingItem {
  id: string;
  title: string;
  targets: { platform: Platform; status: string }[];
}
export interface Pulse {
  sending: SendingItem[];
  views: number;
  viewsChange: number | null;
  postsOut: number;
  top: { postId: string; title: string; views: number } | null;
  best: { label: string; at: string; source: "yours" | "typical" } | null;
  strip: StripDay[];
}

/** Home "This week" + "Sending now". Every part degrades on its own, so one slow source never blanks the card. */
export async function homePulse(u: { id: string; timezone: string }, platforms: Platform[], now = new Date()): Promise<Pulse> {
  const tz = u.timezone || "UTC";
  const monday = weekStart(now, tz);
  const sunday = new Date(monday.getTime() + 7 * 864e5);
  const [sending, analytics, best, out, lined] = await Promise.all([
    db.post.findMany({
      where: { userId: u.id, status: "publishing" },
      select: { id: true, title: true, hook: true, targets: { where: { practice: false }, select: { platform: true, platformStatus: true } } },
      orderBy: { updatedAt: "desc" },
      take: 3,
    }),
    getAnalytics(u.id, 7).catch(() => null),
    platforms.length ? getBestTimes(u.id, platforms, tz).catch(() => null) : Promise.resolve(null),
    db.postTarget.findMany({ where: { post: { userId: u.id }, practice: false, platformStatus: "published", publishedAt: { gte: monday, lt: sunday } }, select: { postId: true, publishedAt: true } }),
    db.post.findMany({ where: { userId: u.id, status: "scheduled", scheduledAt: { gte: monday, lt: sunday } }, select: { scheduledAt: true } }),
  ]);
  // One dot per post per day, not per platform.
  const firstOut = new Map<string, Date>();
  for (const t of out) if (t.publishedAt && (!firstOut.has(t.postId) || t.publishedAt < firstOut.get(t.postId)!)) firstOut.set(t.postId, t.publishedAt);
  const slot = best?.slots.find((s) => new Date(s.at) > now) ?? null;
  return {
    sending: sending
      .filter((p) => p.targets.length)
      .map((p) => ({
        id: p.id,
        title: (p.title || p.hook || "Untitled post").split("\n")[0].slice(0, 70),
        targets: p.targets.filter((t) => isPlatform(t.platform)).map((t) => ({ platform: t.platform as Platform, status: t.platformStatus })),
      })),
    views: analytics?.totals.views ?? 0,
    viewsChange: analytics ? pctChange(analytics.totals.views, analytics.previous.views) : null,
    postsOut: firstOut.size,
    top: analytics?.top ? { postId: analytics.top.postId, title: analytics.top.title, views: analytics.top.views } : null,
    best: slot && best ? { label: slot.label, at: slot.at, source: best.source } : null,
    strip: weekStrip(monday, now, tz, [...firstOut.values()], lined.map((p) => p.scheduledAt!).filter(Boolean)),
  };
}

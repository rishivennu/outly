import "server-only";
import { db } from "@/lib/db";
import { cached } from "@/lib/cache";
import { PLATFORM_META, isPlatform } from "@/lib/domain";
import { channelStats, growthFunnel } from "@/lib/admin/growth";
import { channelLabel, type FunnelStep } from "@/lib/growth/core";
import { countryName, perDay, rangeStartUtc } from "./outlly-core";
import type { RangeDays } from "./posthog-query";

export interface OutllyReport {
  days: RangeDays;
  totals: { signups: number; waitlist: number; active: number; activeToday: number; published: number };
  daily: { day: string; signups: number; waitlist: number; published: number }[];
  funnel: FunnelStep[];
  sources: { label: string; signups: number; posted: number; paid: number }[];
  countries: { country: string; signups: number }[];
  platforms: { platform: string; posts: number }[];
}

const CAP = 50_000;

/**
 * 1151: the "Outlly data" side of Admin > Analytics, from our own tables. Counts are exact for the range;
 * the per-day rows read at most 50,000 dates each, far beyond today's volume. Cached for a minute.
 */
export function outllyReport(days: RangeDays, now = new Date()): Promise<OutllyReport> {
  return cached(`outlly-analytics:${days}`, 60_000, async () => {
    const since = rangeStartUtc(days, now);
    const born = { createdAt: { gte: since } };
    const live = { practice: false, platformStatus: "published", publishedAt: { gte: since } };
    const [users, waits, posts, active, activeToday, funnel, channels, countries, signups, waitlist, published] = await Promise.all([
      db.user.findMany({ where: born, select: { createdAt: true }, take: CAP }),
      db.waitlistEntry.findMany({ where: born, select: { createdAt: true }, take: CAP }),
      db.postTarget.findMany({ where: live, select: { publishedAt: true, platform: true }, take: CAP }),
      db.user.count({ where: { lastSeenAt: { gte: since } } }),
      db.user.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - 864e5) } } }),
      growthFunnel(since),
      channelStats(since),
      db.user.groupBy({ by: ["locCountry"], where: born, _count: { _all: true } }),
      db.user.count({ where: born }),
      db.waitlistEntry.count({ where: born }),
      db.postTarget.count({ where: live }),
    ]);
    const s = perDay(users.map((u) => u.createdAt), days, now);
    const w = perDay(waits.map((x) => x.createdAt), days, now);
    const p = perDay(posts.map((x) => x.publishedAt), days, now);
    const byPlatform = new Map<string, number>();
    for (const t of posts) byPlatform.set(t.platform, (byPlatform.get(t.platform) ?? 0) + 1);
    const byCountry = new Map<string, number>();
    for (const c of countries) {
      const k = countryName(c.locCountry);
      byCountry.set(k, (byCountry.get(k) ?? 0) + c._count._all);
    }
    return {
      days,
      totals: { signups, waitlist, active, activeToday, published },
      daily: s.map((d, i) => ({ day: d.day, signups: d.count, waitlist: w[i].count, published: p[i].count })),
      funnel,
      sources: channels.slice(0, 10).map((c) => ({ label: [channelLabel(c.source), c.medium, c.campaign].filter(Boolean).join(" / "), signups: c.signups, posted: c.posted, paid: c.paid })),
      countries: [...byCountry].map(([country, n]) => ({ country, signups: n })).sort((a, b) => b.signups - a.signups).slice(0, 10),
      platforms: [...byPlatform].map(([k, n]) => ({ platform: isPlatform(k) ? PLATFORM_META[k].name : k, posts: n })).sort((a, b) => b.posts - a.posts),
    };
  });
}

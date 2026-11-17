import "server-only";
import { db } from "../db";
import { cached } from "../cache";
import { PLATFORM_META, isPlatform } from "../domain";
import { countryName } from "../analytics/outlly-core";
import { buildAnalytics, type AnalyticsWindow, type OutllyAnalytics } from "./analytics-core";
import { dayKey } from "./activation";

const CAP = 50_000;

/** 1166: Outlly's own records for Admin > Analytics, for a preset or custom window. Several admins share one read a minute. */
export function outllyAnalytics(w: AnalyticsWindow): Promise<OutllyAnalytics & { generatedAt: string }> {
  return cached(`admin:analytics:${w.from}:${w.to}`, 60_000, async () => {
    const now = new Date();
    const from = new Date(w.from + "T00:00:00Z");
    const end = new Date(Date.parse(w.to + "T00:00:00Z") + 86_400_000);
    const born = { createdAt: { gte: from, lt: end } };
    const [users, waitlist, accountEmails, connected, publishers, paying, activity, published] = await Promise.all([
      db.user.findMany({ where: born, select: { id: true, email: true, createdAt: true, signupSource: true, locCountry: true }, take: CAP }),
      db.waitlistEntry.findMany({ where: born, select: { email: true, createdAt: true }, take: CAP }),
      db.user.findMany({ select: { email: true }, take: CAP }),
      db.socialAccount.findMany({ select: { userId: true }, distinct: ["userId"], take: CAP }),
      db.post.findMany({ where: { targets: { some: { practice: false, platformStatus: "published" } } }, select: { userId: true }, distinct: ["userId"], take: CAP }),
      db.subscription.findMany({ where: { status: { in: ["active", "past_due"] } }, select: { userId: true }, distinct: ["userId"], take: CAP }),
      db.userActivityDay.findMany({ where: { OR: [{ day: { gte: w.from, lte: w.to } }, { day: dayKey(now) }] }, select: { userId: true, day: true }, take: CAP * 4 }),
      db.postTarget.findMany({ where: { practice: false, platformStatus: "published", publishedAt: { gte: from, lt: end } }, select: { postId: true, platform: true, publishedAt: true }, take: CAP }),
    ]);
    const r = buildAnalytics(
      {
        users,
        waitlist,
        accountEmails: accountEmails.map((u) => u.email),
        connected: connected.map((c) => c.userId),
        publishers: publishers.map((p) => p.userId),
        paying: paying.map((p) => p.userId),
        activity,
        published: published.filter((t) => t.publishedAt).map((t) => ({ postId: t.postId, platform: t.platform, publishedAt: t.publishedAt! })),
      },
      w,
      countryName,
      (p) => (isPlatform(p) ? PLATFORM_META[p].name : p),
      now,
    );
    return { ...r, generatedAt: now.toISOString() };
  });
}

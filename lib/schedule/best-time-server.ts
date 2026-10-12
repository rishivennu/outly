import "server-only";
import { db } from "../db";
import { isPlatform, type Platform } from "../domain";
import { bestTimes, type PostedSample } from "./best-time";

/** The creator's real published posts (last 180 days) with the latest view count we captured for each. */
export async function getBestTimes(userId: string, platforms: Platform[], tz: string) {
  const targets = await db.postTarget.findMany({
    where: { post: { userId }, publishedAt: { not: null, gte: new Date(Date.now() - 180 * 864e5) }, practice: false },
    select: { platform: true, publishedAt: true, metrics: { orderBy: { capturedAt: "desc" }, take: 1, select: { views: true } } },
    take: 500,
  });
  const samples: PostedSample[] = targets
    .filter((t) => t.publishedAt && isPlatform(t.platform) && t.metrics.length)
    .map((t) => ({ platform: t.platform as Platform, publishedAt: t.publishedAt!, views: t.metrics[0].views }));
  return bestTimes({ samples, platforms, tz });
}

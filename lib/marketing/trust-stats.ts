import "server-only";
import { db } from "../db";
import { cached } from "../cache";
import { liveNow } from "../social/registry";
import { trustFigures, type TrustCounts } from "./trust-core";

const SAMPLE = "@sample.outly.test";

/**
 * Real numbers for the landing trust section: people with an account, posts that actually went live
 * (practice runs and demo data excluded) and the platforms switched on right now. Cached for 10 minutes.
 */
export async function trustStats() {
  const counts = await cached<TrustCounts>("trust-stats", 10 * 60_000, async () => {
    const [creators, posts, live] = await Promise.all([
      db.user.count({ where: { NOT: { email: { endsWith: SAMPLE } } } }),
      db.postTarget.count({ where: { platformStatus: "published", practice: false, post: { user: { NOT: { email: { endsWith: SAMPLE } } } } } }),
      liveNow(),
    ]);
    return { creators, posts, platforms: live.length };
  });
  return trustFigures(counts);
}

import "server-only";
import { db } from "../db";
import { buildLiveMap, clampTimeout, LIVE_IDLE_MS, LIVE_MAX_PEOPLE, type LiveMap } from "../live-map-core";

const SAMPLE = "@sample.outly.test"; // admin demo accounts never show as live people (same rule as lib/presence.ts)

/**
 * Who is using Outlly right now, for the admin live globe (1062). One indexed query (User.lastSeenAt), capped,
 * newest first. Reads only what is already stored: last seen time and the approximate network place. No IP
 * address and no coordinates are stored or returned; the marker position comes from a static city/country table.
 */
export async function liveMap(timeoutMin: number, now = Date.now()): Promise<LiveMap> {
  const rows = await db.user.findMany({
    where: { lastSeenAt: { gte: new Date(now - LIVE_IDLE_MS) }, NOT: { email: { endsWith: SAMPLE } } },
    orderBy: { lastSeenAt: "desc" },
    take: LIVE_MAX_PEOPLE,
    select: { id: true, name: true, email: true, lastSeenAt: true, locCountry: true, locRegion: true, locCity: true, locVia: true, locAt: true },
  });
  return buildLiveMap(
    rows.map((r) => ({ id: r.id, name: r.name, email: r.email, lastSeenAt: r.lastSeenAt!, country: r.locCountry, region: r.locRegion, city: r.locCity, via: r.locVia, locAt: r.locAt })),
    now,
    clampTimeout(timeoutMin),
  );
}

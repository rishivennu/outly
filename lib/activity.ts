import "server-only";
import { db } from "./db";
import { ipPlace, placeKey } from "./geo";

const g = globalThis as unknown as { __seen?: Map<string, string> };
const seen = (g.__seen ??= new Map());

/** Marks the user active today. At most one write per user per day per process. Never throws. */
export async function touchActivity(userId: string) {
  const day = new Date().toISOString().slice(0, 10);
  if (seen.get(userId) === day) return;
  seen.set(userId, day);
  try {
    await db.userActivityDay.upsert({ where: { userId_day: { userId, day } }, create: { userId, day }, update: {} });
    await db.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } });
  } catch {
    seen.delete(userId);
  }
}

const placeSeen = ((globalThis as unknown as { __placeSeen?: Map<string, string> }).__placeSeen ??= new Map());

/**
 * Remembers the approximate network location (country, region, city) the member last used Outlly from (1053).
 * Read from headers the CDN already sends, so no lookup service is called. Writes only when the place changes,
 * or once a day to refresh the "seen there" time. Unknown places (local dev, header-less proxies) keep the last
 * known one instead of erasing it. Never throws.
 */
export async function touchPlace(userId: string, get: (name: string) => string | null | undefined) {
  const p = ipPlace(get);
  if (!p) return;
  const mark = `${placeKey(p)}#${new Date().toISOString().slice(0, 10)}`;
  if (placeSeen.get(userId) === mark) return;
  placeSeen.set(userId, mark);
  try {
    await db.user.update({ where: { id: userId }, data: { locCountry: p.country, locRegion: p.region, locCity: p.city, locVia: p.via, locAt: new Date() } });
  } catch {
    placeSeen.delete(userId);
  }
}

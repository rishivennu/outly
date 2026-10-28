import "server-only";
import { db } from "./db";
import { cached } from "./cache";
import { ONLINE_WINDOW_MS, presenceDue, type LiveStats } from "./presence-core";

const SAMPLE = "@sample.outly.test"; // admin demo data (lib/admin/sample.ts) never counts
const g = globalThis as unknown as { __presence?: Map<string, number> };
const last = (g.__presence ??= new Map());

/** Marks a signed-in person online. One write a minute per person per process, never throws, never blocks. */
export async function touchPresence(userId: string, now = Date.now()) {
  if (!presenceDue(last.get(userId), now)) return;
  last.set(userId, now);
  if (last.size > 50_000) last.clear(); // bounded: a cleared map only costs one extra write each
  await db.user.updateMany({ where: { id: userId }, data: { lastSeenAt: new Date(now) } }).catch(() => last.delete(userId));
}

/**
 * Real people only: everyone with an account, and those seen in the last 5 minutes. Two indexed counts
 * (User.lastSeenAt is indexed), shared by every visitor for 30 seconds, so a busy page costs nothing extra.
 */
export function liveStats(): Promise<LiveStats> {
  return cached("live-stats", 30_000, async () => {
    const real = { NOT: { email: { endsWith: SAMPLE } } };
    const [total, online] = await Promise.all([
      db.user.count({ where: real }),
      db.user.count({ where: { ...real, lastSeenAt: { gte: new Date(Date.now() - ONLINE_WINDOW_MS) } } }),
    ]);
    return { total, online };
  });
}

import "server-only";
import { db } from "../db";

/**
 * Sweeper heartbeat (1028). Scheduled posts, long retry waits and stuck-upload recovery all depend on the
 * sweep running every minute, and when nothing calls it nothing fails loudly: posts just never go out. Each
 * sweep records when it ran, per source, and the admin panel warns when the one this deployment relies on
 * goes quiet. Per source because on Vercel the in-process interval also ticks inside any warm function, which
 * would otherwise hide a missing pinger.
 */
export type SweepSource = "cron" | "worker" | "inproc";
const key = (s: SweepSource) => `sweeper:last:${s}`;
/** No sweep for this long means scheduled posts are going out late (it should run every minute). */
export const SWEEP_STALE_MS = 3 * 60_000;

export async function recordSweep(source: SweepSource, now = Date.now()) {
  const value = String(now);
  await db.setting.upsert({ where: { key: key(source) }, create: { key: key(source), value }, update: { value } }).catch((e) => console.error("[sweeper-health]", e));
}

/** Which sweep this deployment relies on: the BullMQ worker with Redis, the external pinger on Vercel, else in-process. */
export function expectedSource(env: Record<string, string | undefined> = process.env): SweepSource {
  if (env.REDIS_URL) return "worker";
  if (env.VERCEL) return "cron";
  return "inproc";
}

export type SweeperHealth = { source: SweepSource; lastAt: number | null; stale: boolean; latePosts: number };

export async function sweeperHealth(now = Date.now(), source = expectedSource()): Promise<SweeperHealth> {
  const [row, latePosts] = await Promise.all([
    db.setting.findUnique({ where: { key: key(source) } }),
    // Posts waiting for a reviewer stay "scheduled" on purpose; they are not late.
    db.post.count({ where: { status: "scheduled", requireApproval: false, scheduledAt: { lte: new Date(now - SWEEP_STALE_MS) } } }),
  ]);
  const lastAt = row && /^\d+$/.test(row.value) ? Number(row.value) : null;
  return { source, lastAt, stale: lastAt === null || now - lastAt > SWEEP_STALE_MS, latePosts };
}

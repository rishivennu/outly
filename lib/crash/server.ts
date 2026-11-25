import "server-only";
import { db } from "../db";
import { cached } from "../cache";
import { adminEvent } from "../admin/route";
import { PLATFORM_LABEL } from "../analytics/activity-core";
import { ALERT_WINDOW_MS, CRASHES_HREF, CRASH_EVENT, DAILY_CAP, RETENTION_DAYS, capStack, clampCrashedAt, fingerprintOf, groupCrashes, shortException, whereOf, type CrashGroup, type CrashPlatform, type CrashReport } from "./core";

const TTL = 60_000;
const MAX_ROWS = 2_000; // per admin read; the page groups them, so this bounds one range, not the table

/**
 * Store what one phone reported. Per person per UTC day at most DAILY_CAP rows land (a crash loop posts the same
 * crash every launch); a fingerprint not seen in the last 24 h raises one admin event with a link to the group.
 */
export async function recordCrashes(o: { userId: string; installId: string | null; platform: CrashPlatform; reports: CrashReport[]; now?: Date; cap?: number }) {
  const now = o.now ?? new Date();
  const cap = o.cap ?? DAILY_CAP;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Read-then-write: two overlapping posts can overshoot the cap by one batch. The route's 30/min limit bounds that.
  const today = await db.appCrash.count({ where: { userId: o.userId, createdAt: { gte: dayStart } } });
  let room = Math.max(0, cap - today);
  let stored = 0;
  let dropped = 0;
  const alerted: string[] = [];
  for (const r of o.reports) {
    if (room <= 0) {
      dropped++;
      continue;
    }
    const fingerprint = fingerprintOf(r);
    const recent = await db.appCrash.findFirst({ where: { fingerprint, createdAt: { gte: new Date(now.getTime() - ALERT_WINDOW_MS) } }, select: { id: true } });
    await db.appCrash.create({
      data: {
        userId: o.userId,
        installId: o.installId,
        platform: o.platform,
        version: r.version,
        build: r.build ?? null,
        sdk: r.sdk ?? null,
        device: r.device ?? null,
        fingerprint,
        exception: r.exception.trim(),
        message: r.message ?? null,
        stack: capStack(r.stack),
        thread: r.thread ?? null,
        screen: r.screen ?? null,
        crashedAt: clampCrashedAt(r.crashedAt, now),
        createdAt: now,
      },
    });
    stored++;
    room--;
    if (!recent && !alerted.includes(fingerprint)) {
      alerted.push(fingerprint);
      const where = whereOf(r.stack);
      // Best effort: the row is already stored, and a 500 here would make the phone re-post a duplicate.
      await adminEvent(CRASH_EVENT, `${PLATFORM_LABEL[o.platform]} crashed: ${shortException(r.exception)}`, [where, `v${r.version}`, r.device].filter(Boolean).join(" · "), CRASHES_HREF).catch(() => undefined);
    }
  }
  return { stored, dropped, alerted };
}

/** Groups for Admin > App Analytics > Crashes: crashes whose crashedAt falls on the range's UTC days. */
export const crashGroups = (q: { from: string; to: string; platform: CrashPlatform | "all" | string }): Promise<CrashGroup[]> =>
  cached(`crash:groups:${q.from}:${q.to}:${q.platform}`, TTL, async () => {
    const rows = await db.appCrash.findMany({
      where: {
        crashedAt: { gte: new Date(`${q.from}T00:00:00Z`), lt: new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000) },
        ...(q.platform === "android" || q.platform === "ios" ? { platform: q.platform } : {}),
      },
      orderBy: { crashedAt: "desc" },
      take: MAX_ROWS,
    });
    return groupCrashes(rows);
  });

/** Housekeeping: rows older than RETENTION_DAYS go. */
export async function sweepCrashes(now = new Date()) {
  const r = await db.appCrash.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - RETENTION_DAYS * 86_400_000) } } });
  return { pruned: r.count };
}

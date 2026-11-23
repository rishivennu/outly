import "server-only";
import { db } from "../db";
import { addDays, dayKey } from "../admin/activation";
import { SAMPLE_DOMAIN } from "../admin/sample";
import { featureOf, qualifies, type Platform } from "./activity-core";
import { pruneActivity } from "./activity";

/**
 * R1308: one AnalyticsDaily row per UTC day and platform, so the dashboard reads a year of history from a few hundred
 * rows. "all" is the cross-platform row: its DAU comes from UserActivityDay (one row per person per active day, written
 * by the studio layout and by every qualifying event), so it also covers the days before event tracking existed.
 * Per-platform rows come from the events themselves. Today and yesterday are recomputed every run; older days are
 * filled in a few at a time (backfill) until the whole year is there.
 */

export const ROLLUP_SLOT = 3; // minute % 10
export const ROLLUP_BACKFILL_DAYS = 365;
export const ROLLUP_BACKFILL_PER_RUN = 7;

const real = { NOT: { email: { endsWith: `@${SAMPLE_DOMAIN}` } } };
const CAP = 50_000;

type Daily = { dau: number; newUsers: number; returning: number; sessions: number; events: number; installs: number; durationS: number; features: Record<string, number> };
const blank = (): Daily => ({ dau: 0, newUsers: 0, returning: 0, sessions: 0, events: 0, installs: 0, durationS: 0, features: {} });

export async function rollupDay(day: string, now = new Date()): Promise<Record<string, Daily>> {
  const from = new Date(day + "T00:00:00Z");
  const to = new Date(from.getTime() + 86_400_000);
  const inDay = { gte: from, lt: to };
  const [active, bornToday, bornBefore, events, sessions, installs] = await Promise.all([
    db.userActivityDay.findMany({ where: { day, user: real }, select: { userId: true }, take: CAP }),
    db.user.count({ where: { ...real, createdAt: inDay } }),
    db.user.findMany({ where: { ...real, createdAt: { lt: from } }, select: { id: true }, take: CAP }),
    db.activityEvent.findMany({ where: { at: inDay }, select: { userId: true, name: true, platform: true }, take: CAP }),
    db.usageSession.findMany({ where: { startedAt: inDay }, select: { platform: true, startedAt: true, lastSeenAt: true }, take: CAP }),
    db.appInstall.groupBy({ by: ["platform"], where: { firstSeenAt: inDay }, _count: { _all: true } }),
  ]);
  const out: Record<string, Daily> = { all: blank() };
  const row = (p: string) => (out[p] ??= blank());
  const older = new Set(bornBefore.map((u) => u.id));

  const allActive = new Set(active.map((a) => a.userId));
  const perPlatform = new Map<string, Set<string>>();
  for (const e of events) {
    const r = row(e.platform as Platform);
    r.events++;
    out.all.events++;
    const f = featureOf(e.name);
    if (f) {
      r.features[f] = (r.features[f] ?? 0) + 1;
      out.all.features[f] = (out.all.features[f] ?? 0) + 1;
    }
    if (e.userId && qualifies(e.name)) {
      allActive.add(e.userId);
      (perPlatform.get(e.platform) ?? perPlatform.set(e.platform, new Set()).get(e.platform)!).add(e.userId);
    }
  }
  out.all.dau = allActive.size;
  out.all.returning = [...allActive].filter((id) => older.has(id)).length;
  out.all.newUsers = bornToday;
  for (const [p, ids] of perPlatform) {
    row(p).dau = ids.size;
    row(p).returning = [...ids].filter((id) => older.has(id)).length;
  }
  for (const s of sessions) {
    const d = Math.max(0, Math.round((s.lastSeenAt.getTime() - s.startedAt.getTime()) / 1000));
    for (const r of [row(s.platform), out.all]) {
      r.sessions++;
      r.durationS += d;
    }
  }
  for (const i of installs) {
    row(i.platform).installs += i._count._all;
    out.all.installs += i._count._all;
  }
  await Promise.all(
    Object.entries(out).map(([platform, d]) => {
      const data = { dau: d.dau, newUsers: d.newUsers, returning: d.returning, sessions: d.sessions, events: d.events, installs: d.installs, durationS: d.durationS, features: JSON.stringify(d.features) };
      return db.analyticsDaily.upsert({ where: { day_platform: { day, platform } }, create: { day, platform, ...data }, update: data });
    }),
  );
  void now;
  return out;
}

/** Which older days still have no "all" row, newest first, at most `limit`, looking back ROLLUP_BACKFILL_DAYS. */
export async function missingDays(now: Date, limit = ROLLUP_BACKFILL_PER_RUN): Promise<string[]> {
  const today = dayKey(now);
  const first = addDays(today, -ROLLUP_BACKFILL_DAYS);
  const have = new Set((await db.analyticsDaily.findMany({ where: { platform: "all", day: { gte: first, lt: today } }, select: { day: true } })).map((r) => r.day));
  const out: string[] = [];
  for (let d = addDays(today, -1); d >= first && out.length < limit; d = addDays(d, -1)) if (!have.has(d)) out.push(d);
  return out;
}

/** The sweep's step: today and yesterday fresh, a few missing days back-filled, old raw rows pruned once a day. */
export async function sweepRollup(now = new Date(), opts: { backfill?: number; prune?: boolean } = {}): Promise<{ days: string[]; pruned: { events: number; sessions: number } | null }> {
  const today = dayKey(now);
  const days = [today, addDays(today, -1), ...(await missingDays(now, opts.backfill ?? ROLLUP_BACKFILL_PER_RUN))];
  for (const d of days) await rollupDay(d, now);
  const prune = opts.prune ?? (now.getUTCHours() === 4 && now.getMinutes() === ROLLUP_SLOT);
  const pruned = prune ? await pruneActivity(now) : null;
  return { days, pruned };
}

/** When event tracking began: the first event ever, or null before the first one lands. Cached by the caller. */
export async function trackingSince(): Promise<Date | null> {
  const first = await db.activityEvent.findFirst({ orderBy: { at: "asc" }, select: { at: true } });
  return first?.at ?? null;
}

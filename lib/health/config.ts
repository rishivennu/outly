import "server-only";
import { z } from "zod";
import { db } from "../db";
import { cached, invalidate } from "../cache";

/**
 * R1195 Watchdog settings (Setting "watchdog:config"). Frequencies per service, where critical alert emails go,
 * and the on/off switch. Only super admins change it; defaults make the watchdog run with nothing configured.
 */
export const WatchdogConfig = z.object({
  enabled: z.boolean().default(true),
  /** Per-service cadence overrides, seconds (60..3600). */
  intervals: z.record(z.string(), z.number().int().min(60).max(3600)).default({}),
  /** Where critical alerts go when a push cannot be sent (or no admin device has push on). Blank = no email backup. */
  alertEmail: z.string().email().or(z.literal("")).default(""),
  /** Services muted by an admin (still checked and recorded, never alerted). */
  muted: z.array(z.string()).default([]),
});
export type WatchdogConfig = z.infer<typeof WatchdogConfig>;
const KEY = "watchdog:config";

export const watchdogConfig = () =>
  cached(KEY, 30_000, async (): Promise<WatchdogConfig> => {
    const row = await db.setting.findUnique({ where: { key: KEY } }).catch(() => null);
    try {
      return WatchdogConfig.parse(row ? JSON.parse(row.value) : {});
    } catch {
      return WatchdogConfig.parse({});
    }
  });

export async function saveWatchdogConfig(input: unknown) {
  const cfg = WatchdogConfig.parse(input);
  const value = JSON.stringify(cfg);
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  invalidate(KEY);
  return cfg;
}

import "server-only";
import { db } from "./db";
import { NOTIFY_CONFIG_DEFAULT, NOTIFY_CONFIG_KEY, mergeNotifyConfig, type NotifyConfig } from "./notify-config-core";

/**
 * 1141: storing and caching the admin's notification config. The shape, defaults and validator live in
 * lib/notify-config-core.ts so the admin screen can use them too; this half is the one row in the Setting
 * table. Any database trouble falls back to the code defaults rather than silencing notifications.
 */
export * from "./notify-config-core";

let cache: { at: number; cfg: NotifyConfig } | null = null;
const TTL = 60_000;

export async function notifyConfig(): Promise<NotifyConfig> {
  if (cache && Date.now() - cache.at < TTL) return cache.cfg;
  let cfg = NOTIFY_CONFIG_DEFAULT;
  try {
    const row = await db.setting.findUnique({ where: { key: NOTIFY_CONFIG_KEY } });
    if (row) cfg = mergeNotifyConfig(JSON.parse(row.value));
  } catch {
    cfg = NOTIFY_CONFIG_DEFAULT; // never let a config read stop a notification
  }
  cache = { at: Date.now(), cfg };
  return cfg;
}

export async function saveNotifyConfig(input: unknown): Promise<NotifyConfig> {
  const cfg = mergeNotifyConfig(input);
  const value = JSON.stringify(cfg);
  await db.setting.upsert({ where: { key: NOTIFY_CONFIG_KEY }, update: { value }, create: { key: NOTIFY_CONFIG_KEY, value } });
  cache = { at: Date.now(), cfg };
  return cfg;
}

/** Tests and the admin save path: forget what was cached. */
export const forgetNotifyConfig = () => void (cache = null);

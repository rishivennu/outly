import "server-only";
import { db } from "./db";
import { parseAlertPrefs, serializeAlertPrefs } from "./alerts-core";
import { parseNotifyPrefs, serializeNotifyPrefs, type NotifyPrefs } from "./notify-core";

/*
 * 1118: reading and saving notification settings. The two switches that existed before (Settings > Custom
 * alerts: failed posts, engagement spikes) are the same thing as two events here, so a save on either page
 * writes both places and they can never disagree.
 */

export async function loadNotifyPrefs(userId: string): Promise<NotifyPrefs & { tz: string }> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { notifyPrefs: true, alertPrefs: true, timezone: true } });
  const a = parseAlertPrefs(u?.alertPrefs);
  return { ...parseNotifyPrefs(u?.notifyPrefs, { failed: a.failed, spike: a.spike }), tz: u?.timezone ?? "UTC" };
}

export async function saveNotifyPrefs(userId: string, p: NotifyPrefs) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { alertPrefs: true } });
  const a = parseAlertPrefs(u?.alertPrefs);
  const clean: NotifyPrefs = { ev: p.ev, lead: p.lead, ch: p.ch, quiet: p.quiet };
  await db.user.update({ where: { id: userId }, data: { notifyPrefs: serializeNotifyPrefs(clean), alertPrefs: serializeAlertPrefs({ ...a, failed: p.ev.post_failed, spike: p.ev.engagement_spike }) } });
  return parseNotifyPrefs(serializeNotifyPrefs(clean));
}

/** Custom alerts saved a new failed/spike switch: carry it into the notification settings (only once they exist). */
export async function syncFromAlerts(userId: string, a: { failed: boolean; spike: boolean }) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { notifyPrefs: true } });
  if (!u?.notifyPrefs) return; // still on defaults: parseNotifyPrefs already reads alertPrefs
  const p = parseNotifyPrefs(u.notifyPrefs);
  p.ev.post_failed = a.failed;
  p.ev.engagement_spike = a.spike;
  await db.user.update({ where: { id: userId }, data: { notifyPrefs: serializeNotifyPrefs(p) } });
}

/** Unread, not cleared: the bell count and the app icon badge. */
export const unreadCount = (userId: string) => db.notice.count({ where: { userId, readAt: null, hiddenAt: null } });

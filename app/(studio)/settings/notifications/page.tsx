import { getCurrentUser } from "@/lib/auth";
import { loadNotifyPrefs } from "@/lib/notify";
import { vapidKeys } from "@/lib/push/vapid";
import { devicesOf } from "@/lib/push/web-devices";
import { entitlements } from "@/lib/billing/entitlements";
import { hasPerk } from "@/lib/billing/plan-rules";
import { NotificationSettings, MemberNotificationsNote } from "@/components/settings/notifications/NotificationSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notification settings" };

/**
 * Settings > Notifications (1118): push on this device, what to be told about, where, quiet hours, connected
 * devices and the history. The owner's own: inside someone else's studio their alerts go to them.
 */
export default async function NotificationSettingsPage() {
  const user = (await getCurrentUser())!;
  if (user.actor) return <MemberNotificationsNote owner={user.name} />;
  const [{ tz, ...prefs }, v, devices, e] = await Promise.all([loadNotifyPrefs(user.id), vapidKeys(), devicesOf(user.id), entitlements(user.id).catch(() => null)]);
  return <NotificationSettings initial={{ prefs, tz, publicKey: v.publicKey, devices }} spikeAllowed={!e || hasPerk(e, "spike-alerts")} />;
}

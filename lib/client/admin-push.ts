"use client";
import { installedNow, permission, pushSupport, urlB64ToBytes } from "./push";

/**
 * R1207: turning Web Push on for an admin's own device, shared by System Health (Watchdog alerts) and the Live
 * Support console (new support requests). One subscription per browser in AdminPushSub: whichever admin is signed in
 * on it gets the alerts, and the same device serves both kinds, so enabling it in either place is enough.
 *
 * The flag only remembers that this browser opted in, so a page can re-save a still-valid subscription (refreshing
 * "last seen", and bringing it back after a reinstall) without ever asking for permission on its own. Permission is
 * requested inside the admin's own tap, never on load.
 */
export type AdminDevice = { id: string; platform: string; device: string; client: string; failures: number; createdAt: string; lastSeenAt: string; lastPushAt: string | null };

export const ADMIN_DEVICES_URL = "/api/admin/health/devices";
/** The key has its old name (R1195) so a device enrolled before R1207 is still remembered as on. */
const PUSH_FLAG = "outlly:watchdog-push";

export const adminPushFlag = () => {
  try {
    return localStorage.getItem(PUSH_FLAG) === "1";
  } catch {
    return false;
  }
};
export const setAdminPushFlag = (on: boolean) => {
  try {
    if (on) localStorage.setItem(PUSH_FLAG, "1");
    else localStorage.removeItem(PUSH_FLAG);
  } catch {}
};

async function registration() {
  const have = await navigator.serviceWorker.getRegistration("/");
  if (have) return have;
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

async function post(body: unknown, method = "POST") {
  const r = await fetch(ADMIN_DEVICES_URL, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j as { error?: string } | null)?.error || "That didn't work.");
  return j as { id?: string; devices: AdminDevice[] };
}

/** The admin's "Alert me on this device" tap: permission inside the gesture, subscribe, save as an admin alert device. */
export async function enableAdminPush(publicKey: string): Promise<AdminDevice[]> {
  if (pushSupport() !== "supported") throw new Error("This browser can't show notifications from Outlly.");
  const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications are blocked for Outlly in this browser. Allow them in the site settings, then try again." : "Notifications weren't allowed.");
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  const key = sub?.options?.applicationServerKey;
  // A subscription made for a different VAPID key can never be decrypted by this server: start again.
  if (sub && key) {
    const a = new Uint8Array(key);
    const b = urlB64ToBytes(publicKey);
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(publicKey) });
  const r = await post({ sub: sub.toJSON(), installed: installedNow(), touchMac: navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1, key: publicKey });
  setAdminPushFlag(true);
  return r.devices;
}

/** Turn alerts off on this browser only (the subscription row goes; other devices keep theirs). */
export async function disableAdminPush(): Promise<AdminDevice[] | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  setAdminPushFlag(false);
  if (!sub) return null;
  return (await post({ endpoint: sub.endpoint }, "DELETE")).devices;
}

/** Re-save a still-valid subscription on load, when this browser opted in before. Never asks for permission. */
export async function syncAdminPush(publicKey: string | null | undefined): Promise<boolean> {
  if (!publicKey || !adminPushFlag() || permission() !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return false;
  await post({ sub: sub.toJSON(), installed: installedNow(), touchMac: false, key: publicKey }).catch(() => null);
  return true;
}

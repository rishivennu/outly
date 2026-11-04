"use client";
/*
 * 1118: Web Push on this browser. Feature detection first: iPhone and iPad only deliver web notifications to
 * Outlly added to the Home Screen (iOS 16.4+), so a Safari tab is told how to add it instead of shown a
 * switch that can't work. The permission prompt only ever opens from an explicit "Enable" tap.
 */
import { api, ApiError } from "./api";
import { isIOS } from "@/lib/pwa-core";

export type PushSupport = "supported" | "ios-needs-install" | "unsupported";
/** What the header and the permission card show. */
export type PushState = "on" | "off" | "denied" | "ios-needs-install" | "unsupported";

const DISMISS_KEY = "outlly:push-dismissed";
const DEVICES = "/api/settings/notifications/devices";

const ios = () => isIOS(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
const touchMac = () => navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;

export function installedNow() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const has = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
  // iOS Safari tabs have no PushManager at all; the Home Screen app (16.4+) does.
  if (ios() && !installedNow()) return "ios-needs-install";
  return has ? "supported" : "unsupported";
}

export const permission = (): NotificationPermission | "unsupported" => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

/** Registered on every load in production (Connectivity). In development only once someone turns push on here. */
async function registration() {
  const have = await navigator.serviceWorker.getRegistration("/");
  if (have) return have;
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

export async function currentSub(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export function stateOf(support: PushSupport, perm: ReturnType<typeof permission>, subscribed: boolean): PushState {
  if (support !== "supported") return support;
  if (perm === "denied") return "denied";
  return perm === "granted" && subscribed ? "on" : "off";
}

export function urlB64ToBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const sameKey = (sub: PushSubscription, key: string) => {
  const k = sub.options?.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k);
  const b = urlB64ToBytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

export type Device = { id: string; device: string; platform: string; client: string; installed: boolean; status: "active" | "trouble"; addedAt: string; lastActiveAt: string; lastPushAt: string | null; current: boolean };

async function register(sub: PushSubscription, key: string) {
  return api<{ id: string; devices: Device[] }>(DEVICES, { method: "POST", json: { sub: sub.toJSON(), installed: installedNow(), touchMac: touchMac(), key } });
}

/**
 * The "Enable" tap. Asks for permission first, synchronously inside the tap (Safari only shows the prompt
 * from a user gesture), then subscribes and saves this device. Throws a readable Error when it can't.
 */
export async function enablePush(publicKey: string): Promise<Device[]> {
  if (pushSupport() !== "supported") throw new Error("This browser can't show notifications from Outlly.");
  const asked = Notification.permission === "default" ? Notification.requestPermission() : Promise.resolve(Notification.permission);
  const perm = await asked;
  if (perm !== "granted") throw Object.assign(new Error(perm === "denied" ? "Notifications are blocked for Outlly in this browser." : "Notifications weren't allowed."), { code: perm });
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(publicKey) });
  try {
    clearDismissed();
    return (await register(sub, publicKey)).devices;
  } catch (e) {
    // The server's key changed since the page loaded: subscribe again with the one it names.
    const fresh = e instanceof ApiError && e.code === "vapid_changed" ? (e.data?.publicKey as string | undefined) : undefined;
    if (!fresh) throw e;
    await sub.unsubscribe().catch(() => {});
    const again = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(fresh) });
    return (await register(again, fresh)).devices;
  }
}

/** "Turn off on this device": forget it on the server, then drop the browser's subscription. */
export async function disablePushHere(): Promise<Device[] | null> {
  const sub = await currentSub();
  if (!sub) return null;
  const r = await api<{ devices: Device[] }>(DEVICES, { method: "DELETE", json: { endpoint: sub.endpoint } }).catch(() => null);
  await sub.unsubscribe().catch(() => {});
  return r?.devices ?? null;
}

/**
 * On opening the page: a subscription the browser still holds is saved again (refreshes "last active", and
 * comes back if it was removed from another device by mistake only when permission is still granted).
 */
export async function syncHere(publicKey: string): Promise<Device[] | null> {
  const sub = await currentSub();
  if (!sub || permission() !== "granted") return null;
  if (!sameKey(sub, publicKey)) {
    await sub.unsubscribe().catch(() => {});
    return null;
  }
  return (await register(sub, publicKey).catch(() => null))?.devices ?? null;
}

export function dismissed() {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) || 0) > 0;
  } catch {
    return false;
  }
}
export function dismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {}
}
function clearDismissed() {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {}
}

/** Where to turn notifications back on after "Block", per browser. */
export function deniedHelp(): string {
  const ua = navigator.userAgent;
  if (ios()) return "Open Settings on your iPhone or iPad, tap Notifications, find Outlly and turn on Allow Notifications.";
  if (/Android/i.test(ua)) return "Long-press the Outlly icon (or tap the lock next to the address), open Site settings or App info, then Notifications, and allow them.";
  if (/Edg\//.test(ua)) return "Click the lock next to the address bar, open Permissions for this site, and set Notifications to Allow.";
  if (/Firefox\//.test(ua)) return "Click the lock next to the address bar, clear the Blocked notification permission, then reload this page.";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Open Safari > Settings > Websites > Notifications, find outlly.com and choose Allow.";
  return "Click the lock or tune icon next to the address bar, open Site settings, and set Notifications to Allow.";
}

/** The app icon badge (installed apps): the unread notice count, cleared at zero. */
export function setBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) nav.setAppBadge?.(n).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  } catch {}
}

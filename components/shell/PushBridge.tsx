"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { currentSub, installedNow, permission } from "@/lib/client/push";

export const NOTICES_EVENT = "outlly:notices";
const SEEN_KEY = "outlly:push-seen";

const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * 1118: the page side of Web Push. The service worker says when a push arrived (the bell reloads) and asks an
 * open tab to go to a tapped notification's page when it can't navigate the tab itself. Once a day it tells the
 * server this device is still here, so Settings > Notifications shows a true "last active".
 */
export function PushBridge({ owner }: { owner: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; href?: string } | null;
      if (d?.type === "outlly:notice") window.dispatchEvent(new Event(NOTICES_EVENT));
      if (d?.type === "outlly:open" && typeof d.href === "string" && /^\/(?![/\\])/.test(d.href)) router.push(d.href);
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [router]);

  useEffect(() => {
    if (!owner || permission() !== "granted") return;
    try {
      if (Date.now() - Number(localStorage.getItem(SEEN_KEY) || 0) < 864e5) return;
    } catch {}
    const t = setTimeout(async () => {
      const sub = await currentSub().catch(() => null);
      const key = sub?.options?.applicationServerKey;
      if (!sub || !key) return;
      // Plain fetch, not api(): a background refresh must not drop the tabs' remembered answers.
      const body = { sub: sub.toJSON(), installed: installedNow(), touchMac: navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1, key: b64u(key) };
      const ok = await fetch("/api/settings/notifications/devices", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch {}
    }, 4000);
    return () => clearTimeout(t);
  }, [owner]);
  return null;
}

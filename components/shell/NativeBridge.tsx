"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNative, nativeCall, nativeOn, shellInfo } from "@/lib/client/native";
import { sameSitePath } from "@/lib/safe-next";

const ASKED_KEY = "outlly_push_asked";
type Perm = { receive: "granted" | "denied" | "prompt" | "prompt-with-rationale" };
type Tap = { notification?: { data?: { href?: string } } };

const safeHref = sameSitePath;

/** Status bar icons that follow the light/dark theme, and push notifications. Only does anything inside the Android app. */
export function NativeBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!isNative()) return;
    const root = document.documentElement;
    const sync = () => void nativeCall("SystemBars", "setStyle", { style: root.classList.contains("dark") ? "DARK" : "LIGHT" }).catch(() => {});
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    let off = [] as (() => void)[];
    let stopped = false;
    void (async () => {
      if (!(await shellInfo())?.push || stopped) return;
      off = [
        nativeOn<{ value: string }>("PushNotifications", "registration", ({ value }) => {
          void fetch("/api/app/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: value }) }).catch(() => {});
        }),
        nativeOn<Tap>("PushNotifications", "pushNotificationActionPerformed", (t) => {
          const href = safeHref(t.notification?.data?.href);
          if (href) router.push(href);
        }),
      ];
      let perm = await nativeCall<Perm>("PushNotifications", "checkPermissions").catch(() => null);
      // Ask once, a moment after the studio opens, not on top of the very first paint.
      if (perm && perm.receive !== "granted" && perm.receive !== "denied" && !localStorage.getItem(ASKED_KEY)) {
        await new Promise((r) => setTimeout(r, 2500));
        if (stopped) return;
        localStorage.setItem(ASKED_KEY, "1");
        perm = await nativeCall<Perm>("PushNotifications", "requestPermissions").catch(() => null);
      }
      if (perm?.receive === "granted" && !stopped) await nativeCall("PushNotifications", "register").catch(() => {});
    })();
    return () => {
      stopped = true;
      off.forEach((f) => f());
    };
  }, [router]);

  return null;
}

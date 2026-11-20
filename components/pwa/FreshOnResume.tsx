"use client";
import { useEffect } from "react";
import { BUILD_URL, isInstalled, isNewBuild, SEEN_KEY, shouldCheck, UPDATE_ACTION, UPDATE_TEXT, UPDATE_TOAST_MS } from "@/lib/client/fresh-on-resume";
import { TOAST_EVENT, type ToastRequest } from "@/lib/client/toast-core";

const SERVED = process.env.NEXT_PUBLIC_BUILD || "dev";

/** R1283: an installed app that comes back after ten minutes or more hears about a newer build (lib/client/fresh-on-resume.ts). Renders nothing. */
export function FreshOnResume() {
  useEffect(() => {
    if (!isInstalled(window)) return;
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    let busy = false;
    const check = async () => {
      const away = hiddenAt;
      hiddenAt = null;
      if (busy || !shouldCheck(away, Date.now())) return;
      busy = true;
      try {
        const res = await fetch(BUILD_URL, { cache: "no-store" });
        const live: unknown = res.ok ? ((await res.json()) as { build?: unknown }).build : null;
        if (!isNewBuild(SERVED, live) || sessionStorage.getItem(SEEN_KEY) === live) return;
        const req: ToastRequest = { text: UPDATE_TEXT, tone: "info", opts: { duration: UPDATE_TOAST_MS, action: { label: UPDATE_ACTION, onClick: () => location.reload() } } };
        window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: req }));
        // A page without a toast host (a public page) does not use up the one announcement.
        if (req.shown) sessionStorage.setItem(SEEN_KEY, live);
      } catch {
        // Offline or storage blocked: ask again on the next return.
      } finally {
        busy = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else void check();
    };
    const onPageHide = () => {
      hiddenAt ??= Date.now();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  return null;
}

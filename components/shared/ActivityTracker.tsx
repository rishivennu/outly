"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { HEARTBEAT_MS, MAX_BATCH, SHELL_COOKIE, sectionOf, type EventName } from "@/lib/analytics/activity-core";
import { isAdminPath } from "@/lib/analytics/track";

/**
 * R1308 App Analytics, the browser side. Mounted once in the studio layout for signed-in people. It
 *  - records a page_view (section only, never the full URL) plus dashboard_visit / analytics_visit on navigation,
 *  - sends them in small batches (every 10 s, or at once when the tab hides), with keepalive so nothing is lost on close,
 *  - heartbeats every HEARTBEAT_MS while the tab is visible so "online now" and session length stay honest,
 *  - keeps the outly_shell cookie while running installed (standalone), so the server files these requests under "pwa",
 *  - reports the install once (appinstalled, or the first standalone run) with an id this browser keeps.
 * Nothing here ever throws into the app, and nothing runs on admin pages.
 */

const FLUSH_MS = 10_000;
const INSTALL_ID_KEY = "outly_install_id";
const INSTALL_SENT_KEY = "outly_install_sent";

type Queued = { n: EventName; meta?: Record<string, string> };

const standalone = () => {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
};

const installId = () => {
  try {
    let id = localStorage.getItem(INSTALL_ID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9_-]/g, "");
      localStorage.setItem(INSTALL_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
};

function send(body: Record<string, unknown>, keepalive = false) {
  try {
    const p = fetch("/api/track", { method: "POST", credentials: "same-origin", keepalive, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    p.catch(() => {});
  } catch {
    /* offline, blocked: nothing to do */
  }
}

export function ActivityTracker() {
  const pathname = usePathname();
  const queue = useRef<Queued[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navigation: one page_view per studio page, folded into its section.
  useEffect(() => {
    if (!pathname || isAdminPath(pathname)) return;
    const section = sectionOf(pathname);
    const q = queue.current;
    q.push({ n: "page_view", meta: { section } });
    if (section === "home" || section === "dashboard") q.push({ n: "dashboard_visit" });
    if (section === "analytics") q.push({ n: "analytics_visit" });
    if (q.length >= MAX_BATCH) flush();
    else if (!timer.current) timer.current = setTimeout(flush, FLUSH_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    const onInstalled = () => reportInstall("appinstalled");
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("outly:installed", onInstalled);

    // The installed web app names itself through a session cookie read by the server on every request.
    if (standalone()) {
      try {
        document.cookie = `${SHELL_COOKIE}=pwa; path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      } catch {}
      reportInstall("standalone");
    }

    // Heartbeat while visible: "online now" and the open session, without a storm (one small request every 2 minutes).
    const hb = setInterval(() => {
      if (document.visibilityState === "visible") send({ hb: true });
    }, HEARTBEAT_MS);

    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("outly:installed", onInstalled);
      clearInterval(hb);
      flush(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flush(keepalive = false) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const events = queue.current.splice(0, MAX_BATCH);
    if (!events.length) return;
    send({ events }, keepalive);
    if (queue.current.length) timer.current = setTimeout(flush, FLUSH_MS);
  }

  function reportInstall(source: "appinstalled" | "standalone") {
    try {
      if (localStorage.getItem(INSTALL_SENT_KEY) === "1") return;
      const id = installId();
      if (!id) return;
      localStorage.setItem(INSTALL_SENT_KEY, "1");
      send({ install: { id, platform: "pwa", source } });
    } catch {}
  }

  return null;
}

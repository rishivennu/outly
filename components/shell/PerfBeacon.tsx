"use client";
import { useEffect } from "react";
import { analyticsAllowed, clsScore, cleanPath, deviceClass, inpScore, ms, netClass, parseTiming } from "@/lib/perf/collect";
import { HOME_CONTENT_MARK, PERF_MAX_BYTES, PERF_WARM_KEY, type PerfPayload } from "@/lib/perf/sample";

const SEND_AFTER_MS = 10_000;
/** The same key components/shared/CookieConsent.tsx writes; read directly so the banner's code stays out of this chunk. */
const CONSENT_KEY = "outly-consent";
const VERSION = (process.env.NEXT_PUBLIC_BUILD_ID || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "").slice(0, 12) || undefined;
const FLAGS = new Set(["hit", "stale", "miss", "timeout"]);

type Shift = PerformanceEntry & { value: number; hadRecentInput: boolean };
type EventTiming = PerformanceEntry & { interactionId?: number };
type Nav = PerformanceNavigationTiming & { serverTiming?: { name: string; duration: number; description: string }[] };
type Conn = { effectiveType?: string; rtt?: number; saveData?: boolean };

/** Once per document: the studio layout stays mounted across client navigations, and StrictMode runs effects twice. */
let started = false;

/**
 * Startup timings for one page load (C1), sent once to /api/perf on pagehide (or the page going to the background)
 * or 10 s after load. Never anything personal. Do Not Track / Global Privacy Control: nothing is sent at all.
 * Without analytics consent only the technical timings go: no device class, no network.
 */
export function PerfBeacon() {
  useEffect(() => {
    if (started) return;
    started = true;
    const hydrate = performance.now();
    const nav = navigator as Navigator & { doNotTrack?: string; globalPrivacyControl?: boolean; standalone?: boolean; deviceMemory?: number; connection?: Conn };
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl === true || typeof navigator.sendBeacon !== "function") return;

    let cold = true;
    try {
      cold = !sessionStorage.getItem(PERF_WARM_KEY);
      sessionStorage.setItem(PERF_WARM_KEY, "1");
    } catch {
      /* storage blocked: counted as cold */
    }
    const path = cleanPath(location.pathname);
    const id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    let hiddenAt = document.visibilityState === "hidden" ? 0 : Infinity;
    let lcp: number | null = null;
    const shifts: { startTime: number; value: number }[] = [];
    const interactions = new Map<number, number>();

    const watchers: { o: PerformanceObserver; take: (l: PerformanceEntryList) => void }[] = [];
    const watch = (type: string, take: (l: PerformanceEntryList) => void, extra: Record<string, unknown> = {}) => {
      try {
        if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return false;
        const o = new PerformanceObserver((l) => take(l.getEntries()));
        o.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
        watchers.push({ o, take });
        return true;
      } catch {
        return false; // an engine without this entry type
      }
    };
    // A paint that happened after the page went to the background measures the tab switch, not the app.
    watch("largest-contentful-paint", (l) => l.forEach((e) => e.startTime < hiddenAt && (lcp = e.startTime)));
    const hasCls = watch("layout-shift", (l) => (l as Shift[]).forEach((e) => !e.hadRecentInput && shifts.push({ startTime: e.startTime, value: e.value })));
    watch(
      "event",
      (l) => (l as EventTiming[]).forEach((e) => e.interactionId && interactions.set(e.interactionId, Math.max(interactions.get(e.interactionId) ?? 0, e.duration))),
      { durationThreshold: 40 },
    );

    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      for (const w of watchers) {
        w.take(w.o.takeRecords());
        w.o.disconnect();
      }
      const entry = performance.getEntriesByType("navigation")[0] as Nav | undefined;
      const server = entry?.serverTiming ?? [];
      const t = parseTiming(document.querySelector<HTMLMetaElement>('meta[name="x-timing"]')?.content);
      const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
      const flags = server.find((s) => s.name === "flags")?.description;
      let consent = false;
      try {
        consent = analyticsAllowed(localStorage.getItem(CONSENT_KEY));
      } catch {
        /* storage blocked: treated as no consent */
      }
      const p: PerfPayload = {
        id,
        path,
        cold,
        installed: matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
        version: VERSION,
        flags: flags && FLAGS.has(flags) ? flags : undefined,
        ttfb: ms(entry?.responseStart),
        fcp: fcp !== undefined && fcp < hiddenAt ? ms(fcp) : null,
        lcp: ms(lcp),
        cls: hasCls ? Math.min(100_000, Math.round(clsScore(shifts) * 1000)) : null,
        inp: ms(inpScore(interactions)),
        hydrate: ms(hydrate),
        content: ms(performance.getEntriesByName(HOME_CONTENT_MARK, "mark")[0]?.startTime),
        mwMs: ms(server.find((s) => s.name === "mw")?.duration ?? t.mw),
        userMs: ms(t.user ?? t.userMs),
        cfgMs: ms(t.cfg ?? t.cfgMs),
        device: consent ? deviceClass(navigator.hardwareConcurrency, nav.deviceMemory) : undefined,
        net: consent ? netClass(nav.connection) : undefined,
      };
      const body = JSON.stringify(p);
      if (body.length > PERF_MAX_BYTES) return;
      try {
        if (!navigator.sendBeacon("/api/perf", body)) void fetch("/api/perf", { method: "POST", body, keepalive: true }).catch(() => {});
      } catch {
        /* a beacon is best effort */
      }
    };

    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      hiddenAt = Math.min(hiddenAt, performance.now());
      send();
    };
    const arm = () => window.setTimeout(send, SEND_AFTER_MS);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", send, { once: true });
    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });
    // No cleanup on purpose: the timings belong to the document, not to this component, and must outlive a remount.
  }, []);
  return null;
}

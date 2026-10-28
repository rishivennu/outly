"use client";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { cachedApi } from "./api";

/*
 * Warm a studio tab before it is opened (1039): its server-rendered page and the numbers it fetches
 * after it shows. Triggered by intent (hover, keyboard focus, touch) on the link and, for Analytics,
 * once while the studio is idle. Skipped when the browser asks to save data.
 */

type Prefetcher = { prefetch: (href: string, options?: { kind: PrefetchKind }) => void };

export const saveData = () => typeof navigator !== "undefined" && !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

// One full page prefetch per href per 30 s: the router keeps it, so asking again only costs the server.
const pages = new Map<string, number>();
export function warmPage(router: Prefetcher, href: string) {
  if (saveData()) return;
  const at = pages.get(href);
  if (at && Date.now() - at < 30_000) return;
  pages.set(href, Date.now());
  try {
    router.prefetch(href, { kind: PrefetchKind.FULL });
  } catch {
    /* a prefetch is only ever a head start */
  }
}

export function warmApi(url: string, maxAge?: number) {
  if (saveData()) return;
  cachedApi(url, maxAge).catch(() => {});
}

type Account = { platform: string; status: string; mock?: boolean };

/** Everything the Analytics overview shows: the page, the review, live views, and each connected platform. */
export function warmAnalytics(router: Prefetcher, live?: readonly string[]) {
  if (saveData()) return;
  warmPage(router, "/analytics");
  warmApi("/api/analytics/review");
  warmApi("/api/analytics/live", 20_000);
  // The live tiles: only for platforms really connected (practice accounts have no live numbers).
  cachedApi<{ accounts: Account[] }>("/api/accounts", 60_000)
    .then(({ accounts }) => {
      const on = new Set(accounts.filter((a) => a.status === "connected" && !a.mock).map((a) => a.platform));
      for (const p of on) if (!live || live.includes(p)) warmApi(`/api/platforms/${p}`);
    })
    .catch(() => {});
}

/** onPointerEnter/onFocus/onTouchStart props for a link, so the warm-up starts on intent. */
export function warmOn(fn: () => void) {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    fn();
    setTimeout(() => (done = false), 30_000);
  };
  return { onPointerEnter: go, onFocus: go, onTouchStart: go };
}

/** Run `fn` once the browser is idle (or after `ms` where requestIdleCallback is missing). Returns a cleanup. */
export function whenIdle(fn: () => void, ms = 2500) {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  let idle = 0;
  const t = window.setTimeout(() => {
    if (w.requestIdleCallback) idle = w.requestIdleCallback(fn, { timeout: 4000 });
    else fn();
  }, ms);
  return () => {
    window.clearTimeout(t);
    if (idle && w.cancelIdleCallback) w.cancelIdleCallback(idle);
  };
}

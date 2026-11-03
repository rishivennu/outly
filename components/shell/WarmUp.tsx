"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLivePlatforms } from "./LivePlatforms";
import { useUserKey } from "./UserContext";
import { coolPages, onRouterRefresh, warmAnalytics, warmPage, whenIdle } from "@/lib/client/warm";
import { FIRST_MS, GAP_MS, canPreload, noteServerClock, preloadOrder, takeQuiet } from "@/lib/client/preload";

/**
 * 1114: every primary tab (Home, Analytics, Calendar, Inbox, Content) loaded in the background, so opening one shows
 * it at once. Replaces 1039's Analytics-only idle warm-up. See lib/client/preload.ts for the whole picture.
 *
 * - The open page comes first: nothing starts until it has painted and the browser is idle (FIRST_MS), then one tab
 *   per idle moment (GAP_MS apart), so a slow phone never has the warm-up fighting the page in front of it.
 * - Runs again on every navigation, when the browser tab comes back, and after any router.refresh() (which empties
 *   the router's cache). Already-held tabs cost nothing: Next never fetches a prefetch it still holds.
 * - Never with Save-Data or on 2G, never in a hidden tab, never while composing a post. Errors are swallowed: a
 *   prefetch is only a head start, a tab that wasn't warmed loads the normal way.
 * - Per account: a different sign-in, workspace or profile in this tab drops everything kept for the one before
 *   (components/shell/UserContext.tsx does it, above every page).
 */
// The numbers Analytics fetches once open go stale in 20-60 s, so warming them on every navigation would mostly fetch
// what nobody reads. Its page is kept 5 minutes; the numbers are warmed at most every 2 minutes (and always on intent).
let apisAt = 0;
let apisFor: string | null = null;
const APIS_EVERY = 120_000;

export function WarmUp({ serverNow }: { serverNow?: number }) {
  const router = useRouter();
  const path = usePathname();
  const live = useLivePlatforms();
  const who = useUserKey();
  // Bumped when the router's cache was emptied or the tab is visible again: warm the tabs once more.
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (serverNow) noteServerClock(serverNow, Date.now(), true);
  }, [serverNow]);

  useEffect(() => {
    let t = 0;
    const again = () => {
      coolPages();
      // A page bringing itself up to date (PageFresh) empties the cache too, but warming every tab again for that would
      // cost four server renders per stale tab opened. Those tabs warm on the next navigation, or on intent.
      if (takeQuiet()) return;
      // A burst of refreshes (a save, then another) warms once, after the last.
      window.clearTimeout(t);
      t = window.setTimeout(() => setRound((r) => r + 1), 2000);
    };
    const stop = onRouterRefresh(router, again);
    const onShow = () => document.visibilityState === "visible" && setRound((r) => r + 1);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stop();
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [router]);

  useEffect(() => {
    if (apisFor !== who) {
      apisFor = who;
      apisAt = 0;
    }
    if (!canPreload() || document.visibilityState === "hidden") return;
    const order = preloadOrder(path);
    let i = 0;
    let cancel = () => {};
    const next = () => {
      if (i >= order.length) return;
      cancel = whenIdle(() => {
        // Gone to the background: stop; coming back starts a new round.
        if (document.visibilityState === "hidden") return;
        const href = order[i++];
        try {
          // Analytics: its page and the numbers it loads once open (review, live views, each connected platform).
          warmPage(router, href);
          if (href === "/analytics" && Date.now() - apisAt > APIS_EVERY) {
            apisAt = Date.now();
            warmAnalytics(router, live, false);
          }
        } catch {}
        next();
      }, i === 0 ? FIRST_MS : GAP_MS);
    };
    next();
    return () => cancel();
  }, [path, who, live, router, round]);

  return null;
}

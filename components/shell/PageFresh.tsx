"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { lastWriteAt } from "@/lib/client/api";
import { isStale, markQuiet, markRefreshed, mayRefresh, noteServerClock, onServerClock, refreshedAt } from "@/lib/client/preload";

/**
 * 1114: for a page that may be shown from the background preload (components/shell/WarmUp.tsx). The page paints from
 * the copy it was given at once; if that copy is older than `maxAge`, or this tab changed something after it was
 * rendered, it is brought up to date in place a beat later: no loader, filters kept, numbers move to the new values.
 * `renderedAt` is the server's Date.now() when it rendered the page. `onStale` replaces the default (refresh the
 * server render) for a page that loads its own data, like the inbox: its server render never gets newer, so its age
 * counts from its last own reload instead.
 */
export function useFresh(renderedAt: number | undefined, maxAge: number, onStale?: () => void) {
  const router = useRouter();
  const path = usePathname() ?? "";
  const run = useRef(onStale);
  run.current = onStale;
  useEffect(() => {
    if (renderedAt) noteServerClock(renderedAt);
    const own = run.current ? refreshedAt(path) : undefined;
    const since = renderedAt && own !== undefined ? Math.max(renderedAt, onServerClock(own)) : renderedAt;
    if (!isStale(since, maxAge, lastWriteAt()) || !mayRefresh(path)) return;
    // After the entrance has started, so the update never competes with the first frames.
    const t = window.setTimeout(() => {
      if (document.visibilityState === "hidden" || !mayRefresh(path)) return;
      markRefreshed(path);
      if (run.current) run.current();
      else {
        markQuiet();
        router.refresh();
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [renderedAt, maxAge, path, router]);
}

/** The server-render version, for a page's JSX: `<PageFresh renderedAt={Date.now()} maxAge={90_000} />`. */
export function PageFresh({ renderedAt, maxAge = 120_000 }: { renderedAt: number; maxAge?: number }) {
  useFresh(renderedAt, maxAge);
  return null;
}

"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { classify, enterRoute, readHints } from "@/lib/motion/route";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Module scope: the last path any stage showed. It survives the template remounting on every section change
// (that is how a new stage knows where the visitor came from) and resets on a full reload, so a direct visit,
// a refresh or a shared link paints straight away with no entrance.
let lastPath: string | null = null;

/**
 * The stage a route renders into (1065), used by the studio and admin templates. It keys on the pathname
 * only, so query changes (filters, search, pagination, Settings ?tab=) never replay the entrance, and nested
 * routes (an Analytics platform tab, a ticket) still get theirs even though the template does not remount
 * for them. See lib/motion/route.ts for the motion itself.
 *
 * Runs before paint (layout effect), so the new page is never seen in place first and then animated.
 * A second click mid-transition cleans up the first (the effect's cleanup), so nothing stacks.
 */
export function RouteStage({ children, base = "" }: { children: React.ReactNode; base?: string }) {
  const path = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  // Written only once a path has committed (never during render, which React may throw away), and held in a
  // ref so React's development double effects replay the same move instead of seeing prev === path.
  const seen = useRef<{ path: string; prev: string | null } | null>(null);
  useIso(() => {
    if (seen.current?.path !== path) seen.current = { path, prev: seen.current ? seen.current.path : lastPath };
    const prev = seen.current.prev;
    lastPath = path;
    if (!prev || prev === path) return undefined;
    const move = classify(prev, path, base, readHints(prev, path));
    return move ? enterRoute(ref.current, move.kind, move.dir) : undefined;
  }, [path]);
  return (
    <div ref={ref} data-route-stage="">
      {children}
    </div>
  );
}

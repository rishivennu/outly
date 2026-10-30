"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { settleRegion } from "@/lib/motion/route";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * The part of a page whose data changes in place (1065): a list under its filters, search and pagination.
 * When `k` (the query that produced the data) changes, only this region settles, in about 220ms; the page's
 * own entrance never replays. The first paint and router.refresh() (same k) do nothing. Reduced motion: nothing.
 */
export function DataSwap({ k, children, className }: { k: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(k);
  useIso(() => {
    if (last.current === k) return undefined;
    last.current = k;
    return settleRegion(ref.current);
  }, [k]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

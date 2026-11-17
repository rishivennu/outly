"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { settleRegion } from "@/lib/motion/route";
import { flipCapture, flipPlay, loadFlip, type FlipSnapshot } from "@/lib/motion/flip";
import { onIdle } from "@/lib/client/when-idle";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * The part of a page whose data changes in place (1065): a list under its filters, search and pagination.
 * When `k` (the query that produced the data) changes, only this region settles, in about 220ms; the page's
 * own entrance never replays. The first paint and router.refresh() (same k) do nothing. Reduced motion: nothing.
 *
 * 1188: if the rows inside carry data-flip-id (admin tables do, from each row's key), the ones that are still
 * there glide from their old places to their new ones instead (GSAP Flip, lib/motion/flip.ts) and only the new
 * rows fade in. Their old positions are measured during the render that brings the new data in: at that moment
 * the DOM still holds the previous rows. No ids, no Flip, or a weak device: the plain region fade, as before.
 */
export function DataSwap({ k, children, className }: { k: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(k);
  const snap = useRef<FlipSnapshot>(null);
  // The last moment the old rows exist: React has not committed the new ones yet, so this reads First.
  if (last.current !== k && !snap.current) snap.current = flipCapture(ref.current);
  useIso(() => {
    if (last.current === k) return undefined;
    last.current = k;
    const first = snap.current;
    snap.current = null;
    return first ? flipPlay(ref.current, first) : settleRegion(ref.current);
  }, [k]);
  // Flip is fetched while the browser is idle, so the first filter click already glides.
  useEffect(() => onIdle(() => void loadFlip()), []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

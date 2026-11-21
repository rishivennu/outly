"use client";
/*
 * R1293: motion-primitives' Magnetic, rebuilt on Outlly's rules. The element drifts a few px toward the pointer while it
 * hovers, for the one primary action (the dock's and the rail's Create). Differences from the original, on purpose:
 *  - the spring is SPRING_MAGNET (overdamped, no bounce); the original's spring overshoots;
 *  - fine pointers only, and nothing under prefers-reduced-motion: x/y stay 0 and no listener is ever added;
 *  - the window pointermove listener lives only while hovered (added on pointerenter, removed on pointerleave).
 */
import { motion, useReducedMotion, useSpring } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { SPRING_MAGNET } from "@/lib/motion/tokens";

// Tuned for a 44px control: the pull peaks at range / 2 from the centre, about 6px.
export const MAGNET_INTENSITY = 0.35;
export const MAGNET_RANGE = 72;
const FINE = "(hover: hover) and (pointer: fine)";

/** Offset toward the pointer for a pointer (dx, dy) px from the centre: 0 at the centre and beyond `range`. */
export function pull(dx: number, dy: number, intensity = MAGNET_INTENSITY, range = MAGNET_RANGE) {
  const d = Math.hypot(dx, dy);
  if (d >= range) return { x: 0, y: 0 };
  const k = intensity * (1 - d / range);
  return { x: dx * k, y: dy * k };
}

type Handlers = { onPointerEnter?: () => void; onPointerLeave?: () => void };

export function useMagnet(ref: RefObject<HTMLElement | null>, opts: { intensity?: number; range?: number; off?: boolean } = {}) {
  const { intensity = MAGNET_INTENSITY, range = MAGNET_RANGE, off = false } = opts;
  const x = useSpring(0, SPRING_MAGNET);
  const y = useSpring(0, SPRING_MAGNET);
  const still = !!useReducedMotion();
  const [fine, setFine] = useState(false);
  const move = useRef<((e: PointerEvent) => void) | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(FINE);
    const sync = () => setFine(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const inert = off || still || !fine;

  const stop = useCallback(() => {
    if (move.current) window.removeEventListener("pointermove", move.current);
    move.current = null;
    x.set(0);
    y.set(0);
  }, [x, y]);

  // Turning inert mid-hover (reduced motion toggled, prop flipped) or unmounting must not leave a listener behind.
  useEffect(() => (inert ? stop() : undefined), [inert, stop]);
  useEffect(() => stop, [stop]);

  const handlers: Handlers = inert
    ? {}
    : {
        onPointerEnter: () => {
          if (move.current) return;
          move.current = (e: PointerEvent) => {
            const r = ref.current?.getBoundingClientRect();
            if (!r) return;
            const p = pull(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), intensity, range);
            x.set(p.x);
            y.set(p.y);
          };
          window.addEventListener("pointermove", move.current, { passive: true });
        },
        onPointerLeave: stop,
      };

  return { x, y, handlers };
}

export function Magnetic({ children, className, intensity, range }: { children: ReactNode; className?: string; intensity?: number; range?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { x, y, handlers } = useMagnet(ref, { intensity, range });
  return (
    <motion.div ref={ref} style={{ x, y }} {...handlers} className={cn("inline-flex", className)}>
      {children}
    </motion.div>
  );
}

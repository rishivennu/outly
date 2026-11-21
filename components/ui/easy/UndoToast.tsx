"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */
import * as React from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Check } from "lucide-react";
import { SPRING_GENTLE, motionTransitions } from "@/components/ui/easy/lib/motion-tokens";

const R = 11;
const C = 2 * Math.PI * R;

/** True when this toast is an Undo toast (lib/client/toast-core.ts action), so it gets the countdown ring. */
export const isUndoAction = (action?: { label: string }) => action?.label === "Undo";

/** Copy shown once Undo is pressed, before the toast leaves. */
export const RESTORED_TEXT = "Restored.";

/** How long the restored state stays before the toast closes. */
export const restoredHoldMs = (calm: boolean) => (calm ? 500 : 1100);

/**
 * The countdown as a ring that empties clockwise, with the seconds left in the middle. It reads the toast's own
 * clock (`left`), so pausing on hover or focus freezes it too. On Undo it refills the other way and turns
 * into a tick. Reduced motion: the ring steps once a second and the refill is instant.
 */
export function UndoRing({ total, left, restored }: { total: number; left: () => number; restored: boolean }) {
  const calm = !!useReducedMotion();
  const p = useMotionValue(1);
  const offset = useTransform(p, (v) => C * (1 - Math.max(0, Math.min(1, v))));
  const [secs, setSecs] = React.useState(Math.ceil(total / 1000));

  React.useEffect(() => {
    if (restored) {
      // Literal preset: animate() on a motion value takes a value transition, not the generic Transition type.
      const a = animate(p, 1, calm ? { duration: 0 } : SPRING_GENTLE);
      return () => a.stop();
    }
    let raf = 0;
    const tick = () => {
      const ms = Math.max(0, left());
      const s = Math.ceil(ms / 1000);
      setSecs(s);
      p.set(calm ? s / Math.ceil(total / 1000) : ms / total);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [restored, left, total, calm, p]);

  return (
    <span className="relative grid h-7 w-7 shrink-0 place-items-center" aria-hidden="true">
      <svg viewBox="0 0 28 28" className="absolute inset-0 -rotate-90">
        <circle cx="14" cy="14" r={R} fill="none" strokeWidth="2.5" className="stroke-foreground/[0.12]" />
        <motion.circle cx="14" cy="14" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-lime-ink" strokeDasharray={C} style={{ strokeDashoffset: offset }} />
      </svg>
      {restored ? (
        <motion.span initial={calm ? false : { scale: 0 }} animate={{ scale: 1 }} transition={motionTransitions.springSnappy}>
          <Check className="h-3.5 w-3.5 text-lime-ink" strokeWidth={3} />
        </motion.span>
      ) : (
        <span className="text-[11px] font-semibold tabular-nums text-foreground">{secs}</span>
      )}
    </span>
  );
}

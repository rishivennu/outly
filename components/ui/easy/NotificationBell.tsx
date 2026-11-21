"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { motionTransitions } from "@/components/ui/easy/lib/motion-tokens";

/* Outlly keeps each bell's own data, polling and panel; only the trigger's motion is taken from EasyUI's
   NotificationBell: the badge pops in, its number rolls when it changes, and the icon shakes when the count rises. */

export const SHAKE_KEYFRAMES = [0, -12, 10, -8, 6, -2, 0];
const SHAKE_MS = 600;

/**
 * True for SHAKE_MS after the count goes up. `ready` is false until the first real count has loaded: the render that
 * turns it on only records the baseline, so a page load with old unread items never shakes; later arrivals do.
 */
export function useArrivalShake(count: number, ready = true) {
  const [shaking, setShaking] = useState(false);
  const prev = useRef(count);
  const wasReady = useRef(false);
  useEffect(() => {
    const rose = ready && wasReady.current && count > prev.current;
    prev.current = count;
    wasReady.current = ready;
    if (!rose) return;
    setShaking(true);
    const t = setTimeout(() => setShaking(false), SHAKE_MS);
    return () => clearTimeout(t);
  }, [count, ready]);
  return shaking;
}

/** Direction the digits roll: up when the count grows, down when it shrinks. */
export function rollDirection(prev: string | number, next: string | number) {
  const a = typeof prev === "number" ? prev : parseInt(prev, 10) || 0;
  const b = typeof next === "number" ? next : parseInt(next, 10) || 0;
  return b >= a ? 1 : -1;
}

/** Wraps the bell icon; rocks it once when `shake` turns on. Reduced motion: no rock. */
export function BellShake({ shake, children, className }: { shake: boolean; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      className={cn("inline-grid origin-top place-items-center", className)}
      animate={shake && !reduce ? { rotate: SHAKE_KEYFRAMES } : { rotate: 0 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
    >
      {children}
    </motion.span>
  );
}

/**
 * The number inside an unread badge. Each new value slides in from below (or above when the count falls) while the
 * old one leaves, so a jump from 3 to 4 reads as a counter ticking. The badge's own shape stays with the caller.
 */
export function BadgeCount({ value, className }: { value: string | number; className?: string }) {
  const reduce = useReducedMotion();
  const text = String(value);
  const last = useRef(text);
  const dir = rollDirection(last.current, text);
  useEffect(() => {
    last.current = text;
  }, [text]);
  return (
    <span aria-hidden className={cn("relative inline-grid overflow-hidden tabular-nums [&>*]:[grid-area:1/1]", className)}>
      <AnimatePresence initial={false} custom={dir} mode="popLayout">
        <motion.span
          key={text}
          custom={dir}
          variants={{
            enter: (d: number) => (reduce ? { opacity: 0 } : { y: d > 0 ? "100%" : "-100%", opacity: 0 }),
            center: { y: "0%", opacity: 1 },
            exit: (d: number) => (reduce ? { opacity: 0 } : { y: d > 0 ? "-100%" : "100%", opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={reduce ? { duration: 0.12 } : motionTransitions.springSnappy}
          className="block"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type SpringOptions, type ValueAnimationTransition } from "framer-motion";
import { ArrowDown, Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { motionTransitions } from "@/components/ui/easy/lib/motion-tokens";

export type PullStatus = "idle" | "pulling" | "ready" | "refreshing" | "complete";

export const PULL_COPY: Record<PullStatus, string> = {
  idle: "Pull to refresh",
  pulling: "Pull to refresh",
  ready: "Release to refresh",
  refreshing: "Refreshing",
  complete: "Updated",
};

/** EasyUI's resistance curve: travel eases towards `max` the further you pull, never past it. */
export function dampedPull(raw: number, threshold: number, max: number, resistance: number): number {
  if (raw <= 0) return 0;
  return Math.min(max, max * (1 - Math.exp(-(raw * resistance) / threshold)));
}

/** True when the touch started somewhere already scrolled: the page, or any scroller between the target and it. */
export function scrolledAbove(target: Element | null): boolean {
  const page = document.scrollingElement ?? document.documentElement;
  if (page.scrollTop > 0) return true;
  for (let el = target; el && el !== document.body; el = el.parentElement) if (el.scrollTop > 0) return true;
  return false;
}

export interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  /** Off: no listener and no indicator; the children stay mounted either way. */
  enabled: boolean;
  threshold?: number;
  maxPull?: number;
  resistance?: number;
  holdOffset?: number;
  refreshLabel?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Page-level pull to refresh for the installed app. Touch events, not pointer events: with touch-action pan-y the
 * browser owns vertical pans and would cancel a pointer drag. A pull only arms when the touch starts with everything
 * scrolled to the top and moves down; any upward move hands the gesture back to native scrolling.
 */
export function PullToRefresh({ onRefresh, enabled, threshold = 68, maxPull = 110, resistance = 0.45, holdOffset = 48, refreshLabel = "Refresh", className, children }: PullToRefreshProps) {
  const [status, setStatus] = useState<PullStatus>("idle");
  const [progress, setProgress] = useState(0);
  const reduce = useReducedMotion();
  const raw = useMotionValue(0);
  const y = useSpring(raw, motionTransitions.springSnappy as SpringOptions);
  const statusRef = useRef<PullStatus>("idle");
  const set = (s: PullStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  const run = useCallback(async () => {
    if (statusRef.current === "refreshing" || statusRef.current === "complete") return;
    statusRef.current = "refreshing";
    setStatus("refreshing");
    setProgress(1);
    animate(raw, reduce ? 0 : holdOffset, motionTransitions.springSmooth as ValueAnimationTransition<number>);
    try {
      await onRefresh();
      statusRef.current = "complete";
      setStatus("complete");
      await new Promise((r) => setTimeout(r, 380));
    } catch {
      // the page keeps what it had; the next pull tries again
    } finally {
      animate(raw, 0, motionTransitions.springGentle as ValueAnimationTransition<number>);
      statusRef.current = "idle";
      setStatus("idle");
      setProgress(0);
    }
  }, [onRefresh, raw, holdOffset, reduce]);

  useEffect(() => {
    if (!enabled) return;
    let startY = 0;
    let startX = 0;
    let startT = 0;
    let armed = false;
    let pulling = false;
    let dist = 0;
    const reset = () => {
      armed = false;
      pulling = false;
      dist = 0;
    };
    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1 || statusRef.current === "refreshing" || statusRef.current === "complete") return reset();
      const t = e.touches[0];
      armed = !scrolledAbove(e.target as Element | null);
      pulling = false;
      startY = t.clientY;
      startX = t.clientX;
      startT = Date.now();
    };
    const move = (e: TouchEvent) => {
      if (!armed) return;
      const t = e.touches[0];
      const dy = t.clientY - startY;
      const dx = t.clientX - startX;
      if (!pulling) {
        // The first clear direction decides: up or sideways belongs to the page.
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) return reset();
        if (dy < 0) return reset();
        if (dy < 4) return;
        pulling = true;
      }
      if (e.cancelable) e.preventDefault();
      dist = dampedPull(dy, threshold, maxPull, resistance);
      raw.set(reduce ? 0 : dist);
      setProgress(Math.min(1, dist / threshold));
      const next = dist >= threshold ? "ready" : "pulling";
      if (statusRef.current !== next) set(next);
    };
    const up = () => {
      if (!pulling) return reset();
      const velocity = dist / Math.max(1, Date.now() - startT);
      const go = dist >= threshold || velocity > 0.35;
      reset();
      if (go) void run();
      else {
        animate(raw, 0, motionTransitions.springSmooth as ValueAnimationTransition<number>);
        set("idle");
        setProgress(0);
      }
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [enabled, threshold, maxPull, resistance, raw, run, reduce]);

  const fadeIn = useTransform(raw, [0, threshold * 0.3, threshold], [0, 0.75, 1]);
  const grow = useTransform(raw, [0, threshold], [0.75, 1]);
  const ring = 40.8; // 2 * PI * 6.5
  const busy = status === "refreshing" || status === "complete";
  const shown = status !== "idle";

  // The wrapper is the same whether or not the pull is on: switching it on after mount must not remount the page.
  return (
    <div className={cn("relative", className)} aria-busy={status === "refreshing" || undefined}>
      {enabled && (
        <motion.div
          aria-hidden="true"
          style={reduce ? { opacity: shown ? 1 : 0 } : { opacity: busy ? 1 : fadeIn, scale: busy ? 1 : grow }}
          className="pointer-events-none fixed inset-x-0 top-[calc(var(--sa-t)+12px)] z-50 flex justify-center"
        >
          <div className="flex items-center gap-2 rounded-full bg-card/95 px-3.5 py-1.5 text-xs font-medium text-foreground shadow-[0_4px_16px_hsl(var(--foreground)/0.12)] ring-1 ring-foreground/[0.08] backdrop-blur-md">
            {reduce ? (
              <RefreshCw className={cn("h-3.5 w-3.5", status === "refreshing" && "animate-spin")} />
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                {status === "refreshing" ? (
                  <motion.span key="spin" className="grid h-4 w-4 place-items-center" animate={{ rotate: 360 }} transition={{ duration: 0.75, repeat: Infinity, ease: "linear" }}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </motion.span>
                ) : status === "complete" ? (
                  <motion.span key="done" className="grid h-4 w-4 place-items-center rounded-full bg-lime text-lime-foreground" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={motionTransitions.springSnappy}>
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  </motion.span>
                ) : (
                  <span key="ring" className="relative grid h-4 w-4 place-items-center">
                    <svg className="h-4 w-4 -rotate-90" viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="6.5" className="stroke-foreground/15" strokeWidth="1.6" fill="none" />
                      <circle cx="8" cy="8" r="6.5" className="stroke-lime-ink" strokeWidth="1.8" fill="none" strokeDasharray={ring} strokeDashoffset={ring * (1 - progress)} strokeLinecap="round" />
                    </svg>
                    <motion.span className="absolute inset-0 grid place-items-center text-foreground/60" animate={{ rotate: status === "ready" ? 180 : 0 }} transition={motionTransitions.springSnappy}>
                      <ArrowDown className="h-2.5 w-2.5" />
                    </motion.span>
                  </span>
                )}
              </AnimatePresence>
            )}
            <span className="text-[11px] text-foreground/80">{PULL_COPY[status]}</span>
          </div>
        </motion.div>
      )}
      <motion.div style={{ y: reduce ? 0 : y }}>{children}</motion.div>
      {enabled && (
        <>
          <p className="sr-only" role="status" aria-live="polite">{status === "refreshing" ? "Refreshing" : status === "complete" ? "Updated" : ""}</p>
          <button type="button" onClick={() => void run()} disabled={busy} className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-3 focus:text-sm">
            {refreshLabel}
          </button>
        </>
      )}
    </div>
  );
}

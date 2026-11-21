"use client";
/*
 * R1293: motion-primitives' TransitionPanel (npx motion-primitives add transition-panel), rebuilt on Outlly's rules.
 * One child shows at a time; when `activeIndex` changes the old panel leaves and the new one arrives in its place
 * (AnimatePresence popLayout: the leaving panel is lifted out of the flow, so nothing around it jumps while both
 * are on screen). Differences from the original, on purpose:
 *  - the curves come from the tokens: arrival T.nav (300ms ease-out), exit T.menuExit (150ms ease-in), no spring;
 *  - `dir` says which side the new panel comes from (1: from the right, forward; -1: from the left, back), 16px;
 *  - prefers-reduced-motion: a plain fade, nothing travels.
 */
import { AnimatePresence, motion, useReducedMotion, type Variant } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { T } from "@/lib/motion/tokens";

export type PanelDir = 1 | -1;

export type TransitionPanelProps = {
  /** One node per panel; only children[activeIndex] is rendered. */
  children: ReactNode[];
  activeIndex: number;
  /** Where the arriving panel comes from: 1 from the right (forward), -1 from the left (back). */
  dir?: PanelDir;
  className?: string;
  /** Classes for the moving wrapper around the active panel. */
  panelClassName?: string;
  variants?: { enter: Variant; center: Variant; exit: Variant };
};

/** How far a panel travels, px. Small on purpose: inside a popover 16px reads like a page would at 40. */
export const PANEL_TRAVEL = 16;

export const panelVariants = {
  enter: (dir: PanelDir) => ({ opacity: 0, x: PANEL_TRAVEL * dir }),
  center: { opacity: 1, x: 0, transition: T.nav },
  exit: (dir: PanelDir) => ({ opacity: 0, x: -PANEL_TRAVEL * 0.75 * dir, transition: T.menuExit }),
};
const fadeVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: T.fade },
  exit: { opacity: 0, transition: T.fade },
};

export function TransitionPanel({ children, activeIndex, dir = 1, className, panelClassName, variants }: TransitionPanelProps) {
  const still = useReducedMotion();
  return (
    <div className={cn("relative", className)}>
      <AnimatePresence initial={false} mode="popLayout" custom={dir}>
        <motion.div key={activeIndex} custom={dir} variants={still ? fadeVariants : (variants ?? panelVariants)} initial="enter" animate="center" exit="exit" className={panelClassName}>
          {children[activeIndex]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Which way to slide when moving from one index to another (same index: forward). */
export const panelDir = (from: number, to: number): PanelDir => (to < from ? -1 : 1);

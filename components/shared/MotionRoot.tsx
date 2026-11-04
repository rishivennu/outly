"use client";
import { MotionConfig } from "framer-motion";
import { T } from "@/lib/motion/tokens";

/**
 * reducedMotion="user": with the OS setting on, transforms/layout animations are dropped and only opacity fades remain.
 * 1119: the default transition is the token card tween (450ms, ease-out, no overshoot), so any motion element that
 * does not name its own timing still moves in the shared language.
 */
export function MotionRoot({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={T.card}>
      {children}
    </MotionConfig>
  );
}

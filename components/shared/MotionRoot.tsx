"use client";
import { MotionConfig } from "framer-motion";

/** reducedMotion="user": with the OS setting on, transforms/layout animations are dropped and only opacity fades remain. */
export function MotionRoot({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.8 }}>
      {children}
    </MotionConfig>
  );
}

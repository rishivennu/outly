"use client";

// R1238: the rail icon for Content Intelligence. Drawing from lucide-react's Sparkles (ISC), animated in the house
// pattern of the other icons here (lucide-animated, MIT, see LICENSE.md): the big spark scales, the two small ones
// fade in after it. Reduced motion is handled by the parent (useIconPlay never starts it).

import type { Transition } from "framer-motion";
import { motion, useAnimation } from "framer-motion";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface SparklesIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SparklesIconProps extends HTMLAttributes<HTMLSpanElement> {
  size?: number;
}

const DEFAULT_TRANSITION: Transition = { type: "spring", bounce: 0, duration: 0.3 };

const SparklesIcon = forwardRef<SparklesIconHandle, SparklesIconProps>(({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => controls.start("animate"),
      stopAnimation: () => controls.start("normal"),
    };
  });

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      if (isControlledRef.current) onMouseEnter?.(e);
      else controls.start("animate");
    },
    [controls, onMouseEnter],
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      if (isControlledRef.current) onMouseLeave?.(e);
      else controls.start("normal");
    },
    [controls, onMouseLeave],
  );

  return (
    <span className={cn("inline-flex", className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
      <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
        <motion.path
          animate={controls}
          d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
          style={{ originX: "12px", originY: "12px" }}
          transition={DEFAULT_TRANSITION}
          variants={{ animate: { scale: 1.08, rotate: 8 }, normal: { scale: 1, rotate: 0 } }}
        />
        <motion.path animate={controls} d="M20 3v4" transition={{ ...DEFAULT_TRANSITION, delay: 0.08 }} variants={{ animate: { translateY: -1 }, normal: { translateY: 0 } }} />
        <motion.path animate={controls} d="M22 5h-4" transition={{ ...DEFAULT_TRANSITION, delay: 0.08 }} variants={{ animate: { translateX: 1 }, normal: { translateX: 0 } }} />
        <motion.path animate={controls} d="M4 17v2" transition={{ ...DEFAULT_TRANSITION, delay: 0.14 }} variants={{ animate: { translateY: 1 }, normal: { translateY: 0 } }} />
        <motion.path animate={controls} d="M6 18H2" transition={{ ...DEFAULT_TRANSITION, delay: 0.14 }} variants={{ animate: { translateX: -1 }, normal: { translateX: 0 } }} />
      </svg>
    </span>
  );
});

SparklesIcon.displayName = "SparklesIcon";

export { SparklesIcon };

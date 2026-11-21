"use client";

// Drawn from lucide's Handshake (ISC), animated in the lucide-animated style used by its neighbours (R1289):
// the two hands meet in a short shake. framer-motion is already in the app; the wrapper is an inline-flex <span>.

import type { Variants } from "framer-motion";
import { motion, useAnimation } from "framer-motion";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface HandshakeIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface HandshakeIconProps extends HTMLAttributes<HTMLSpanElement> {
  size?: number;
}

const SHAKE: Variants = {
  normal: { rotate: 0, y: 0 },
  animate: {
    rotate: [0, -6, 5, -3, 0],
    y: [0, 0.6, -0.4, 0.3, 0],
    transition: { duration: 0.6, times: [0, 0.25, 0.5, 0.75, 1], ease: "easeInOut" },
  },
};

const HandshakeIcon = forwardRef<HandshakeIconHandle, HandshakeIconProps>(({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
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
        <motion.g animate={controls} variants={SHAKE} style={{ originX: "50%", originY: "50%" }}>
          <path d="m11 17 2 2a1 1 0 1 0 3-3" />
          <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
          <path d="m21 3 1 11h-2" />
          <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
          <path d="M3 4h8" />
        </motion.g>
      </svg>
    </span>
  );
});

HandshakeIcon.displayName = "HandshakeIcon";

export { HandshakeIcon };

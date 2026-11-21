"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. The block itself is the shared Skeleton
   (components/shared/Skeleton.tsx), which keeps working in server components. */

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * Swaps a placeholder for the real content, which eases in (fade, rise, un-blur). Size the placeholder like the
 * content so nothing jumps. Reduced motion: a plain fade.
 */
export function SkeletonReveal({ loading, skeleton, children, className, contentClassName, label = "Loading" }: { loading: boolean; skeleton: ReactNode; children: ReactNode; className?: string; contentClassName?: string; label?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={className}>
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.div key="skeleton" role="status" aria-busy="true" aria-label={label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            {skeleton}
          </motion.div>
        ) : (
          <motion.div
            key="content"
            className={contentClassName}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

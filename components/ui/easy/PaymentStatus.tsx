"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, CreditCard, RotateCcw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { motionTransitions } from "@/components/ui/easy/lib/motion-tokens";

export type PaymentLifecycleStatus = "processing" | "verifying" | "success" | "failed" | "refunded";

/** A tick that draws itself. `animate` false (or reduced motion) paints it finished. */
export function DrawnCheck({ animate = true, delay = 0.1, strokeWidth = 2.5, className }: { animate?: boolean; delay?: number; strokeWidth?: number; className?: string }) {
  const reduce = useReducedMotion();
  const draw = animate && !reduce;
  return (
    <svg className={cn("h-7 w-7", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <motion.path d="M20 6L9 17l-5-5" initial={draw ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay, ease: "easeOut" }} />
    </svg>
  );
}

const DISC = "relative grid place-items-center rounded-full";

/** The round status mark: a spinning ring while it works, the drawn tick on success, the alert on failure. */
export function PaymentStatusIcon({ status, size = "md", className }: { status: PaymentLifecycleStatus; size?: "sm" | "md"; className?: string }) {
  const reduce = useReducedMotion();
  const box = size === "sm" ? "h-9 w-9" : "h-14 w-14";
  const pop = reduce ? { initial: false as const } : { initial: { scale: 0.8, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: motionTransitions.springSnappy };
  const spin = (inset: string, ms: number) => (
    <motion.span aria-hidden="true" className={cn("absolute rounded-full border-2 border-foreground/15 border-t-foreground", inset)} animate={reduce ? undefined : { rotate: 360 }} transition={{ duration: ms, repeat: Infinity, ease: "linear" }} />
  );
  if (status === "processing")
    return (
      <span className={cn(DISC, box, "bg-foreground/[0.06]", className)}>
        {spin("inset-0", 1.2)}
        <CreditCard className="h-5 w-5 text-foreground/60" aria-hidden="true" />
      </span>
    );
  if (status === "verifying")
    return (
      <span className={cn(DISC, box, "bg-foreground/[0.06]", className)}>
        {spin("inset-1", 1)}
        <ShieldCheck className="h-6 w-6 text-foreground" aria-hidden="true" />
      </span>
    );
  if (status === "success")
    return (
      <motion.span {...pop} className={cn(DISC, box, "lime-bg", className)}>
        <DrawnCheck className={size === "sm" ? "h-5 w-5" : "h-7 w-7"} />
      </motion.span>
    );
  if (status === "failed")
    return (
      <motion.span {...pop} className={cn(DISC, box, "bg-destructive/10 text-destructive", className)}>
        <AlertCircle className={size === "sm" ? "h-5 w-5" : "h-7 w-7"} aria-hidden="true" />
      </motion.span>
    );
  return (
    <motion.span {...pop} className={cn(DISC, box, "bg-foreground/[0.06] text-foreground/60", className)}>
      <RotateCcw className="h-6 w-6" aria-hidden="true" />
    </motion.span>
  );
}

/**
 * The staged result: mark, title and line swap together as the status moves (verifying, then confirmed), and
 * `children` (details or recovery actions) rise in under them.
 */
export function PaymentStatus({ status, title, message, children, className }: { status: PaymentLifecycleStatus; title: ReactNode; message?: ReactNode; children?: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <div className="mb-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={status} className="block" exit={reduce ? undefined : { opacity: 0, scale: 0.9 }} transition={motionTransitions.easeFast}>
            <PaymentStatusIcon status={status} />
          </motion.span>
        </AnimatePresence>
      </div>
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      {message && <p className="mt-1 max-w-xs text-sm text-muted-foreground">{message}</p>}
      {children && (
        <motion.div className="mt-5 w-full" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={motionTransitions.springGentle}>
          {children}
        </motion.div>
      )}
    </div>
  );
}

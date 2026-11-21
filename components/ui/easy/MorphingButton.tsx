"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */
import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { motionTransitions } from "@/components/ui/easy/lib/motion-tokens";
import { cn } from "@/lib/utils";

export type ButtonStatusState = "idle" | "loading" | "success" | "error";

export interface MorphingButtonProps extends Omit<ButtonProps, "asChild"> {
  status?: ButtonStatusState;
  /** The idle face. */
  children: React.ReactNode;
  loadingText?: React.ReactNode;
  successText?: React.ReactNode;
  /** Truncated to the button's width; show the full message beside the form too. */
  errorText?: React.ReactNode;
}

const ENTER = { idle: { opacity: 0, y: -6 }, loading: { opacity: 0, y: 6 }, success: { opacity: 0, scale: 0.8 }, error: { opacity: 0, scale: 0.8 } } as const;
const EXIT = { idle: { opacity: 0, y: 6 }, loading: { opacity: 0, y: -6 }, success: { opacity: 0, scale: 0.8 }, error: { opacity: 0, scale: 0.8 } } as const;

/**
 * The shared Button (so phone glass, press scale and variants stay), with a face that morphs between idle,
 * loading, success and error. The width never jumps: invisible copies of the idle, loading and success faces
 * size the button, and the live face sits over them. Loading also disables the button.
 */
export const MorphingButton = React.forwardRef<HTMLButtonElement, MorphingButtonProps>(function MorphingButton(
  { status = "idle", children, loadingText = "Saving", successText = "Saved", errorText = "Failed", disabled, className, ...props },
  ref,
) {
  const calm = useReducedMotion();
  const busy = status === "loading";
  const t = calm ? { duration: 0 } : motionTransitions.springSnappy;

  const face = (s: ButtonStatusState) =>
    s === "loading" ? (
      <>
        <Loader2 className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <span>{loadingText}</span>
      </>
    ) : s === "success" ? (
      <>
        <Check className="h-[18px] w-[18px]" strokeWidth={2.75} aria-hidden="true" />
        <span>{successText}</span>
      </>
    ) : s === "error" ? (
      <>
        <AlertCircle className="h-[18px] w-[18px]" aria-hidden="true" />
        <span className="min-w-0 truncate">{errorText}</span>
      </>
    ) : (
      children
    );

  return (
    <Button ref={ref} disabled={disabled || busy} aria-busy={busy || undefined} data-status={status} className={cn("overflow-hidden", className)} {...props}>
      <span className="relative grid max-w-full place-items-center">
        {(["idle", "loading", "success"] as const).map((s) => (
          <span key={s} aria-hidden="true" className="invisible flex items-center gap-2 [grid-area:1/1]">
            {face(s)}
          </span>
        ))}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={status}
            initial={ENTER[status]}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={EXIT[status]}
            transition={t}
            className="absolute inset-0 flex min-w-0 items-center justify-center gap-2"
          >
            {face(status)}
          </motion.span>
        </AnimatePresence>
      </span>
    </Button>
  );
});

"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Archive, ArrowRight, Check, ChevronRight, Lock, Trash2, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { SPRING_RESPONSIVE, SPRING_SNAPPY } from "@/components/ui/easy/lib/motion-tokens";

export type DragConfirmActionType = "delete" | "archive" | "confirm" | "submit" | "unlock" | "continue";
export type DragConfirmVariant = "default" | "danger" | "warning";
export type DragConfirmSize = "md" | "lg";

export interface DragToConfirmProps {
  label?: string;
  /** Longer name for assistive tech when the visible label is short (defaults to label). */
  ariaLabel?: string;
  confirmedLabel?: string;
  actionType?: DragConfirmActionType;
  variant?: DragConfirmVariant;
  size?: DragConfirmSize;
  icon?: ReactNode;
  confirmedIcon?: ReactNode;
  isConfirmed?: boolean;
  onConfirm?: () => void;
  onReset?: () => void;
  /** Slide back to the start this long after confirming (ms). 0 keeps it confirmed. */
  autoResetDelay?: number;
  disabled?: boolean;
  haptic?: boolean;
  className?: string;
}

/* Both sizes keep a 44px thumb (the touch-target floor); the track is the thumb plus its padding. */
const SIZE_CONFIG = {
  md: { trackHeight: "h-[52px]", padding: "p-1", thumbSize: 44, thumbClass: "h-11 w-11", offset: 52, text: "text-[13px]", iconSize: "h-4 w-4" },
  lg: { trackHeight: "h-14", padding: "p-1.5", thumbSize: 44, thumbClass: "h-11 w-11", offset: 56, text: "text-[14px]", iconSize: "h-[18px] w-[18px]" },
} as const;

/** Share of the track the thumb must cross before a release counts as a confirm. */
// Literal presets from the shared token file: animate() on a MotionValue rejects the wider Transition type.
const SNAP = SPRING_SNAPPY;
const SETTLE = SPRING_RESPONSIVE;
const INSTANT = { duration: 0 } as const;

export const CONFIRM_AT = 0.85;

export function reachedConfirm(x: number, max: number) {
  return max > 0 && x >= max * CONFIRM_AT;
}

const TONE = {
  danger: {
    fill: "bg-destructive/15",
    confirmedTrack: "bg-destructive/10",
    confirmedHandle: "bg-destructive text-destructive-foreground",
    confirmedText: "font-semibold text-destructive",
    iconColor: "text-destructive",
  },
  warning: {
    fill: "bg-warning/15",
    confirmedTrack: "bg-warning/10",
    confirmedHandle: "bg-warning text-[hsl(var(--lime-foreground))]",
    confirmedText: "font-semibold text-warning-ink",
    iconColor: "text-warning-ink",
  },
  default: {
    fill: "bg-lime/20",
    confirmedTrack: "bg-lime/15",
    confirmedHandle: "bg-lime text-[hsl(var(--lime-foreground))]",
    confirmedText: "font-semibold text-lime-ink",
    iconColor: "text-foreground",
  },
} as const;

export function DragToConfirm({
  label = "Slide to confirm",
  ariaLabel,
  confirmedLabel = "Confirmed",
  actionType = "confirm",
  variant,
  size = "md",
  icon,
  confirmedIcon,
  isConfirmed: controlledConfirmed,
  onConfirm,
  onReset,
  autoResetDelay = 2500,
  disabled = false,
  haptic = true,
  className,
}: DragToConfirmProps) {
  const [internalConfirmed, setInternalConfirmed] = useState(false);
  const isConfirmed = controlledConfirmed !== undefined ? controlledConfirmed : internalConfirmed;
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragMax, setDragMax] = useState(200);
  const [progress, setProgress] = useState(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const cfg = SIZE_CONFIG[size] ?? SIZE_CONFIG.md;
  const toneKey = variant ?? (actionType === "delete" ? "danger" : actionType === "unlock" ? "warning" : "default");
  const tone = TONE[toneKey];

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setDragMax(Math.max(40, el.offsetWidth - cfg.offset));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cfg.offset]);

  useEffect(() => {
    if (controlledConfirmed === undefined) return;
    animate(x, controlledConfirmed ? dragMax : 0, reduce ? INSTANT : controlledConfirmed ? SNAP : SETTLE);
  }, [controlledConfirmed, dragMax, reduce, x]);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  useEffect(() => x.on("change", (v) => setProgress(Math.round((v / (dragMax || 1)) * 100))), [x, dragMax]);

  const textOpacity = useTransform(x, [0, dragMax * 0.55], [1, 0]);
  const textTranslateX = useTransform(x, [0, dragMax * 0.55], [0, 8]);
  const progressFillWidth = useTransform(x, (v) => `${Math.min(dragMax + cfg.thumbSize + 4, v + cfg.thumbSize + 4)}px`);

  const triggerHaptic = useCallback(() => {
    if (!haptic || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    try {
      navigator.vibrate(22);
    } catch {
      // the device may refuse vibration
    }
  }, [haptic]);

  const confirmAction = useCallback(() => {
    triggerHaptic();
    animate(x, dragMax, reduce ? INSTANT : SNAP);
    if (controlledConfirmed === undefined) setInternalConfirmed(true);
    onConfirm?.();
    if (autoResetDelay > 0) {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        if (controlledConfirmed === undefined) setInternalConfirmed(false);
        animate(x, 0, reduce ? INSTANT : SETTLE);
        onReset?.();
      }, autoResetDelay);
    }
  }, [autoResetDelay, controlledConfirmed, dragMax, onConfirm, onReset, reduce, triggerHaptic, x]);

  const handleDragEnd = () => {
    if (reachedConfirm(x.get(), dragMax) && !isConfirmed) confirmAction();
    else animate(x, 0, reduce ? INSTANT : SETTLE);
  };

  const handleKeyboardConfirm = () => {
    if (disabled || isConfirmed) return;
    confirmAction();
  };

  const actionIcon = () => {
    const c = cn(cfg.iconSize, tone.iconColor);
    switch (actionType) {
      case "delete":
        return <Trash2 className={c} aria-hidden />;
      case "unlock":
        return isConfirmed ? <Unlock className={cfg.iconSize} aria-hidden /> : <Lock className={c} aria-hidden />;
      case "archive":
        return <Archive className={c} aria-hidden />;
      case "submit":
        return <ArrowRight className={c} aria-hidden />;
      default:
        return <ChevronRight className={c} aria-hidden />;
    }
  };

  return (
    <div className={cn("w-full max-w-sm select-none", className)}>
      <div
        ref={trackRef}
        className={cn(
          "relative flex items-center overflow-hidden rounded-full transition-[background-color,opacity] duration-200",
          cfg.trackHeight,
          cfg.padding,
          isConfirmed ? tone.confirmedTrack : "bg-secondary/70 shadow-[inset_0_1px_2px_hsl(var(--foreground)/0.06)]",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <motion.div style={{ width: isConfirmed ? "100%" : progressFillWidth }} className={cn("pointer-events-none absolute bottom-0 left-0 top-0 z-0 rounded-full transition-colors duration-200", tone.fill)} />

        <motion.div
          aria-hidden
          style={{ opacity: isConfirmed ? 0 : textOpacity, x: textTranslateX }}
          className={cn("pointer-events-none absolute inset-0 z-10 flex select-none items-center justify-center pl-12 pr-4 font-medium text-muted-foreground", cfg.text)}
        >
          <span className="truncate">{label}</span>
        </motion.div>

        {isConfirmed && (
          <motion.div
            aria-hidden
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={SNAP}
            className={cn("pointer-events-none absolute inset-0 z-10 flex select-none items-center justify-center", cfg.text, tone.confirmedText)}
          >
            {confirmedLabel}
          </motion.div>
        )}

        <motion.div
          drag={disabled || isConfirmed ? false : "x"}
          dragConstraints={{ left: 0, right: dragMax }}
          dragElastic={0.06}
          dragMomentum={false}
          style={{ x }}
          onDragEnd={handleDragEnd}
          whileDrag={reduce ? undefined : { scale: 1.04 }}
          transition={SNAP}
          className={cn(
            cfg.thumbClass,
            "relative z-20 flex cursor-grab touch-none select-none items-center justify-center rounded-full outline-none transition-[background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-background active:cursor-grabbing",
            isConfirmed ? tone.confirmedHandle : "bg-card text-foreground shadow-[0_1px_3px_hsl(var(--foreground)/0.12),0_6px_16px_-8px_hsl(var(--foreground)/0.3)]",
            disabled && "cursor-not-allowed",
          )}
          tabIndex={disabled ? -1 : 0}
          role="slider"
          aria-label={ariaLabel ?? label}
          aria-disabled={disabled || undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={isConfirmed ? 100 : progress}
          aria-valuetext={isConfirmed ? confirmedLabel : "Not confirmed. Press Enter or Space to confirm"}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight" || e.key === "End") {
              e.preventDefault();
              handleKeyboardConfirm();
            }
          }}
        >
          {isConfirmed ? (
            <motion.span initial={reduce ? { opacity: 0 } : { scale: 0, rotate: -20 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={SNAP}>
              {confirmedIcon ?? <Check className={cn(cfg.iconSize, "stroke-[2.5]")} aria-hidden />}
            </motion.span>
          ) : (
            icon ?? actionIcon()
          )}
        </motion.div>
      </div>

      <div className="sr-only">
        <button type="button" onClick={handleKeyboardConfirm} disabled={disabled || isConfirmed}>
          {ariaLabel ?? label}
        </button>
      </div>
    </div>
  );
}

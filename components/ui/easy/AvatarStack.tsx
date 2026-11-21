"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */

import { useState, type HTMLAttributes } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { motionTransitions } from "@/components/ui/easy/lib/motion-tokens";

export interface AvatarStackItem {
  id: string | number;
  src?: string;
  alt?: string;
  name?: string;
  fallback?: string;
  /** Lime tint behind the initials (e.g. active members), plain otherwise. */
  highlight?: boolean;
}

export interface AvatarStackProps extends HTMLAttributes<HTMLDivElement> {
  avatars: AvatarStackItem[];
  /** Avatars shown before the +N badge */
  max?: number;
  size?: "md" | "lg";
  overlap?: "sm" | "md" | "lg";
  showCount?: boolean;
  showTooltip?: boolean;
  /** Plural noun for the +N badge label (default "more") */
  moreLabel?: string;
}

const sizeClasses = { md: "h-9 w-9 text-[12px]", lg: "h-11 w-11 text-[13px]" };
const overlapClasses = { sm: "-ml-2", md: "-ml-3", lg: "-ml-4" };

export function getInitials(name?: string) {
  if (!name?.trim()) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** Visible avatars and the hidden remainder for a given max. */
export function splitStack<T>(avatars: T[], max: number) {
  const m = Math.max(0, max);
  return { visible: avatars.slice(0, m), remaining: Math.max(avatars.length - m, 0) };
}

export function AvatarStack({ avatars, max = 5, size = "lg", overlap = "md", showCount = true, showTooltip = true, moreLabel = "more", className, ...props }: AvatarStackProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const { visible, remaining } = splitStack(avatars, max);

  return (
    <div className={cn("flex items-center", className)} role="group" {...props}>
      {visible.map((avatar, index) => {
        const isHovered = hoveredIndex === index;
        const displayName = avatar.name ?? avatar.alt;
        return (
          <div
            key={avatar.id}
            className={cn("relative shrink-0 select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-background", index > 0 && overlapClasses[overlap])}
            style={{ zIndex: isHovered ? 50 : visible.length - index }}
            tabIndex={showTooltip && displayName ? 0 : undefined}
            role="img"
            aria-label={displayName ?? undefined}
            onPointerEnter={(e) => e.pointerType === "mouse" && setHoveredIndex(index)}
            onPointerLeave={() => setHoveredIndex((h) => (h === index ? null : h))}
            onFocus={() => setHoveredIndex(index)}
            onBlur={() => setHoveredIndex((h) => (h === index ? null : h))}
          >
            <AnimatePresence>
              {showTooltip && isHovered && displayName && (
                <motion.span
                  aria-hidden
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.94 }}
                  transition={motionTransitions.springSnappy}
                  className="pointer-events-none absolute -top-9 left-1/2 z-[60] -translate-x-1/2 whitespace-nowrap rounded-xl bg-foreground px-2.5 py-1 text-[12px] font-medium text-background shadow-lg"
                >
                  {displayName}
                </motion.span>
              )}
            </AnimatePresence>
            <motion.div
              animate={reduce ? undefined : { scale: isHovered ? 1.15 : 1, y: isHovered ? -4 : 0 }}
              transition={motionTransitions.springSnappy}
              className={cn("relative overflow-hidden rounded-full ring-2 ring-card", avatar.highlight ? "bg-lime/20 text-lime-ink" : "bg-secondary text-muted-foreground", sizeClasses[size])}
            >
              {avatar.src ? (
                <img src={avatar.src} alt="" className="block h-full w-full object-cover" loading="lazy" />
              ) : (
                <span className="flex h-full w-full items-center justify-center font-semibold" aria-hidden>
                  {avatar.fallback ?? getInitials(displayName)}
                </span>
              )}
            </motion.div>
          </div>
        );
      })}
      {showCount && remaining > 0 && (
        <span
          className={cn("relative z-0 flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold tabular-nums text-muted-foreground ring-2 ring-card", overlapClasses[overlap], sizeClasses[size])}
          role="img"
          aria-label={`${remaining} ${moreLabel}`}
        >
          +{remaining}
        </span>
      )}
    </div>
  );
}

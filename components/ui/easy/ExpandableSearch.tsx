"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */
import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Search, X } from "lucide-react";
import { motionTransitions } from "@/components/ui/easy/lib/motion-tokens";
import { cn } from "@/lib/utils";

export interface ExpandableSearchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "className"> {
  value: string;
  /** Called by the clear button; focus goes back to the field. */
  onClear: () => void;
  /** Resting and focused max widths, in px. The field never grows past its container. */
  compactWidth?: number;
  expandedWidth?: number;
  /** A key that focuses the field from anywhere on the page (not while typing elsewhere). */
  shortcut?: string;
  className?: string;
  inputClassName?: string;
  /** Rendered inside the positioned wrapper, e.g. a suggestions list. */
  children?: React.ReactNode;
}

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * A search field that rests as a narrower pill and widens while it is in use (focused or holding a query).
 * Shows the shortcut key while empty and a 44px clear button once there is a query.
 */
export const ExpandableSearch = React.forwardRef<HTMLInputElement, ExpandableSearchProps>(function ExpandableSearch(
  { value, onClear, compactWidth = 448, expandedWidth = 672, shortcut = "/", className, inputClassName, children, onFocus, onBlur, ...props },
  fwd,
) {
  const calm = useReducedMotion();
  const inner = React.useRef<HTMLInputElement>(null);
  React.useImperativeHandle(fwd, () => inner.current as HTMLInputElement);
  const [focused, setFocused] = React.useState(false);
  const wide = focused || value.length > 0;

  React.useEffect(() => {
    if (!shortcut) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== shortcut || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
      e.preventDefault();
      inner.current?.focus();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [shortcut]);

  return (
    <motion.div
      initial={false}
      animate={{ maxWidth: wide ? expandedWidth : compactWidth }}
      transition={calm ? { duration: 0 } : motionTransitions.springMorph}
      data-expanded={wide || undefined}
      className={cn("relative mx-auto w-full", className)}
    >
      <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inner}
        value={value}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        aria-keyshortcuts={shortcut || undefined}
        className={cn("w-full pl-14 pr-14 [&::-webkit-search-cancel-button]:hidden", inputClassName)}
        {...props}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onClear();
            inner.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--ring))]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        shortcut &&
        !focused && (
          <kbd aria-hidden="true" className="pointer-events-none absolute right-5 top-1/2 hidden h-7 min-w-7 -translate-y-1/2 place-items-center rounded-lg border border-foreground/[0.08] bg-background/60 px-2 font-mono text-[12px] text-muted-foreground [@media(hover:hover)]:grid">
            {shortcut}
          </kbd>
        )
      )}
      {children}
    </motion.div>
  );
});

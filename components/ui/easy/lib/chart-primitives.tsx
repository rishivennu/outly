"use client";

/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { motion, useSpring } from "framer-motion";
import { SPRING_FOLLOW } from "./motion-tokens";

/* -------------------------------------------------------------------------- */
/*  Shared chart primitives                                                    */
/*                                                                             */
/*  Used by BarChart, DonutChart and ActivityHeatmap. Kept in src/lib so the   */
/*  registry generator ships it as a shared `registry:lib` dependency.         */
/* -------------------------------------------------------------------------- */

// Outlly palette: lime first, then deep green and supporting hues that read in both themes.
export const CHART_COLORS = ["#B5FF00", "#173A24", "#6d7cff", "#ffb44c", "#ff6b8b", "#5ac8fa"];

export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const SPRING = { type: "spring", duration: 0.5, bounce: 0 } as const;

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

const compactFmt = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
export const fullFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
export const defaultFormat = (n: number) => fullFmt.format(n);
export const defaultTick = (n: number) => compactFmt.format(n);

export const ring = "ring-1 ring-foreground/[0.08]";
export const muted = "text-foreground/60";
export const focus =
  "outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]";

// "Nice" step so that step × 4 covers `raw × 4`
export function niceStep(raw: number) {
  if (!(raw > 0) || !isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = raw / 10 ** exp;
  const nice = base <= 1 ? 1 : base <= 2 ? 2 : base <= 2.5 ? 2.5 : base <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

/** Container width via ResizeObserver (initial value keeps SSR output sensible) */
export function useElementWidth<T extends HTMLElement>(initial: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.round(el.clientWidth) || initial);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [initial]);
  return [ref, width] as const;
}

/** Clear a hover/tap selection when the user taps outside the chart (touch) */
export function useDismissOutside(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [ref, open, close]);
}

/* ---------------------------------- Tooltip -------------------------------- */

export function Tooltip({
  pos,
  boundsWidth,
  children,
}: {
  pos: { x: number; y: number } | null;
  boundsWidth: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(false);
  const x = useSpring(0, SPRING_FOLLOW);
  const y = useSpring(0, SPRING_FOLLOW);

  useLayoutEffect(() => {
    if (!pos) {
      seen.current = false;
      return;
    }
    const w = ref.current?.offsetWidth ?? 130;
    const h = ref.current?.offsetHeight ?? 60;

    // Stay inside the chart, then nudge back inside the viewport so the
    // tooltip never gets clipped when the card sits near a screen edge.
    let tx = clamp(pos.x - w / 2, 0, Math.max(0, boundsWidth - w));

    // Prefer above the anchor, flip below when the top is cramped, and clamp
    // to the viewport when neither side has enough room.
    let ty = pos.y - h - 12;

    const host = ref.current?.offsetParent as HTMLElement | null;
    const box = host?.getBoundingClientRect();
    if (box && typeof window !== "undefined") {
      const pad = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      tx = clamp(tx, pad - box.left, Math.max(pad - box.left, vw - pad - w - box.left));

      const anchorY = box.top + pos.y;
      const spaceAbove = anchorY - pad;
      const spaceBelow = vh - pad - anchorY;
      if (spaceAbove < h + 12 && spaceBelow > spaceAbove) ty = pos.y + 18;
      ty = clamp(ty, pad - box.top, Math.max(pad - box.top, vh - pad - h - box.top));
    } else if (ty < 0) {
      ty = pos.y + 18;
    }

    if (!seen.current) {
      x.jump(tx);
      y.jump(ty);
      seen.current = true;
    } else {
      x.set(tx);
      y.set(ty);
    }
  }, [pos, boundsWidth, x, y]);

  return (
    <motion.div
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute left-0 top-0 z-20 min-w-[112px] rounded-xl bg-card/95 px-3 py-2 text-[12px] text-foreground shadow-lg backdrop-blur ${ring}`}
      style={{ x, y }}
      initial={false}
      animate={{ opacity: pos ? 1 : 0 }}
      transition={{ duration: 0.14, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

export function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />;
}

/* ---------------------------------- Card ----------------------------------- */

export function ChartCard({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-[20px] bg-card p-4 text-foreground/80 sm:p-5 ${ring} ${className}`}
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 24px 48px -32px rgba(0,0,0,0.18)" }}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium tracking-[-0.01em] text-foreground">{title}</h3>
          {description && <p className={`mt-0.5 text-[12.5px] ${muted}`}>{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex shrink-0 rounded-full bg-foreground/[0.05] p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`relative z-10 h-8 rounded-full px-3.5 text-[12px] font-medium transition-colors duration-150 [-webkit-tap-highlight-color:transparent] sm:h-7 sm:px-3 ${focus} ${
              on ? "text-foreground" : "text-foreground/60"
            }`}
          >
            {on && (
              <motion.span
                layoutId={id}
                className="absolute inset-0 -z-10 rounded-full bg-card shadow-sm"
                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

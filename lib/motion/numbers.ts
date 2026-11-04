/**
 * Round 1 (1102): how analytics numbers count up. Pure (unit tested); the component is
 * components/shared/AnimatedNumber.tsx.
 *
 * Timings from the brief: a page's main number 1200ms, secondary numbers 900ms, percentages 800ms ease-out,
 * a refresh (the value changed while on screen) 700ms. Charts draw in 700ms ease-in-out.
 */
import type { CSSProperties } from "react";
import { DUR } from "./tokens";

export type Bezier = readonly [number, number, number, number];

/**
 * 1104: one ease-out-cubic for every count. The 1102 expo and quint curves covered about 80% of the distance in
 * the first frame or two, so a number read as a jump to nearly its value and then a second of the last digit
 * creeping. This one still lands softly but you can watch it count. Durations are the brief's, unchanged.
 */
export const COUNT_EASE: Bezier = [0.33, 1, 0.68, 1];
export const NUMBER_TIMING = {
  main: { ms: 1200, ease: COUNT_EASE },
  secondary: { ms: 900, ease: COUNT_EASE },
  pct: { ms: 800, ease: [0, 0, 0.58, 1] as Bezier },
  refresh: { ms: 700, ease: COUNT_EASE },
} as const;
export type NumberTier = keyof typeof NUMBER_TIMING;

/** A tier as a CSS transition timing, e.g. "900ms cubic-bezier(0.33,1,0.68,1)" (rolling digits, odometers). */
export const cssTiming = (tier: NumberTier) => {
  const { ms, ease } = NUMBER_TIMING[tier];
  return `${ms}ms cubic-bezier(${ease.join(",")})`;
};

/** Recharts props for a chart series: 700ms ease-in-out, a short stagger between series, none when reduced. */
export const CHART_MS = DUR.chart; // 700, token table (lib/motion/tokens.ts)
export function chartMotion(reduce: boolean | null | undefined, i = 0) {
  return reduce
    ? { isAnimationActive: false as const }
    : { isAnimationActive: true as const, animationBegin: 80 + i * 80, animationDuration: CHART_MS, animationEasing: "ease-in-out" as const };
}

/** Index for the .kpi-in card stagger (globals.css: token card 450ms rise of 12px, token stagger 70ms apart, capped at 420ms). */
export const riseIndex = (i: number) => ({ "--i": i }) as CSSProperties;

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of progress 0..1 (Newton steps, bisection fallback). */
export function bezier([x1, y1, x2, y2]: Bezier) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40 && hi - lo > 1e-6; i++) {
      if (sx(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : sy(solve(p)));
}

/** Named formats, so callers never pass a fresh function per render. */
export type NumberPreset = "compact" | "count" | "int" | "pct";
export type NumberFormat = NumberPreset | ((n: number) => string);

const intl = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/** 1,234 / 12.3K / 4.5M: the analytics short form (lib/utils compact gives 1.2K below ten thousand). */
const short1 = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const short0 = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 0 });
const short = (n: number) => (Math.abs(n) < 10_000 ? short1 : short0).format(n);

export function formatOf(f: NumberFormat): (n: number) => string {
  if (typeof f === "function") return f;
  if (f === "pct") return (n) => `${n.toFixed(1)}%`;
  if (f === "int") return (n) => intl.format(Math.round(n));
  if (f === "count") return (n) => (Math.abs(n) < 10_000 ? intl.format(Math.round(n)) : short(n));
  return short;
}

const UNIT: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

/**
 * The in-between frames for a count towards `final`. Compact numbers keep the final value's unit the whole way
 * (0.4M, 0.8M, 1.2M, never 400K then 1M), so the suffix never flickers; the last frame is always the exact
 * formatter output, which the component writes itself.
 */
export function stepperOf(f: NumberFormat, final: number): (n: number) => string {
  const exact = formatOf(f);
  if (typeof f === "function" || f === "pct") return exact;
  if (f === "int" || (f === "count" && Math.abs(final) < 10_000)) return (n) => intl.format(Math.round(n));
  const out = exact(final);
  const m = /^-?[\d,]+(?:\.(\d+))?([KMBT])$/i.exec(out);
  if (!m) return (n) => intl.format(Math.round(n));
  const div = UNIT[m[2].toLowerCase()];
  const dec = (m[1] ?? "").length;
  return (n) => {
    const x = Math.abs(n) / div;
    // Under one unit with no decimals, show one ("0.4M"), or the count would sit at "0M".
    const d = dec === 0 && x < 1 ? 1 : dec;
    const s = x.toFixed(d);
    // 1104: the first frames of a count from zero said "0.0K"; nothing yet is a plain "0", like the start.
    if (Number(s) === 0) return "0";
    return `${n < 0 ? "-" : ""}${s}${m[2]}`;
  };
}

/** Which timing a count uses: a refresh once it has played, else its tier (percentages default to pct). */
export function timingFor(f: NumberFormat, tier: NumberTier | undefined, refresh: boolean) {
  if (refresh) return NUMBER_TIMING.refresh;
  return NUMBER_TIMING[tier ?? (f === "pct" ? "pct" : "secondary")];
}

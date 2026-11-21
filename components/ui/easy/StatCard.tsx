"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */

import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type SpringOptions } from "framer-motion";
import { motionTransitions } from "@/components/ui/easy/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { EASE_OUT, clamp, defaultFormat, muted, useDismissOutside, useElementWidth } from "@/components/ui/easy/lib/chart-primitives";
import { monotonePath, pctText } from "@/components/ui/easy/lib/dashboard-chart-utils";

const SPARK_H = 52;
const PAD_T = 8;
const PAD_B = 6;

export interface StatCardProps {
  label: string;
  value: number;
  /** Oldest to newest. One point (or `sparkline={false}`) keeps the row's height but draws no line. */
  trend: number[];
  trendLabels?: string[];
  previous?: number;
  /** Percent change. `null` = no fair comparison: the pill shows `deltaNote` instead (or nothing). */
  delta?: number | null;
  deltaNote?: string;
  deltaFormat?: (abs: number) => string;
  goodWhen?: "up" | "down";
  period?: string;
  format?: (n: number) => string;
  /** Any CSS colour, including hsl(var(--token)): it is applied through style, not an SVG attribute. */
  color?: string;
  sparkline?: boolean;
  animated?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function StatCard({
  label,
  value,
  trend,
  trendLabels,
  previous,
  delta,
  deltaNote,
  deltaFormat = pctText,
  goodWhen = "up",
  period = "vs the period before",
  format = defaultFormat,
  color = "hsl(var(--primary))",
  sparkline = true,
  animated = true,
  className,
  style,
  children,
}: StatCardProps) {
  const reduce = useReducedMotion();
  const anim = animated && !reduce;
  const uid = useId().replace(/:/g, "");
  const [boxRef, width] = useElementWidth<HTMLDivElement>(160);
  const svgRef = useRef<SVGSVGElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  useDismissOutside(cardRef, active !== null, useCallback(() => setActive(null), []));

  const n = trend.length;
  const scrub = sparkline && n > 1;
  const min = n ? Math.min(...trend) : 0;
  const span = (n ? Math.max(...trend) : 1) - min || 1;
  const stepX = n > 1 ? width / (n - 1) : 0;
  const pts = trend.map((v, i) => [i * stepX, PAD_T + (1 - (v - min) / span) * (SPARK_H - PAD_T - PAD_B)] as [number, number]);
  const line = scrub ? monotonePath(pts) : "";
  const area = scrub ? `${line}L${pts[n - 1][0].toFixed(2)} ${SPARK_H}L${pts[0][0].toFixed(2)} ${SPARK_H}Z` : "";

  const pct =
    delta === null
      ? null
      : (delta ??
        (previous !== undefined && previous !== 0
          ? ((value - previous) / Math.abs(previous)) * 100
          : scrub && trend[0] !== 0
            ? ((trend[n - 1] - trend[0]) / Math.abs(trend[0])) * 100
            : null));
  const rounded = pct === null ? null : Math.round(pct * 10) / 10;
  const good = !rounded ? null : goodWhen === "up" ? rounded > 0 : rounded < 0;

  // Counts up on mount, then follows the scrubber.
  const fmt = useRef(format);
  fmt.current = format;
  const shown = useMotionValue(anim ? 0 : value);
  const text = useTransform(shown, (v) => fmt.current(v));
  const mounted = useRef(false);
  const target = active === null ? value : trend[active];
  useEffect(() => {
    const intro = !mounted.current;
    mounted.current = true;
    const c = animate(shown, target, { duration: reduce ? 0 : intro ? 1.1 : 0.22, ease: EASE_OUT });
    return () => c.stop();
  }, [target, shown, reduce]);

  const curX = useSpring(0, motionTransitions.springSnappy as SpringOptions);
  const curY = useSpring(0, motionTransitions.springSnappy as SpringOptions);
  const seen = useRef(false);
  const at = active === null ? null : pts[active];
  useEffect(() => {
    if (!at) {
      seen.current = false;
      return;
    }
    if (!seen.current) {
      curX.jump(at[0]);
      curY.jump(at[1]);
      seen.current = true;
    } else {
      curX.set(at[0]);
      curY.set(at[1]);
    }
  }, [at?.[0], at?.[1], curX, curY]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (e: PointerEvent) => {
    if (!scrub || !svgRef.current) return;
    const box = svgRef.current.getBoundingClientRect();
    setActive(clamp(Math.round((e.clientX - box.left) / stepX), 0, n - 1));
  };
  const onKey = (e: KeyboardEvent) => {
    if (!scrub) return;
    if (e.key === "ArrowRight") setActive((a) => clamp((a ?? n - 2) + 1, 0, n - 1));
    else if (e.key === "ArrowLeft") setActive((a) => clamp((a ?? n) - 1, 0, n - 1));
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  const pointName = (i: number) => trendLabels?.[i] ?? `Point ${i + 1}`;
  const sub = active === null ? period : pointName(active);
  const pill = rounded === null ? deltaNote : deltaFormat(Math.abs(rounded));
  const said = rounded === null ? (deltaNote ? `, ${deltaNote}` : "") : `, ${rounded > 0 ? "up" : rounded < 0 ? "down" : "unchanged"} ${deltaFormat(Math.abs(rounded))}`;

  return (
    <div
      ref={cardRef}
      tabIndex={scrub ? 0 : undefined}
      role="group"
      aria-label={`${label}: ${format(value)}${said}`}
      onPointerMove={scrub ? move : undefined}
      onPointerDown={scrub ? move : undefined}
      onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
      data-scrub={scrub ? "" : undefined}
      className={cn(
        "relative flex min-w-0 select-none flex-col overflow-hidden rounded-[24px] pt-4 text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      style={style}
    >
      <div className="flex items-start justify-between gap-2 px-4 sm:px-5">
        <p className={cn("truncate text-sm", muted)}>{label}</p>
        {pill && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums",
              good === null && "bg-foreground/[0.06] text-foreground/60",
              good === true && "bg-success/15 text-success-ink",
              good === false && "bg-warning/15 text-warning-ink",
            )}
          >
            {!!rounded && (
              <svg viewBox="0 0 10 10" className={cn("h-2 w-2", rounded < 0 && "rotate-180")} fill="currentColor" aria-hidden="true">
                <path d="M5 1.5 9 7.5H1Z" />
              </svg>
            )}
            {pill}
          </span>
        )}
      </div>

      <p className="mt-1.5 px-4 text-[clamp(1.75rem,2.4vw,2.25rem)] font-semibold leading-none tracking-tight tabular-nums sm:px-5">
        <motion.span>{text}</motion.span>
      </p>
      <p className={cn("mt-1.5 truncate px-4 text-xs sm:px-5", muted)}>{sub}</p>
      {children && <div className="px-4 sm:px-5">{children}</div>}

      <div ref={boxRef} className="mt-auto pt-3" style={{ height: SPARK_H + 12 }} aria-hidden={scrub ? undefined : true}>
        {scrub && (
          <svg ref={svgRef} width={width} height={SPARK_H} role="img" aria-label={`${label} trend from ${format(trend[0])} to ${format(trend[n - 1])}`} className="block overflow-visible">
            <defs>
              <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: color, stopOpacity: 0.28 }} />
                <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <motion.path d={area} fill={`url(#${uid}-g)`} initial={anim ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.5 }} />
            <motion.path
              d={line}
              fill="none"
              style={{ stroke: color }}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={anim ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.1, ease: EASE_OUT, delay: 0.15 }}
            />
            <g style={{ opacity: active === null ? 1 : 0, transition: "opacity .15s" }}>
              {anim && (
                <motion.circle
                  cx={pts[n - 1][0]}
                  cy={pts[n - 1][1]}
                  r={3.5}
                  style={{ fill: color, transformBox: "fill-box", transformOrigin: "center" }}
                  animate={{ scale: [1, 2.8], opacity: [0.4, 0] }}
                  transition={{ repeat: Infinity, duration: 1.8, ease: "easeOut" }}
                />
              )}
              <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r={3.5} style={{ fill: color }} />
            </g>
            <motion.g initial={false} animate={{ opacity: active === null ? 0 : 1 }} transition={{ duration: 0.12 }}>
              <motion.line y1={0} y2={SPARK_H} x1={curX} x2={curX} className="stroke-foreground/20" strokeDasharray="2 3" />
              <motion.circle cx={curX} cy={curY} r={4.5} style={{ fill: color }} className="stroke-background" strokeWidth={2} />
            </motion.g>
          </svg>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {active !== null ? `${pointName(active)}: ${format(trend[active])}` : ""}
      </p>
    </div>
  );
}

/** Auto-fit columns: as many `min`-wide tiles as fit, so the row never overflows a phone. */
export function StatGrid({ children, min = 210, className }: { children: ReactNode; min?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3 sm:gap-4", className)} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` }}>
      {children}
    </div>
  );
}

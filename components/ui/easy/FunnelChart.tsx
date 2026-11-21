"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */

import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { clamp, cx, defaultFormat, focus, muted, Tooltip, useDismissOutside, useElementWidth } from "@/components/ui/easy/lib/chart-primitives";
import { pctText } from "@/components/ui/easy/lib/dashboard-chart-utils";

export interface FunnelStage {
  label: string;
  value: number;
  color?: string;
}

export interface FunnelChartProps {
  stages: FunnelStage[];
  formatValue?: (n: number) => string;
  /** Overall conversion + biggest drop-off line above the chart (default true) */
  showSummary?: boolean;
  /** Word for the counted things in the tooltip (default "People") */
  unit?: string;
  animated?: boolean;
  ariaLabel?: string;
  className?: string;
}

const F = { text: 22, bar: 30, bridge: 30 };

/** Lime at full strength for the first stage, fading towards the last, so later stages read as "fewer". */
const stageColor = (i: number, n: number) => `hsl(var(--lime) / ${n > 1 ? (1 - (i / (n - 1)) * 0.5).toFixed(2) : 1})`;

/** Share of a stage lost before the next one, in percent. */
export function funnelDrop(stages: FunnelStage[], i: number) {
  return stages[i].value > 0 ? (1 - stages[i + 1].value / stages[i].value) * 100 : 0;
}

/** A loss reads "−12%"; a later step larger than the one before (possible with undercounted sources) reads "+12%". */
export const dropText = (d: number) => (d < 0 ? `+${pctText(-d)}` : `−${pctText(d)}`);

/** Overall conversion (last over first, percent) and the stage index with the biggest drop to the next one. */
export function funnelSummary(stages: FunnelStage[]) {
  const n = stages.length;
  if (n < 2) return null;
  const top = Math.max(1e-9, stages[0].value);
  let worst = 0;
  for (let i = 0; i < n - 1; i++) if (funnelDrop(stages, i) > funnelDrop(stages, worst)) worst = i;
  return { conv: (stages[n - 1].value / top) * 100, worst, dropPct: funnelDrop(stages, worst) };
}

export function FunnelChart({ stages, formatValue = defaultFormat, showSummary = true, unit = "People", animated = true, ariaLabel, className = "" }: FunnelChartProps) {
  const reduce = useReducedMotion();
  const anim = animated && !reduce;
  const [rootRef, width] = useElementWidth<HTMLDivElement>(480);
  const [active, setActive] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  useDismissOutside(wrapRef, active !== null, useCallback(() => setActive(null), []));

  const n = stages.length;
  const top = Math.max(1e-9, stages[0]?.value ?? 1);
  const maxV = Math.max(top, ...stages.map((s) => s.value));
  const block = F.text + F.bar + F.bridge;
  const H = n * (F.text + F.bar) + Math.max(0, n - 1) * F.bridge;
  const color = (i: number) => stages[i].color ?? stageColor(i, n);
  const w = (i: number) => clamp((width * Math.max(0, stages[i].value)) / maxV, 28, width);
  const bx = (i: number) => (width - w(i)) / 2;
  const pct = (i: number) => (stages[i].value / top) * 100;
  const drop = (i: number) => funnelDrop(stages, i);

  const bridge = (i: number) => {
    const yb = i * block + F.text + F.bar;
    const l1 = bx(i), r1 = l1 + w(i), l2 = bx(i + 1), r2 = l2 + w(i + 1);
    const m = F.bridge / 2;
    return `M${l1} ${yb}L${r1} ${yb}C${r1} ${yb + m} ${r2} ${yb + m} ${r2} ${yb + F.bridge}L${l2} ${yb + F.bridge}C${l2} ${yb + m} ${l1} ${yb + m} ${l1} ${yb}Z`;
  };

  const summary = useMemo(() => funnelSummary(stages), [stages]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((a) => clamp((a ?? -1) + 1, 0, n - 1));
    else if (e.key === "ArrowUp") setActive((a) => clamp((a ?? n) - 1, 0, n - 1));
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  if (!n) return <p className={`py-10 text-center text-[13px] ${muted}`}>No data</p>;
  const spring = reduce ? { duration: 0 } : ({ type: "spring", duration: 0.7, bounce: 0 } as const);
  const cur = active !== null ? stages[active] : null;
  const gid = (i: number) => `ol-funnel-${uid}-${i}`;

  return (
    <div ref={rootRef} className={cx("w-full min-w-0", className)}>
      {showSummary && summary && (
        <div className="mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <p className="text-[13px] text-foreground">
            <span className="text-[22px] font-semibold tracking-[-0.01em] tabular-nums">{pctText(summary.conv)}</span> <span className={muted}>overall conversion</span>
          </p>
          <p className={`text-[12.5px] ${muted}`}>
            Biggest drop: {stages[summary.worst].label} to {stages[summary.worst + 1].label} <span className="tabular-nums text-destructive">{dropText(summary.dropPct)}</span>
          </p>
        </div>
      )}

      <div ref={wrapRef} className="relative" style={{ height: H }}>
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={ariaLabel ?? `Funnel with ${n} stages from ${stages[0].label} to ${stages[n - 1].label}`}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className={cx("block touch-pan-y overflow-visible rounded-xl", focus)}
        >
          <defs>
            {stages.slice(0, -1).map((_, i) => (
              <linearGradient key={i} id={gid(i)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: color(i), stopOpacity: 0.3 }} />
                <stop offset="1" style={{ stopColor: color(i + 1), stopOpacity: 0.06 }} />
              </linearGradient>
            ))}
          </defs>

          {/* bridges: the people lost between two stages */}
          {stages.slice(0, -1).map((_, i) => (
            <motion.path
              key={i}
              fill={`url(#${gid(i)})`}
              initial={anim ? { opacity: 0, d: bridge(i) } : false}
              animate={{ opacity: active === null ? 1 : active === i ? 1 : 0.35, d: bridge(i) }}
              transition={anim ? { opacity: { duration: 0.4, delay: 0.3 + i * 0.1 }, d: spring } : { d: spring, opacity: { duration: 0.2 } }}
            />
          ))}

          {stages.map((s, i) => {
            const y = i * block;
            const dim = active !== null && active !== i;
            return (
              <g key={i} style={{ opacity: dim ? 0.5 : 1, transition: "opacity .2s" }}>
                <text x={0} y={y + 14} className={cx("text-[12.5px]", active === i ? "fill-foreground" : "fill-foreground/70")}>
                  {s.label}
                </text>
                <text x={width} y={y + 14} textAnchor="end" className="fill-foreground text-[12.5px] tabular-nums">
                  {formatValue(s.value)}
                  {width >= 300 && <tspan className="fill-foreground/60"> · {pctText(pct(i))}</tspan>}
                </text>
                <motion.rect
                  y={y + F.text}
                  height={F.bar}
                  rx={9}
                  fill={color(i)}
                  initial={anim ? { x: width / 2, width: 0 } : false}
                  animate={{ x: bx(i), width: w(i) }}
                  transition={anim ? { type: "spring", duration: 0.9, bounce: 0, delay: i * 0.09 } : spring}
                />
              </g>
            );
          })}

          {/* drop-off chips */}
          {stages.slice(0, -1).map((_, i) => {
            const yc = i * block + F.text + F.bar + F.bridge / 2;
            const hot = active === i;
            return (
              <motion.g
                key={i}
                initial={anim ? { opacity: 0 } : false}
                animate={{ opacity: active === null || hot ? 1 : 0.4 }}
                transition={{ duration: 0.3, delay: anim && active === null ? 0.6 + i * 0.1 : 0 }}
              >
                <rect x={width / 2 - 28} y={yc - 10} width={56} height={20} rx={10} className={cx("fill-card", hot ? "stroke-destructive/60" : "stroke-foreground/10")} />
                <text x={width / 2} y={yc} textAnchor="middle" dominantBaseline="central" className={cx("text-[11px] tabular-nums", hot ? "fill-destructive" : "fill-foreground/60")}>
                  {dropText(drop(i))}
                </text>
              </motion.g>
            );
          })}

          {/* hit areas */}
          {stages.map((_, i) => (
            <rect
              key={i}
              x={0}
              y={i * block}
              width={width}
              height={i === n - 1 ? F.text + F.bar : block}
              fill="transparent"
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
              onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
            />
          ))}
        </svg>

        <Tooltip pos={active === null ? null : { x: width / 2, y: active * block + F.text }} boundsWidth={width}>
          {cur && active !== null && (
            <>
              <p className="mb-1 font-medium text-foreground">{cur.label}</p>
              <p className="flex justify-between gap-4">
                <span className={muted}>{unit}</span>
                <span className="tabular-nums text-foreground">{formatValue(cur.value)}</span>
              </p>
              <p className="flex justify-between gap-4">
                <span className={muted}>Of first step</span>
                <span className="tabular-nums text-foreground">{pctText(pct(active))}</span>
              </p>
              {active < n - 1 && (
                <p className="mt-1.5 flex justify-between gap-4 border-t border-foreground/[0.08] pt-1.5">
                  <span className={muted}>Lost next</span>
                  <span className="tabular-nums text-destructive">
                    {formatValue(Math.max(0, cur.value - stages[active + 1].value))} ({dropText(drop(active))})
                  </span>
                </p>
              )}
            </>
          )}
        </Tooltip>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {cur && active !== null ? `${cur.label}: ${formatValue(cur.value)}, ${pctText(pct(active))} of the first step` : ""}
      </p>

      <table className="sr-only">
        <caption>{ariaLabel ?? "Funnel data"}</caption>
        <thead>
          <tr>
            <th scope="col">Stage</th>
            <th scope="col">{unit}</th>
            <th scope="col">% of first stage</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s, i) => (
            <tr key={i}>
              <th scope="row">{s.label}</th>
              <td>{formatValue(s.value)}</td>
              <td>{pctText(pct(i))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";
import { useEffect, useId, useRef } from "react";
import { drawIn } from "./motion";

/**
 * KPI trend line (1080). Drawn left to right by widening a clip rectangle (a dash trick would break with
 * the non-scaling stroke). Decorative: the card's number and change carry the meaning.
 */
export function Sparkline({ data, tone = "up", delay = 0 }: { data: number[]; tone?: "up" | "down" | "flat"; delay?: number }) {
  const clip = useRef<SVGRectElement>(null);
  const id = useId().replace(/:/g, "");
  const max = Math.max(1, ...data);
  const n = Math.max(2, data.length);
  const pts = (data.length ? data : [0, 0]).map((v, i) => [(i / (n - 1)) * 100, 30 - (v / max) * 26] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L100 32 L0 32 Z`;
  const key = data.join(",");

  useEffect(() => drawIn((p) => clip.current?.setAttribute("width", String(p * 100)), { duration: 1, delay: delay + 0.35 }), [key, delay]);

  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true" className={`pulse-spark pulse-${tone} h-10 w-full`}>
      <defs>
        <clipPath id={`c${id}`}><rect ref={clip} x="0" y="0" width="100" height="32" /></clipPath>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#c${id})`}>
        <path d={area} fill={`url(#g${id})`} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

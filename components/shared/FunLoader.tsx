"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const CHEERS = [
  "We're doing great!",
  "Licking the stamp…",
  "Sorting the mail bag…",
  "Polishing your posts…",
  "Almost there, keep going!",
];

/**
 * Route loader with a mascot: a lime postage stamp that hops, squashes on landing, blinks,
 * and cheers you on. Only transform and opacity animate. Under reduced motion it sits still
 * and the lines still change, so the screen never looks frozen.
 */
export function FunLoader({ label = "Opening Outly", lines = CHEERS, className }: { label?: string; lines?: string[]; className?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((v) => v + 1), 1600);
    return () => clearInterval(t);
  }, []);
  const line = lines[n % lines.length];

  return (
    <div className={cn("grid min-h-[62dvh] place-items-center px-6 py-16", className)} role="status" aria-busy="true">
      <div className="flex flex-col items-center text-center">
        <div className="fl-stage" aria-hidden="true">
          <span className="fl-spark fl-spark-1" />
          <span className="fl-spark fl-spark-2" />
          <span className="fl-spark fl-spark-3" />
          <div className="fl-hop">
            <div className="fl-squash">
              <Stampy />
            </div>
          </div>
          <span className="fl-shadow" />
        </div>

        <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <p className="mt-2 h-8 overflow-hidden font-display text-[1.45rem] font-semibold tracking-tight" aria-live="polite">
          <span key={line} className="fl-line inline-block">{line}</span>
        </p>

        <div className="mt-5 flex gap-1.5" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={cn("fl-dot", i === n % 5 && "is-on", i < n % 5 && "is-past")} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The mascot. Perforated edge is a mask of circles punched out of the paper. */
function Stampy() {
  const holes: [number, number][] = [];
  for (let x = 8; x <= 92; x += 12) holes.push([x, 2], [x, 118]);
  for (let y = 14; y <= 106; y += 12) holes.push([2, y], [98, y]);
  return (
    <svg viewBox="0 0 100 120" width="104" height="125" className="block overflow-visible">
      <defs>
        <mask id="fl-perf">
          <rect width="100" height="120" fill="#fff" />
          {holes.map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="4.2" fill="#000" />
          ))}
        </mask>
      </defs>
      <g mask="url(#fl-perf)">
        <rect width="100" height="120" rx="3" fill="hsl(var(--lime))" />
        <rect x="9" y="11" width="82" height="98" rx="5" fill="none" stroke="#14140f" strokeOpacity=".9" strokeWidth="2.4" strokeDasharray="1 4.5" strokeLinecap="round" />
        <text x="16" y="29" fontSize="10" fontWeight="900" letterSpacing="1.6" fill="#14140f">OUTLY</text>
        <text x="84" y="29" fontSize="10" fontWeight="900" textAnchor="end" fill="#14140f">1¢</text>
      </g>
      {/* face */}
      <g className="fl-eyes" fill="#14140f">
        <ellipse cx="37" cy="62" rx="5.2" ry="7" />
        <ellipse cx="63" cy="62" rx="5.2" ry="7" />
        <circle cx="38.8" cy="59.4" r="1.9" fill="#fff" />
        <circle cx="64.8" cy="59.4" r="1.9" fill="#fff" />
      </g>
      <ellipse cx="27" cy="76" rx="6" ry="3.6" fill="#ff7aa8" opacity=".75" />
      <ellipse cx="73" cy="76" rx="6" ry="3.6" fill="#ff7aa8" opacity=".75" />
      <path d="M41 78q9 10 18 0" fill="#14140f" />
      <path d="M45.5 81.6q4.5 3.2 9 0" fill="#ff7aa8" />
      {/* waving arm */}
      <g className="fl-arm">
        <path d="M98 70q12 -4 14 -18" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" />
        <circle cx="112" cy="50" r="5.4" fill="hsl(var(--lime))" stroke="currentColor" strokeWidth="3" />
      </g>
      <path d="M2 74q-11 5 -12 16" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" />
      <circle cx="-10" cy="92" r="5.4" fill="hsl(var(--lime))" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Pip } from "@/components/brand/Pip";

const CHEERS = [
  "We're doing great!",
  "Fuelling the rocket…",
  "Plotting the route…",
  "Polishing your posts…",
  "Almost there, keep going!",
];

/**
 * Route loader with Pip, the Outlly rocket mascot: hops, squashes on landing, blinks,
 * and cheers you on. Only transform and opacity animate. Under reduced motion it sits still
 * and the lines still change, so the screen never looks frozen.
 */
export function FunLoader({ label = "Opening Outlly", lines = CHEERS, className }: { label?: string; lines?: string[]; className?: string }) {
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
              <Pip size={104} mood="fly" />
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

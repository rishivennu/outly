"use client";
import { useId } from "react";
import { cn } from "@/lib/utils";

export type PipMood = "idle" | "wave" | "think" | "happy" | "sad" | "fly";

/**
 * Pip, Outlly's mascot: a small, round lime rocket with a porthole face, fin "arms" and a
 * flickering flame. Built from the brand gradient (#22f04a -> #dcfa18) so it belongs next to
 * the logo. Pure SVG + CSS (transform/opacity only); every loop stops under reduced motion.
 */
export function Pip({ size = 96, mood = "idle", className, title }: { size?: number; mood?: PipMood; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const g = `pip-g-${id}`;
  const f = `pip-f-${id}`;
  return (
    <svg
      viewBox="0 0 120 140"
      width={size}
      height={(size * 140) / 120}
      className={cn("pip", `pip-${mood}`, className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={g} x1="0.1" y1="1" x2="0.9" y2="0">
          <stop offset="0" stopColor="#22f04a" />
          <stop offset="0.55" stopColor="#7cf52a" />
          <stop offset="1" stopColor="#dcfa18" />
        </linearGradient>
        <linearGradient id={f} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff7c2" />
          <stop offset="0.45" stopColor="#ffd23d" />
          <stop offset="1" stopColor="#ff7a1a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="pip-body">
        {/* flame */}
        <g className="pip-flame">
          <path d="M60 104c-9 0-14 9-12 18 2 7 7 12 12 16 5-4 10-9 12-16 2-9-3-18-12-18z" fill={`url(#${f})`} />
          <path d="M60 108c-4 0-7 5-6 10 1 4 3 6 6 8 3-2 5-4 6-8 1-5-2-10-6-10z" fill="#fffbe0" />
        </g>
        {/* left fin = arm (waves) */}
        <g className="pip-arm-l">
          <path d="M31 70c-9 4-16 13-17 24-.3 3 2.6 5 5 3.4L34 88z" fill={`url(#${g})`} stroke="#0d0f0a" strokeWidth="3" strokeLinejoin="round" />
        </g>
        <g className="pip-arm-r">
          <path d="M89 70c9 4 16 13 17 24 .3 3-2.6 5-5 3.4L86 88z" fill={`url(#${g})`} stroke="#0d0f0a" strokeWidth="3" strokeLinejoin="round" />
        </g>
        {/* hull */}
        <path d="M60 6C40 20 28 44 28 70c0 14 4 26 10 34h44c6-8 10-20 10-34C92 44 80 20 60 6z" fill={`url(#${g})`} stroke="#0d0f0a" strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M45 26c-6 9-9 20-9 31" stroke="#ffffff" strokeOpacity=".75" strokeWidth="4" strokeLinecap="round" fill="none" />
        <rect x="40" y="100" width="40" height="9" rx="4.5" fill="#0d0f0a" />
        {/* porthole face */}
        <circle cx="60" cy="62" r="21" fill="#0d0f0a" />
        <circle cx="60" cy="62" r="21" fill="none" stroke="#ffffff" strokeOpacity=".9" strokeWidth="3" />
        <g className="pip-eyes">
          <ellipse className="pip-eye" cx="52.5" cy="60" rx="3.6" ry="5" fill="#ffffff" />
          <ellipse className="pip-eye" cx="67.5" cy="60" rx="3.6" ry="5" fill="#ffffff" />
          <circle cx="53.6" cy="58.4" r="1.2" fill="#0d0f0a" />
          <circle cx="68.6" cy="58.4" r="1.2" fill="#0d0f0a" />
        </g>
        <path className="pip-mouth" d={mood === "sad" ? "M54 73c3-3 9-3 12 0" : "M53.5 70c3.5 4 9.5 4 13 0"} stroke="#9ff218" strokeWidth="2.8" strokeLinecap="round" fill="none" />
        <circle cx="46" cy="69" r="2.6" fill="#ff7aa8" opacity=".55" />
        <circle cx="74" cy="69" r="2.6" fill="#ff7aa8" opacity=".55" />
      </g>
      {mood === "think" && (
        <g className="pip-dots" fill="#9ff218">
          <circle cx="96" cy="22" r="3.5" />
          <circle cx="106" cy="14" r="3.5" />
          <circle cx="115" cy="6" r="3.5" />
        </g>
      )}
    </svg>
  );
}

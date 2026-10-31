"use client";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { moodSituation, paletteById, paletteVars, type PipSituation } from "@/lib/mascot/palettes";

export type PipMood = "idle" | "wave" | "think" | "happy" | "sad" | "fly" | "sleepy" | "dizzy" | "wait";

/**
 * Pip, Outlly's mascot (2026-10-15 glow redesign): a soft indigo cloud with a blurred, colourful
 * "heart light" inside that changes shape with the mood, and simple white line eyes.
 * Pure SVG + CSS (transform/opacity only); every loop stops under reduced motion.
 *
 * Colours are CSS variables (Indigo is the fallback). The admin picks a colourway per situation and
 * /api/pip-theme sets them on `.pip-sit-<situation>`; `palette` forces one (admin previews).
 */
const v = (name: string, fallback: string) => ({ stopColor: `var(${name}, ${fallback})` });
const CLOUD =
  "M30 94C15 94 7 82 11 70C4 60 10 45 25 45C25 29 41 19 56 25C64 13 87 15 91 31C105 31 115 44 109 58C117 69 112 87 97 90C90 101 72 101 66 95C58 101 40 101 34 95C32.6 94.4 31.3 94 30 94Z";

/** The blurred shape inside the cloud: its silhouette carries the mood. */
const CORE: Record<PipMood, string> = {
  idle: "M60 44c13 0 22 8 22 19s-10 19-23 19-22-8-22-19 10-19 23-19z",
  wait: "M60 44c13 0 22 8 22 19s-10 19-23 19-22-8-22-19 10-19 23-19z",
  wave: "M58 42c14-2 25 8 24 20-1 13-13 20-25 19-12-1-20-10-19-21 1-9 8-17 20-18z",
  think: "M60 36l6 16 17 2-13 10 4 17-14-9-14 9 4-17-13-10 17-2z",
  happy: "M60 82C46 72 37 64 37 54c0-7 5-12 11-12 5 0 9 3 12 7 3-4 7-7 12-7 6 0 11 5 11 12 0 10-9 18-23 28z",
  sad: "M60 46c8 9 14 17 14 24 0 8-6 13-14 13s-14-5-14-13c0-7 6-15 14-24z",
  fly: "M60 32l5 19 14-12-6 17 19 1-17 8 13 13-18-5 1 19-11-15-11 15 1-19-18 5 13-13-17-8 19-1-6-17 14 12z",
  sleepy: "M70 40c-14 0-24 10-24 23s10 22 23 22c6 0 11-2 15-5-12 0-21-9-21-20 0-9 4-16 7-20z",
  dizzy: "M44 50c6-10 26-12 32 0 5 10-4 22-16 22-9 0-14-6-12-12 2-5 9-6 12-2",
};

const EYES: Record<PipMood, React.ReactNode> = {
  idle: (<><path d="M50 49l-1.6 10" /><path d="M66 49l-1.6 10" /></>),
  wait: (<><path d="M50 49l-1.6 10" /><path d="M66 49l-1.6 10" /></>),
  wave: (<><path d="M50 49l-1.6 10" /><path d="M62 56l4.5-5 4.5 5" /></>),
  think: (<><circle cx="55" cy="51" r="2.6" className="pip-dot-eye" /><circle cx="70" cy="51" r="2.6" className="pip-dot-eye" /></>),
  happy: (<><path d="M44 57l5-5.5 5 5.5" /><path d="M64 57l5-5.5 5 5.5" /></>),
  sad: (<><path d="M44 52c3 3.5 7 3.5 10 0" /><path d="M64 52c3 3.5 7 3.5 10 0" /><path d="M47 60c0 2.5-1 4-2 4s-2-1.5-2-4c0-1.6 2-4 2-4s2 2.4 2 4z" className="pip-tear" /></>),
  fly: (<><path d="M45 49l7 5-7 5" /><path d="M73 49l-7 5 7 5" /></>),
  sleepy: (<><path d="M44 56h9" /><path d="M65 56h9" /></>),
  dizzy: (<><path className="pip-swirl" d="M49 54a3 3 0 1 1 3 3 5.5 5.5 0 1 1 5.5-5.5" /><path className="pip-swirl pip-swirl-r" d="M69 54a3 3 0 1 1 3 3 5.5 5.5 0 1 1 5.5-5.5" /></>),
};

/** Closed eyes (1075): two flat lines, for "I'm not looking." while a password is typed. */
const SHUT = (<><path d="M43 55h11" /><path d="M64 55h11" /></>);
/** Big round "watching" eyes (1075b), like the reel's mascot: two white pills that read at small sizes. */
const PILL = (<><rect x="44" y="45" width="10" height="18" rx="5" fill="#ffffff" stroke="none" /><rect x="64" y="45" width="10" height="18" rx="5" fill="#ffffff" stroke="none" /></>);
const PILL_MOODS: ReadonlySet<PipMood> = new Set(["idle", "think", "wait", "fly"]);

/**
 * `gaze` moves the eyes by [x, y] in the 120-unit box (about +-8 x, +-5 y stays inside the cloud), so Pip can
 * look at a caret or the pointer. `shut` closes them. `eyes="pill"` swaps the line eyes for big round ones.
 */
export function Pip({ size = 96, mood = "idle", className, title, situation, palette, style, gaze, shut = false, eyes = "line" }: { size?: number; mood?: PipMood; className?: string; title?: string; situation?: PipSituation; palette?: string; style?: React.CSSProperties; gaze?: readonly [number, number]; shut?: boolean; eyes?: "line" | "pill" }) {
  const id = useId().replace(/:/g, "");
  const body = `pip-b-${id}`;
  const rim = `pip-r-${id}`;
  const core = `pip-c-${id}`;
  const soft = `pip-s-${id}`;
  const glow = `pip-g-${id}`;
  const clip = `pip-k-${id}`;
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={cn("pip", `pip-${mood}`, `pip-sit-${situation ?? moodSituation(mood)}`, shut && "pip-shut", className)}
      style={palette ? { ...(paletteVars(paletteById(palette)) as React.CSSProperties), ...style } : style}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <radialGradient id={body} cx="0.42" cy="0.38" r="0.7">
          <stop offset="0" style={v("--pip-b0", "#5b4cf5")} />
          <stop offset="0.6" style={v("--pip-b1", "#3a2bd6")} />
          <stop offset="1" style={v("--pip-b2", "#2a1c9e")} />
        </radialGradient>
        <radialGradient id={rim} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.72" stopOpacity="0" style={v("--pip-r0", "#8d80ff")} />
          <stop offset="1" stopOpacity="0.85" style={v("--pip-r1", "#b4abff")} />
        </radialGradient>
        <linearGradient id={core} x1="0.1" y1="0.1" x2="0.9" y2="0.95">
          <stop offset="0" style={v("--pip-c0", "#ff5fb8")} />
          <stop offset="0.38" style={v("--pip-c1", "#ffb13d")} />
          <stop offset="0.68" style={v("--pip-c2", "#9ff218")} />
          <stop offset="1" style={v("--pip-c3", "#3ee0ff")} />
        </linearGradient>
        <filter id={soft} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4.2" /></filter>
        <filter id={glow} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6" /></filter>
        <clipPath id={clip}><path d={CLOUD} /></clipPath>
      </defs>
      <g className="pip-body">
        {/* outer glow */}
        <path d={CLOUD} style={{ fill: "var(--pip-halo, #6c5cff)" }} opacity="0.55" filter={`url(#${glow})`} className="pip-halo" />
        <path d={CLOUD} fill={`url(#${body})`} />
        <g clipPath={`url(#${clip})`}>
          <g className="pip-core">
            <path d={CORE[mood]} fill={mood === "dizzy" ? "none" : `url(#${core})`} stroke={mood === "dizzy" ? `url(#${core})` : "none"} strokeWidth="9" strokeLinecap="round" filter={`url(#${soft})`} opacity={mood === "sad" || mood === "sleepy" ? 0.7 : 0.95} />
          </g>
          {/* glassy rim and top highlight */}
          <path d={CLOUD} fill={`url(#${rim})`} />
          <ellipse cx="42" cy="38" rx="16" ry="7" fill="#ffffff" opacity="0.22" filter={`url(#${soft})`} transform="rotate(-18 42 38)" />
        </g>
        <path d={CLOUD} fill="none" style={{ stroke: "var(--pip-edge, #c9c2ff)" }} strokeOpacity="0.35" strokeWidth="1.2" />
        <g className="pip-gaze" style={gaze ? { transform: `translate(${gaze[0].toFixed(2)}px, ${gaze[1].toFixed(2)}px)` } : undefined}>
          <g className="pip-eyes" fill="none" stroke="#ffffff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
            {shut ? SHUT : eyes === "pill" && PILL_MOODS.has(mood) ? PILL : EYES[mood]}
          </g>
        </g>
      </g>
      {mood === "think" && (
        <g className="pip-dots" style={{ fill: "var(--pip-accent, #b4abff)" }}>
          <circle cx="98" cy="22" r="3" />
          <circle cx="107" cy="14" r="3" />
          <circle cx="115" cy="6" r="3" />
        </g>
      )}
      {mood === "sleepy" && (
        <g className="pip-zz" fill="none" style={{ stroke: "var(--pip-accent, #b4abff)" }} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M92 22h8l-8 9h8" />
          <path d="M104 8h6l-6 7h6" />
        </g>
      )}
    </svg>
  );
}

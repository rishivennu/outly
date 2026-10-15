import type { CSSProperties } from "react";

/*
 * Shared bento pictures (10-15e). Every tile in Platforms and the Demo uses one of these, so both
 * sections read as one system: a glowing lime picture, then a title and one grey line.
 * All decorative: callers put the real content in text or an sr-only list.
 */

const css = (v: Record<string, string | number>) => v as CSSProperties;

/** The waveform: lime bars that breathe when an ancestor has .bx-live. */
export function Bars({ n = 17 }: { n?: number }) {
  const mid = (n - 1) / 2;
  return (
    <span className="bx-bars" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const d = Math.abs(i - mid) / mid;
        const h = Math.round(22 + 74 * Math.abs(Math.sin(i * 0.9 + 0.4) * Math.cos(i * 0.27)) * (1 - d * 0.55));
        return <span key={i} style={css({ "--h": `${h}%`, "--i": i, "--o": (1 - d * 0.7).toFixed(2) })} />;
      })}
    </span>
  );
}

/** Ring avatars with a curved arrow either side. */
export function Rings({ children }: { children: React.ReactNode }) {
  return (
    <span className="bx-rings" aria-hidden="true">
      <svg className="bx-arc bx-arc-l" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M26 24C14 24 6 17 6 6" />
        <path d="M2 10l4-4 4 4" />
      </svg>
      {children}
      <svg className="bx-arc bx-arc-r" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6c12 0 20 7 20 18" />
        <path d="M20 20l4 4 4-4" />
      </svg>
    </span>
  );
}

export function Av({ children }: { children: React.ReactNode }) {
  return (
    <span className="bx-av">
      <span>{children}</span>
    </span>
  );
}

/** A glowing bolt inside concentric rounded frames. */
export function Bolt({ id }: { id: string }) {
  return (
    <svg className="bx-svg bx-bolt" viewBox="0 0 220 150" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "hsl(var(--lime))" }} />
          <stop offset="1" style={{ stopColor: "hsl(var(--energy-a))" }} />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3].map((k) => {
        const w = 70 + k * 44;
        const h = 62 + k * 26;
        return <rect key={k} className="ln" x={110 - w / 2} y={75 - h / 2} width={w} height={h} rx={20 + k * 8} />;
      })}
      <g className="bx-glowf">
        <path d="M118 38 86 82h22l-8 32 34-48h-22z" fill={`url(#${id}-g)`} stroke="hsl(var(--lime))" strokeWidth="1" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

const PTS: [number, number][] = [
  [8, 112],
  [56, 96],
  [96, 102],
  [138, 72],
  [178, 64],
  [226, 28],
];

/** Line graph over diagonal hatching; the glowing dot sits on point `at` (0 to 5). */
export function Graph({ id, at = 5, lit = 1 }: { id: string; at?: number; lit?: number }) {
  const [x, y] = PTS[Math.max(0, Math.min(PTS.length - 1, at))];
  const d = PTS.map(([px, py], i) => `${i ? "L" : "M"}${px} ${py}`).join(" ");
  return (
    <svg className="bx-svg bx-graph" viewBox="0 0 234 130" aria-hidden="true">
      <defs>
        <pattern id={`${id}-h`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line className="ln" x1="0" y1="0" x2="0" y2="9" />
        </pattern>
        <clipPath id={`${id}-c`}>
          <path d={`${d} L226 130 L8 130 Z`} />
        </clipPath>
      </defs>
      <rect x="0" y="0" width="234" height="130" fill={`url(#${id}-h)`} clipPath={`url(#${id}-c)`} />
      <path className="ln" d={d} />
      <path className="hotln hot bx-glowf" d={d} pathLength={1} style={{ strokeDasharray: `${lit} 1` }} />
      <g className="dot" style={{ transform: `translate(${x}px, ${y}px)` }}>
        <circle r="11" fill="hsl(var(--lime) / .22)" className="halo" />
        <circle r="5" fill="hsl(var(--lime))" className="bx-glowf" />
      </g>
    </svg>
  );
}

/** The arrow circle for the lime tile. */
export function Arrow() {
  return (
    <span className="bx-arrow" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 17 17 7M8 7h9v9" />
      </svg>
    </span>
  );
}

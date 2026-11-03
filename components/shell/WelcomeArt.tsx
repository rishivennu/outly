/**
 * The welcome screen's hero (1101): a rocket launching out of a phone, Outlly's "post it everywhere" in one
 * picture. Hand-drawn editorial style after the reference: clean ink outlines, grainy gradient fills (an SVG
 * noise filter, so no image download), two clouds and one like bubble, nothing else floating.
 * Fills are fixed brand colours that read on cream and on ink; the free-standing lines use currentColor, so
 * they follow the theme. Decorative: the screen's headline says what it means (aria-hidden).
 * Motion lives in globals.css (.wa-*): a one-time entrance from the parent, then a slow float on the rocket.
 */
import { useId } from "react";

const INK = "#14161f";

export function WelcomeArt({ className }: { className?: string }) {
  // Ids are per instance (an admin preview may render a second copy next to the live one).
  const u = useId().replace(/:/g, "");
  const id = (n: string) => `pwa-${n}-${u}`;
  const ref = (n: string) => `url(#${id(n)})`;
  return (
    <svg viewBox="0 0 360 320" fill="none" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      <defs>
        <filter id={id("grain")} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves={1} seed={4} stitchTiles="stitch" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 .08  0 0 0 0 .09  0 0 0 0 .16  0 0 0 1.5 -.62" result="m" />
          <feComposite in="m" in2="SourceGraphic" operator="in" result="d" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="d" />
          </feMerge>
        </filter>
        <linearGradient id={id("body")} x1="0" y1="-92" x2="0" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d4f75a" />
          <stop offset=".42" stopColor="#8ec0ff" />
          <stop offset=".78" stopColor="#b59cff" />
          <stop offset="1" stopColor="#ff9cc9" />
        </linearGradient>
        <linearGradient id={id("flame")} x1="0" y1="60" x2="0" y2="156" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffe066" />
          <stop offset=".45" stopColor="#ff8a3d" />
          <stop offset=".8" stopColor="#ff5c8a" />
          <stop offset="1" stopColor="#ff5c8a" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("glass")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef4ff" />
          <stop offset="1" stopColor="#3d7cf0" />
        </linearGradient>
        <linearGradient id={id("screen")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#151722" />
          <stop offset="1" stopColor="#2a2f44" />
        </linearGradient>
      </defs>
      <g className="wa-cloud">
        <path d="M38 128c-12 0-16-15-4-19 1-12 18-14 23-5 8-6 20 0 18 9 10 2 9 15-1 15z" fill="#c8d7ff" stroke={INK} strokeWidth="2.4" />
      </g>
      <g className="wa-cloud wa-cloud-2">
        <path d="M292 46c-12 0-15-14-4-18 2-12 19-13 24-4 9-5 21 1 18 10 10 3 8 15-2 15z" fill="#c8d7ff" stroke={INK} strokeWidth="2.4" />
      </g>
      <g transform="translate(176 240) rotate(-9) skewX(-22)">
        <rect x="-118" y="-44" width="236" height="96" rx="26" fill={INK} className="wa-shadow" />
        <rect x="-122" y="-52" width="236" height="96" rx="26" fill="#f6f3ea" stroke={INK} strokeWidth="3" />
        <rect x="-108" y="-40" width="208" height="72" rx="16" fill={ref("screen")} />
        <rect x="98" y="-14" width="6" height="20" rx="3" fill={INK} />
      </g>
      <g className="wa-float">
        <g transform="translate(206 132) rotate(38)">
          <g className="wa-flame">
            <path d="M-15 60c-9 34 4 66 15 96 11-30 24-62 15-96z" fill={ref("flame")} filter={ref("grain")} />
            <path d="M-7 60c-4 20 2 38 7 54 5-16 11-34 7-54z" fill="#fff6c2" />
          </g>
          <path d="M-29 26c-15 6-23 24-21 44l27-14z" fill="#b8ef2a" stroke={INK} strokeWidth="3" />
          <path d="M29 26c15 6 23 24 21 44l-27-14z" fill="#b8ef2a" stroke={INK} strokeWidth="3" />
          <path d="M-16 50h32v6a6 6 0 0 1-6 6h-20a6 6 0 0 1-6-6z" fill={INK} />
          <path d="M0-92c30 22 40 62 32 120-2 14-10 22-32 22s-30-8-32-22c-8-58 2-98 32-120z" fill={ref("body")} filter={ref("grain")} />
          <path d="M-20 18c-4-36 0-62 12-80" stroke="#fff" strokeOpacity=".7" strokeWidth="4" />
          <path d="M0-92c30 22 40 62 32 120-2 14-10 22-32 22s-30-8-32-22c-8-58 2-98 32-120z" stroke={INK} strokeWidth="3" />
          <path d="M-21-56c12-7 30-7 42 0" stroke={INK} strokeWidth="2.6" />
          <circle cx="0" cy="-20" r="15" fill={ref("glass")} stroke={INK} strokeWidth="3" />
          <path d="M-6-26a8 8 0 0 1 9-3" stroke="#fff" strokeWidth="3" />
          <path d="M0 8v30" stroke={INK} strokeWidth="2.6" />
        </g>
      </g>
      <g stroke="currentColor" strokeWidth="2.6" className="wa-lines">
        <path d="M150 110l-13-17" />
        <path d="M132 136l-10-13" />
      </g>
      <g transform="translate(300 150) rotate(7)">
        <path d="M-26-20h52a12 12 0 0 1 12 12v16a12 12 0 0 1-12 12H2l-12 12v-12h-16a12 12 0 0 1-12-12v-16a12 12 0 0 1 12-12z" fill="#fff" stroke={INK} strokeWidth="2.6" />
        <path d="M-12-6c-3-4-10-2-9 3 1 4 9 9 9 9s8-5 9-9c1-5-6-7-9-3z" fill="#ff4f8b" stroke={INK} strokeWidth="2" />
        <path d="M6-4h16M6 4h10" stroke={INK} strokeWidth="3" />
      </g>
      <path d="M64 196l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#b8ef2a" stroke={INK} strokeWidth="2.2" />
    </svg>
  );
}

import { cn } from "@/lib/utils";
import s from "./workshops.module.css";

/* Decorative stickers scattered around the headline. All aria-hidden; the headline carries the meaning. */

type P = { className?: string; style?: React.CSSProperties };

export function Star({ className, style }: P) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn(s.doodle, className)} style={style}>
      <path d="M32 3l7.6 19.9L61 25.4 44.3 39.2 49.6 61 32 49.6 14.4 61l5.3-21.8L3 25.4l21.4-2.5z" fill="hsl(44 96% 56%)" stroke="hsl(222 24% 10%)" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M22 26l6-2 4-9" fill="none" stroke="hsl(0 0% 100% / .8)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Sparkle({ className, style, color = "hsl(338 88% 72%)" }: P & { color?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={cn(s.doodle, className)} style={style}>
      <path d="M24 2c1.5 12.5 9.5 20.5 22 22-12.5 1.5-20.5 9.5-22 22-1.5-12.5-9.5-20.5-22-22C14.5 22.5 22.5 14.5 24 2z" fill={color} stroke="hsl(222 24% 10%)" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

export function Bubble({ className, style, text = "Q&A" }: P & { text?: string }) {
  return (
    <svg viewBox="0 0 120 90" aria-hidden="true" className={cn(s.doodle, className)} style={style}>
      <path d="M14 8h92a10 10 0 0 1 10 10v40a10 10 0 0 1-10 10H48L26 84l3-16H14A10 10 0 0 1 4 58V18A10 10 0 0 1 14 8z" fill="hsl(204 92% 84%)" stroke="hsl(222 24% 10%)" strokeWidth="3" strokeLinejoin="round" />
      <text x="60" y="46" textAnchor="middle" fontFamily="var(--font-spacemono), monospace" fontWeight="700" fontSize="22" fill="hsl(222 24% 10%)">
        {text}
      </text>
    </svg>
  );
}

export function Envelope({ className, style }: P) {
  return (
    <svg viewBox="0 0 120 84" aria-hidden="true" className={cn(s.doodle, className)} style={style}>
      <rect x="4" y="6" width="112" height="72" rx="10" fill="hsl(0 0% 100%)" stroke="hsl(222 24% 10%)" strokeWidth="3" />
      <path d="M8 14l52 36 52-36" fill="none" stroke="hsl(222 24% 10%)" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="98" cy="18" r="12" fill="hsl(338 88% 72%)" stroke="hsl(222 24% 10%)" strokeWidth="3" />
    </svg>
  );
}

export function Heart({ className, style }: P) {
  return (
    <svg viewBox="0 0 64 60" aria-hidden="true" className={cn(s.doodle, className)} style={style}>
      <path d="M32 56S4 38 4 19C4 9 11 3 19 3c6 0 10 3 13 8 3-5 7-8 13-8 8 0 15 6 15 16 0 19-28 37-28 37z" fill="hsl(338 88% 72%)" stroke="hsl(222 24% 10%)" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The welcome screen's hero (R1180, from the supplied art): Kiki, the glossy green tile giving a thumbs-up, stands
 * behind on the left and Koko, the blue triangle holding a pixel heart, leans in front on the right, with a small
 * globe and orbit arrow above them for "post everywhere".
 * The characters are local WebP renders (public/brand/welcome, trimmed, 480 and 960 wide, transparent), so they sit
 * on the white page and on ink alike. The globe stays vector; its orbit uses currentColor, so it follows the theme.
 * Decorative: the screen's headline says what it means (aria-hidden, empty alt).
 * Motion lives in globals.css (.wa-*): a one-time entrance from the parent, then a slow float on Koko.
 */
import { useId } from "react";

const SIZES = "(min-width: 1024px) 340px, 56vw";
const set = (name: string) => `/brand/welcome/${name}-480.webp 480w, /brand/welcome/${name}-960.webp 960w`;

export function WelcomeArt({ className }: { className?: string }) {
  // Ids are per instance (an admin preview may render a second copy next to the live one).
  const u = useId().replace(/:/g, "");
  const id = (n: string) => `pwa-${n}-${u}`;
  const ref = (n: string) => `url(#${id(n)})`;
  return (
    <div className={className ? `wa-stage ${className}` : "wa-stage"} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size local art, no optimiser round trip on launch */}
      <img className="wa-kiki" src="/brand/welcome/kiki-480.webp" srcSet={set("kiki")} sizes={SIZES} width={480} height={497} alt="" decoding="async" draggable={false} />
      <div className="wa-float wa-koko">
        {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
        <img src="/brand/welcome/koko-480.webp" srcSet={set("koko")} sizes={SIZES} width={480} height={525} alt="" decoding="async" draggable={false} />
      </div>
      <svg className="wa-cloud wa-globe" viewBox="178 40 104 68" fill="none" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <defs>
          <radialGradient id={id("globe")} cx=".34" cy=".28" r=".9" fx=".34" fy=".28">
            <stop offset="0" stopColor="#d2efff" />
            <stop offset=".5" stopColor="#47a6f4" />
            <stop offset="1" stopColor="#1a5cc2" />
          </radialGradient>
          <filter id={id("soft")} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
          <clipPath id={id("earth")}>
            <circle cx="226" cy="74" r="27" />
          </clipPath>
        </defs>
        <circle cx="226" cy="74" r="27" fill={ref("globe")} />
        <g clipPath={ref("earth")} fill="#7fdc6c">
          <path d="M206 58c8-6 18-4 20 3s-6 10-4 17-8 10-14 5-10-19-2-25z" />
          <path d="M234 82c6-3 14 0 16 6s-4 14-10 13-12-14-6-19z" />
          <path d="M236 50c5-1 10 2 9 5s-7 4-10 2-3-6 1-7z" />
        </g>
        <ellipse cx="215" cy="62" rx="9" ry="5" transform="rotate(-30 215 62)" fill="#fff" opacity=".7" filter={ref("soft")} />
        <path d="M184 90c-6 8 12 14 42 10s54-16 50-27c-2-5-12-7-25-6" stroke="currentColor" strokeWidth="2.6" />
        <path d="M258 62l-8 5 9 4" stroke="currentColor" strokeWidth="2.6" />
      </svg>
    </div>
  );
}

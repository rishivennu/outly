"use client";
import { useTilt } from "./Collectible";
import { cn } from "@/lib/utils";

const ROWS = [3, 5, 6, 5, 3];
const FILL = [
  "linear-gradient(160deg,#8e35c9,#e3266f)",
  "linear-gradient(160deg,#ff5a52,#b3120f)",
  "linear-gradient(160deg,#2b2b30,#0b0b0c)",
  "linear-gradient(160deg,#f86a3d,#ffd776)",
  "linear-gradient(160deg,#3b5bff,#0b1a6b)",
];

/** A convex wall of glowing tiles, built from the creator's own thumbnails. Decorative. */
export function CardWall({ images, className, height = 340 }: { images: (string | null)[]; className?: string; height?: number }) {
  const tilt = useTilt(6);
  const pics = images.filter(Boolean) as string[];
  let i = 0;
  return (
    <div aria-hidden="true" {...tilt} className={cn("card-wall relative mx-auto flex w-full items-center justify-center", className)} style={{ height }}>
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(hsl(var(--foreground)/0.07)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--foreground)/0.07)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(60%_60%_at_50%_50%,#000,transparent)]" />
      <div className="relative flex flex-col items-center gap-[10px] [transform-style:preserve-3d] [transition:transform_.6s_cubic-bezier(.2,.8,.2,1)]" style={{ transform: "rotateX(calc(var(--tx,0)*1deg)) rotateY(calc(var(--ty,0)*1deg))" }}>
        {ROWS.map((n, r) => {
          const cy = (r - (ROWS.length - 1) / 2) / ((ROWS.length - 1) / 2);
          return (
            <div key={r} className="flex items-center gap-[10px] [transform-style:preserve-3d]">
              {Array.from({ length: n }).map((_, c) => {
                const cx = n === 1 ? 0 : (c - (n - 1) / 2) / 2.6;
                const d2 = cx * cx + cy * cy;
                const size = Math.round((height / 4.4) * (1 - 0.32 * Math.min(d2, 1.4)));
                const src = pics.length ? pics[i++ % pics.length] : null;
                const k = i++;
                return (
                  <div
                    key={c}
                    className="card-wall-tile relative shrink-0 overflow-hidden rounded-[14px] bg-card"
                    style={{
                      width: size,
                      height: size,
                      transform: `translateZ(${-d2 * 90}px) rotateY(${cx * 34}deg) rotateX(${-cy * 22}deg)`,
                      opacity: 1 - 0.25 * Math.min(d2, 1.4),
                      background: src ? undefined : FILL[k % FILL.length],
                    }}
                  >
                    {src && <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />}
                    <span className="absolute inset-0 bg-[linear-gradient(140deg,hsl(0_0%_100%/0.25),transparent_40%)]" />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}

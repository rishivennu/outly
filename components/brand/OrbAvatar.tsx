"use client";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { orbColor, resolveAvatar, type Orb, type OrbFace } from "@/lib/avatar";

const INK = "#15131a";

/** Bold black faces near the top of the orb (viewBox 100x100). Filled shapes stay legible at 24px. */
const FACES: Record<OrbFace, React.ReactNode> = {
  joy: (<>
    <path d="M34 31c0-5 3-8 6.5-8s6.5 3 6.5 8z" /><path d="M53 31c0-5 3-8 6.5-8s6.5 3 6.5 8z" />
    <path d="M37 38c7 7 19 7 26 0" fill="none" stroke={INK} strokeWidth="3.6" strokeLinecap="round" />
  </>),
  cheeky: (<>
    <path d="M32 27c1-5 5-7 9-6s6 4 5 8c-4-2-9-3-14-2z" /><path d="M53 31c0-4 3-7 7-7s7 3 7 6c-5 0-9 0-14 1z" />
    <path d="M38 41c5-4 13-6 22-4" fill="none" stroke={INK} strokeWidth="3.6" strokeLinecap="round" />
  </>),
  calm: (<>
    <path d="M32 26h15v3.2c-5 1.5-10 1.5-15 0z" /><path d="M53 26h15v3.2c-5 1.5-10 1.5-15 0z" />
    <path d="M44 38.5c4-1 9-1 13 0.5" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
  </>),
  fierce: (<>
    <path d="M31 22l16 6c0 4-3 6-7 6s-8-4-9-12z" /><path d="M69 22l-16 6c0 4 3 6 7 6s8-4 9-12z" />
    <path d="M41 41c5-4 13-4 18 0" fill="none" stroke={INK} strokeWidth="3.6" strokeLinecap="round" />
  </>),
  focus: (<>
    <ellipse cx="41" cy="27" rx="6.4" ry="5.6" /><ellipse cx="59" cy="27" rx="6.4" ry="5.6" />
    <path d="M30 37.5c13-1.5 27-1 40 0.8" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
  </>),
  soft: (<>
    <path d="M33 30c1-5 5-8 10-7 2 0.5 4 2 4 4-5 0-9 1-14 3z" /><path d="M67 30c-1-5-5-8-10-7-2 0.5-4 2-4 4 5 0 9 1 14 3z" />
    <path d="M42 40c4-4 12-4 16 0" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
  </>),
  shy: (<>
    <path d="M36 28c0-4 2.5-6 5.5-6s5.5 2 5.5 6z" /><path d="M53 28c0-4 2.5-6 5.5-6s5.5 2 5.5 6z" />
    <path d="M38 35.5c2.5-2.5 5-2.5 6 0s3.5 2.5 6 0 5-2.5 6 0 3.5 2.5 6 0" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
  </>),
  starry: (<>
    <ellipse cx="40" cy="28" rx="7.4" ry="6.2" transform="rotate(-12 40 28)" /><ellipse cx="60" cy="28" rx="7.4" ry="6.2" transform="rotate(12 60 28)" />
    <path d="M43 22.5l0.9 2 2 0.9-2 0.9-0.9 2-0.9-2-2-0.9 2-0.9z M63 22.5l0.9 2 2 0.9-2 0.9-0.9 2-0.9-2-2-0.9 2-0.9z" fill="#fff" />
    <path d="M36 39c3 3 7 3 10 0" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
  </>),
  blush: (<>
    <path d="M32 31c0-6 4-9 8-9s8 3 8 9c-2-2.5-4.5-3.5-8-3.5s-6 1-8 3.5z" /><path d="M52 31c0-6 4-9 8-9s8 3 8 9c-2-2.5-4.5-3.5-8-3.5s-6 1-8 3.5z" />
    <ellipse cx="33" cy="39" rx="5" ry="2.6" fill="#fff" opacity="0.35" /><ellipse cx="67" cy="39" rx="5" ry="2.6" fill="#fff" opacity="0.35" />
  </>),
};

/** Just the drawing, for pickers and previews. */
export function OrbArt({ orb, size = 40, className, label }: { orb: Orb; size?: number; className?: string; label?: string }) {
  const id = useId().replace(/:/g, "");
  const c = orbColor(orb.color);
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("orb-avatar shrink-0 overflow-visible", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <radialGradient id={`ob-${id}`} cx="0.42" cy="0.3" r="0.75">
          <stop offset="0" stopColor={c.light} />
          <stop offset="0.48" stopColor={c.base} />
          <stop offset="1" stopColor={c.deep} />
        </radialGradient>
        <filter id={`os-${id}`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6" /></filter>
        <filter id={`oh-${id}`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      <circle cx="50" cy="55" r="38" fill={c.base} opacity="0.5" filter={`url(#oh-${id})`} />
      <circle cx="50" cy="51" r="44" fill={`url(#ob-${id})`} filter={`url(#os-${id})`} />
      <ellipse cx="41" cy="30" rx="20" ry="11" fill="#fff" opacity="0.28" filter={`url(#oh-${id})`} />
      <g fill={INK}>{FACES[orb.face]}</g>
    </svg>
  );
}

/**
 * A person's avatar: their photo if they have one, otherwise their orb. `seed` (email or id) keeps
 * the default orb stable everywhere. Decorative unless `label` is set (names usually sit beside it).
 */
export function OrbAvatar({ avatar, seed, size = 36, className, label }: { avatar?: string | null; seed: string; size?: number; className?: string; label?: string }) {
  const r = resolveAvatar(avatar, seed);
  if ("photo" in r)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={r.photo} alt={label ?? ""} width={size} height={size} referrerPolicy="no-referrer" className={cn("shrink-0 rounded-full object-cover hairline", className)} style={{ width: size, height: size }} />;
  return <OrbArt orb={r.orb} size={size} className={className} label={label} />;
}

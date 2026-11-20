import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/domain";
import { PlatformLogo, type LogoSurface } from "@/components/brand/brands";

/**
 * R1259: a full tile (Instagram, Threads, LinkedIn) reads heavier than a bare mark in the same box, so the tiles sit a
 * touch smaller and the open marks (X, TikTok) nearly fill it.
 */
const OPTICAL: Record<Platform, number> = { instagram: 0.9, threads: 0.9, linkedin: 0.9, facebook: 0.94, youtube: 1, x: 0.96, tiktok: 1 };

/**
 * A platform's mark at the size the caller's className gives it: the platform's own full-colour logo (R1210,
 * components/brand/brands.tsx). `surface` picks the reversed X, TikTok and Threads for a dark background; the
 * default follows the site theme.
 */
export function PlatformGlyph({ platform, className, surface }: { platform: Platform; className?: string; surface?: LogoSurface }) {
  return <PlatformLogo platform={platform} surface={surface} className={className} style={{ transform: `scale(${OPTICAL[platform]})` }} />;
}

/**
 * R1259: how much of the box each logo fills now that there is no orb behind it, so they all carry the same weight:
 * the square tiles are the reference, the circle (Facebook) and the wide YouTube tile sit larger, the open X and
 * TikTok marks larger still because most of their box is empty.
 */
export const ORB_FIT: Record<Platform, number> = { instagram: 0.8, threads: 0.8, linkedin: 0.8, facebook: 0.86, youtube: 0.94, x: 0.84, tiktok: 0.86 };

/**
 * The platform mark in a fixed square box, the main way platforms show up across the product. R1259: the logo sits
 * straight on the parent's background (no orb). `surface` follows the theme; pass "dark" on a card that is dark in
 * both themes so X, TikTok and Threads come reversed. `ring` (overlapping stacks, badges on an avatar) used to cut a
 * background-coloured ring around the orb; with no orb that ring would be a circle of its own, so instead the logo
 * sits smaller in the same box and leaves the gap.
 */
export function PlatformOrb({ platform, size = 40, className, ring, square, surface }: { platform: Platform; size?: number; className?: string; ring?: boolean; square?: boolean; surface?: LogoSurface }) {
  const fit = `${Math.round(ORB_FIT[platform] * (ring ? 0.86 : 1) * 1000) / 10}%`;
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center", square ? "rounded-[28%]" : "rounded-full", className)}
      style={{ width: size, height: size }}
    >
      <PlatformLogo platform={platform} surface={surface} className="object-contain" style={{ width: fit, height: fit }} />
    </span>
  );
}

export const PLATFORM_HALO: Record<Platform, string> = {
  instagram: "hsl(var(--instagram))",
  youtube: "hsl(var(--youtube))",
  x: "hsl(var(--x))",
  tiktok: "hsl(var(--tiktok))",
  threads: "hsl(var(--threads))",
  facebook: "hsl(var(--facebook))",
  linkedin: "hsl(var(--linkedin))",
};

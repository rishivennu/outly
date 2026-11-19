import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/domain";
import { PlatformLogo, type LogoSurface } from "@/components/brand/brands";

/** R1210: a logo that is a tile reads bigger than a bare mark in the same box, so the tiles sit a touch smaller. */
const OPTICAL: Record<Platform, number> = { instagram: 0.92, threads: 0.92, linkedin: 0.9, facebook: 0.96, youtube: 1, x: 0.88, tiktok: 0.96 };

/**
 * A platform's mark at the size the caller's className gives it: the platform's own full-colour logo (R1210,
 * components/brand/brands.tsx). `surface` picks the reversed X, TikTok and Threads for a dark background; the
 * default follows the site theme.
 */
export function PlatformGlyph({ platform, className, surface }: { platform: Platform; className?: string; surface?: LogoSurface }) {
  return <PlatformLogo platform={platform} surface={surface} className={className} style={{ transform: `scale(${OPTICAL[platform]})` }} />;
}

/** R1210: how much of the white orb each logo fills, so they all carry the same weight. */
const ORB_FIT: Record<Platform, number> = { instagram: 0.58, youtube: 0.64, x: 0.48, tiktok: 0.54, threads: 0.58, facebook: 0.64, linkedin: 0.54 };

/**
 * Circular platform mark, the main way platforms show up across the product. R1210: the platform's own logo on a
 * white orb, the same in both themes, with a hairline so it holds its edge on a white card.
 */
export function PlatformOrb({ platform, size = 40, className, ring, square }: { platform: Platform; size?: number; className?: string; ring?: boolean; square?: boolean }) {
  const fit = `${ORB_FIT[platform] * 100}%`;
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.08)]", square ? "rounded-[28%]" : "rounded-full", ring && "ring-[3px] ring-background", className)}
      style={{ width: size, height: size }}
    >
      <PlatformLogo platform={platform} surface="light" style={{ width: fit, height: fit }} />
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

import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/domain";
import { BrandGlyph } from "@/components/brand/brands";

/** Brand marks as inline SVG: the platforms' own logos (see components/brand/brands.tsx), in currentColor. */
export function PlatformGlyph({ platform, className }: { platform: Platform; className?: string }) {
  if (platform === "facebook")
    // The official Facebook logo is a filled circle; inside a coloured orb the bare "f" reads better.
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
        <path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.5V21h3Z" />
      </svg>
    );
  return <BrandGlyph brand={platform} className={className} />;
}

const ORB: Record<Platform, string> = {
  instagram: "bg-[radial-gradient(circle_at_30%_110%,#ffd776_0%,#f86a3d_30%,#e3266f_58%,#8e35c9_100%)] text-white",
  youtube: "bg-[hsl(var(--youtube))] text-white",
  x: "bg-foreground text-background",
  tiktok: "bg-[linear-gradient(135deg,#25f4ee_0%,#111_38%,#111_62%,#fe2c55_100%)] text-white",
  threads: "bg-foreground text-background",
  facebook: "bg-[#1877f2] text-white",
  linkedin: "bg-[#0a66c2] text-white",
};

/** Circular platform mark, the main way platforms show up across the product. */
export function PlatformOrb({ platform, size = 40, className, ring, square }: { platform: Platform; size?: number; className?: string; ring?: boolean; square?: boolean }) {
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center", square ? "rounded-[28%]" : "rounded-full", ORB[platform], ring && "ring-[3px] ring-background", className)}
      style={{ width: size, height: size }}
    >
      <PlatformGlyph platform={platform} className="h-[46%] w-[46%]" />
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

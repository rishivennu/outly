import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/domain";

/** Brand marks as inline SVG (simplified, for recognisability). */
export function PlatformGlyph({ platform, className }: { platform: Platform; className?: string }) {
  if (platform === "instagram")
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="5.5" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    );
  if (platform === "youtube")
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
        <path d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5a2.7 2.7 0 0 0-1.9 1.9C2 8.9 2 12 2 12s0 3.1.4 4.8a2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9c.4-1.7.4-4.8.4-4.8s0-3.1-.4-4.8ZM10 15.1V8.9l5.2 3.1L10 15.1Z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" />
    </svg>
  );
}

const ORB: Record<Platform, string> = {
  instagram: "bg-[radial-gradient(circle_at_30%_110%,#ffd776_0%,#f86a3d_30%,#e3266f_58%,#8e35c9_100%)] text-white",
  youtube: "bg-[hsl(var(--youtube))] text-white",
  x: "bg-foreground text-background",
};

/** Circular platform mark, the main way platforms show up across the product. */
export function PlatformOrb({ platform, size = 40, className, ring }: { platform: Platform; size?: number; className?: string; ring?: boolean }) {
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-full", ORB[platform], ring && "ring-[3px] ring-background", className)}
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
};

import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The founding member stamp: the brand rocket sticker, set at a slight angle like a real stamp.
 * `variant` picks one of the five stickers in /public/brand/founding.
 */
const ART = {
  badge: { src: "/brand/founding/01-rocket-badge.png", w: 512, h: 508 },
  pill: { src: "/brand/founding/02-wordmark-pill.png", w: 512, h: 187 },
  tile: { src: "/brand/founding/03-app-tile.png", w: 512, h: 509 },
  flower: { src: "/brand/founding/04-rocket-flower.png", w: 512, h: 512 },
  ring: { src: "/brand/founding/05-outlly-ring.png", w: 512, h: 512 },
} as const;

export function FoundingStamp({ size = 72, variant = "badge", label, className, tilt = true }: { size?: number; variant?: keyof typeof ART; label?: string; className?: string; tilt?: boolean }) {
  const a = ART[variant];
  return (
    <Image
      src={a.src}
      width={a.w}
      height={a.h}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      sizes={`${size}px`}
      style={{ width: size, height: "auto" }}
      className={cn("shrink-0 select-none drop-shadow-[0_6px_14px_rgba(0,0,0,0.35)]", tilt && "-rotate-6", className)}
    />
  );
}

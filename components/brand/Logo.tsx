import { cn } from "@/lib/utils";

/**
 * Outlly mark (2026-10 rebrand). Default (10-12f, user's call): the bare rocket, no tile.
 * Light mode gets the deep-green rocket (4.4:1 on cream), dark mode the lime rocket.
 * Both are rendered and CSS shows one, so there is no flash and no client JS.
 * Raster on purpose: the gradient + white streak are the supplied artwork, not a redraw.
 * `variant`: icon (default), tile (old rounded tile, for app-icon spots), glyph (lime), ink, white.
 * `tone` pins a colour when it sits on a surface that does not follow the theme
 * ("light" = sits on a light surface, "dark" = sits on a dark surface).
 */
const px = (size: number) => (size <= 32 ? 64 : size <= 64 ? 128 : size <= 128 ? 256 : 512);

export function OutlyMark({
  size = 28,
  className,
  variant = "icon",
  tone = "auto",
}: {
  size?: number;
  className?: string;
  variant?: "icon" | "tile" | "glyph" | "ink" | "white";
  tone?: "auto" | "light" | "dark";
}) {
  const common = { width: size, height: size, alt: "", "aria-hidden": true as const, decoding: "async" as const, draggable: false };
  if (variant === "icon") {
    const deep = "/brand/rocket/rocket-deep-256.png";
    const lime = "/brand/rocket/rocket-256.png";
    const base = "shrink-0 select-none object-contain";
    if (tone !== "auto")
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={tone === "light" ? deep : lime} {...common} className={cn(base, className)} />;
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={deep} {...common} className={cn(base, "dark:hidden", className)} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={lime} {...common} className={cn(base, "hidden dark:block", className)} />
      </>
    );
  }
  if (variant !== "tile") {
    const src = `/brand/rocket/${variant === "glyph" ? "rocket" : variant === "ink" ? "rocket-ink" : "rocket-white"}-256.png`;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} {...common} className={cn("shrink-0 select-none", className)} />;
  }
  const n = px(size);
  const dark = `/brand/rocket/mark-${Math.min(n, 256)}.png`;
  const light = `/brand/rocket/mark-light-${n}.png`;
  const base = "shrink-0 select-none rounded-[22%]";
  if (tone !== "auto")
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={tone === "light" ? light : dark} {...common} className={cn(base, tone === "light" && "brand-tile-light", className)} />;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dark} {...common} className={cn(base, "dark:hidden", className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={light} {...common} className={cn(base, "brand-tile-light hidden dark:block", className)} />
    </>
  );
}

export function OutlyLogo({ size = 28, className, label = true, tone = "auto" }: { size?: number; className?: string; label?: boolean; tone?: "auto" | "light" | "dark" }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <OutlyMark size={size} tone={tone} />
      {label && <span className="font-display text-[1.15em] font-bold tracking-[-0.045em]">outlly</span>}
    </span>
  );
}

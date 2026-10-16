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
/**
 * Rocket file for a drawn size (10-16 perf): up to 48px draws from a 96px WebP (~5 KB, sharp at 2x)
 * instead of the 256px PNG (35-53 KB). Both theme copies are in the page, so this matters twice.
 */
const rocket = (name: string, size: number) => (size <= 48 ? `/brand/rocket/${name}-96.webp` : `/brand/rocket/${name}-256.png`);
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
  const common = { width: size, height: size, alt: "", "aria-hidden": true as const, decoding: "async" as const, draggable: false, loading: "lazy" as const }; // lazy: the CSS-hidden theme copy is never fetched
  if (variant === "icon") {
    // Same lime gradient in both themes (user's call, 10-12g). Light mode gets the deepened copy:
    // bright lime is 1.2-1.5:1 on cream (invisible); this one is >= 3.3:1 and keeps the gradient.
    const onLight = rocket("rocket-lime-ink", size);
    const onDark = rocket("rocket", size);
    const base = "shrink-0 select-none object-contain";
    if (tone !== "auto")
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={tone === "light" ? onLight : onDark} {...common} className={cn(base, className)} />;
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={onLight} {...common} className={cn(base, "dark:hidden", className)} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={onDark} {...common} className={cn(base, "hidden dark:block", className)} />
      </>
    );
  }
  if (variant !== "tile") {
    const src = rocket(variant === "glyph" ? "rocket" : variant === "ink" ? "rocket-ink" : "rocket-white", size);
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

/**
 * Mark + wordmark. The rocket is sized from the wordmark's own font (em), not pixels, so it always
 * matches the letters: MARK_EM of the wordmark size, centred on the word with a tight gap.
 * The wordmark keeps its size (1.15em of the surrounding text); `size` only matters with label={false}.
 */
const MARK_EM = 1.08; // a touch taller than the letters, centred on them (user: "make it bigger", 10-12g)

export function OutlyLogo({ size = 28, className, label = true, tone = "auto" }: { size?: number; className?: string; label?: boolean; tone?: "auto" | "light" | "dark" }) {
  if (!label) return <OutlyMark size={size} tone={tone} className={className} />;
  return (
    <span className={cn("inline-flex", className)}>
      <span className="inline-flex items-center gap-[0.16em] font-display text-[1.15em] font-bold leading-none tracking-[-0.045em]" style={{ ["--mk" as string]: `${MARK_EM}em` }}>
        <OutlyMark size={size} tone={tone} className="h-[var(--mk)] w-[var(--mk)]" />
        <span>outlly</span>
      </span>
    </span>
  );
}

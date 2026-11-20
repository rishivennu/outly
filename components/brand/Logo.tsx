import Link from "next/link";
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
 * instead of the 256px one. R1222: the 256px copies and the tiles are WebP too (9-20 KB, were 18-225 KB as PNG).
 * Both theme copies are in the page, so this matters twice.
 */
const rocket = (name: string, size: number) => (size <= 48 ? `/brand/rocket/${name}-96.webp` : `/brand/rocket/${name}-256.webp`);
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
  const dark = `/brand/rocket/mark-${Math.min(n, 256)}.webp`;
  const light = `/brand/rocket/mark-light-${n}.webp`;
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

type Tone = "auto" | "light" | "dark";
export type OutllyBrandVariant = "icon" | "compact" | "full";

// The rocket is sized from the wordmark's own font (em), so it always matches the letters: a touch taller, centred on them (10-12g).
export const MARK_EM = 1.08;

// Tailwind only ships classes it can read in the source, so the switch points are a fixed set (max-[Npx] = narrower than N).
export const COMPACT_BELOW = {
  360: "max-[360px]:hidden",
  400: "max-[400px]:hidden",
  480: "max-[480px]:hidden",
  640: "max-[640px]:hidden",
} as const;
export type CompactBelow = keyof typeof COMPACT_BELOW;

/** The symbol on its own (variant A): the supplied rocket art, square, never redrawn. */
export function OutllyLogoIcon({ size = 28, tone = "auto", className }: { size?: number; tone?: Tone; className?: string }) {
  return <OutlyMark size={size} tone={tone} className={className} />;
}

/** The word on its own. It takes the colour of the text around it, so it reads on either theme. */
export function OutllyWordmark({ className }: { className?: string }) {
  return <span className={cn("font-display font-bold tracking-[-0.045em]", className)}>outlly</span>;
}

/**
 * One Outlly identity, three uses (docs/brand.md):
 * - "full": rocket + wordmark (site header and footer, sign in, desktop sidebars, drawers).
 * - "compact": the rocket alone in a 44px header slot (phone headers when space is short, compact nav).
 * - "icon": the bare rocket (tiles, loading, small identifiers).
 * `size` is the rocket height in px; without it a full lockup follows the surrounding text (wordmark 1.15em).
 * The accessible name "Outlly" is given once, on the wrapper; `label={false}` when a parent already names it.
 */
export function OutllyBrand({
  variant = "full",
  size,
  tone = "auto",
  className,
  href,
  label = "Outlly",
  compactBelow,
}: {
  variant?: OutllyBrandVariant;
  size?: number;
  tone?: Tone;
  className?: string;
  href?: string;
  label?: string | false;
  compactBelow?: CompactBelow;
}) {
  const name = label && !href ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  let body: React.ReactNode;
  if (variant === "full")
    body = (
      <span className={cn("inline-flex", className)} {...name}>
        <span className={cn("inline-flex items-center gap-[0.16em] leading-none", !size && "text-[1.15em]")} style={{ ["--mk" as string]: `${MARK_EM}em`, ...(size ? { fontSize: size / MARK_EM } : {}) }}>
          <OutlyMark size={size ?? 28} tone={tone} className="h-[var(--mk)] w-[var(--mk)]" />
          <OutllyWordmark className={compactBelow && COMPACT_BELOW[compactBelow]} />
        </span>
      </span>
    );
  else
    body = (
      <span className={cn("inline-flex shrink-0 items-center justify-center", variant === "compact" && "h-11 min-w-11", className)} {...name}>
        <OutlyMark size={size ?? (variant === "compact" ? 26 : 28)} tone={tone} />
      </span>
    );
  if (!href) return body;
  return (
    <Link href={href} aria-label={label || "Outlly"} className="inline-flex min-h-11 items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      {body}
    </Link>
  );
}

/** Legacy name for the full lockup; `label={false}` keeps its old meaning (rocket only). Size follows the text, as before. */
export function OutlyLogo({ size = 28, className, label = true, tone = "auto", compactBelow }: { size?: number; className?: string; label?: boolean; tone?: Tone; compactBelow?: CompactBelow }) {
  if (!label) return <OutlyMark size={size} tone={tone} className={className} />;
  return <OutllyBrand variant="full" tone={tone} className={className} compactBelow={compactBelow} />;
}

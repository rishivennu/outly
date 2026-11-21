import "server-only";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PEEPS, type PeepName } from "./data";

export type { PeepName } from "./data";
export { PEEP_NAMES } from "./data";

/** The rendered width of a figure at `height` CSS pixels, from its own viewBox, so nothing shifts when it paints. */
export function peepWidth(name: PeepName, height: number): number {
  const [, , w, h] = PEEPS[name].viewBox.split(" ").map(Number);
  return Math.round((height * w) / h);
}

/**
 * One figure from the Outlly cast (data.ts). Decorative: aria-hidden, never carrying a meaning the text beside it does
 * not. Ink follows `currentColor`; the paper areas take `fill` (default: the card surface, so the figure reads as a line
 * drawing that occludes what sits behind it). Server-only: the path data travels in the HTML, never in a client bundle;
 * client components take a Peep as a ReactNode prop from their page.
 */
export function Peep({ name, height = 112, fill = "hsl(var(--card))", className, style }: { name: PeepName; height?: number; fill?: string; className?: string; style?: CSSProperties }) {
  const { viewBox, markup } = PEEPS[name];
  return (
    <svg
      viewBox={viewBox}
      width={peepWidth(name, height)}
      height={height}
      aria-hidden="true"
      focusable="false"
      data-peep={name}
      className={cn("shrink-0 select-none", className)}
      style={{ "--peep-fill": fill, ...style } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

/** The studio's ink and paper, fixed: the spot figure is an illustration, the same light sticker on both themes. */
export const SPOT_INK = "#131315";
export const SPOT_PAPER = "#f6f4ee";

/**
 * The empty-state and status spot: a solid sticker (dark ink on warm-white paper) standing in a lime disc. The figure
 * runs on below the box and the clip follows the disc's lower arc, so the bust is cut by the circle the way Open Peeps
 * presents its own busts; the head and any outstretched hand break the circle freely. `height` is the visible height;
 * the box is never narrower than the figure. `children` lands in the box's bottom-right corner (a small badge, optional).
 */
export function PeepSpot({ name, height = 128, ink = SPOT_INK, fill = SPOT_PAPER, className, children }: { name: PeepName; height?: number; ink?: string; fill?: string; className?: string; children?: ReactNode }) {
  const figure = Math.round(height * 1.16);
  const sink = figure - height;
  const disc = Math.round(height * 0.84);
  const fw = peepWidth(name, figure);
  const width = Math.max(disc, fw);
  const r = disc / 2;
  const cx = width / 2;
  const cy = height - r;
  const clip = `path("M0 0H${width}V${height}H${cx + r}V${cy}A${r} ${r} 0 0 1 ${cx - r} ${cy}V${height}H0Z")`;
  return (
    <span aria-hidden="true" data-peep-spot={name} className={cn("relative inline-block shrink-0 align-bottom", className)} style={{ width, height, clipPath: clip }}>
      <span className="absolute bottom-0 rounded-full bg-lime/15 dark:bg-lime/20" style={{ left: cx - r, width: disc, height: disc }} />
      <Peep name={name} height={figure} fill={fill} className="absolute" style={{ left: cx - fw / 2, bottom: -sink, color: ink }} />
      {children}
    </span>
  );
}

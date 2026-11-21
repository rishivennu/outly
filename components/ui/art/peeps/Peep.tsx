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

/**
 * The empty-state and status spot: the figure standing in front of a lime disc, taller than the disc so the head
 * breaks the circle, the bust's flat cut rounded off by the disc's lower edge. The same `bg-lime/15` disc the icon
 * empty states use, grown up. `children` sits in the disc's bottom-right corner (a small badge, optional).
 */
export function PeepSpot({ name, height = 128, fill, className, children }: { name: PeepName; height?: number; fill?: string; className?: string; children?: ReactNode }) {
  const disc = Math.max(Math.round(height * 0.72), peepWidth(name, height));
  return (
    <span
      aria-hidden="true"
      data-peep-spot={name}
      className={cn("relative inline-grid shrink-0 justify-items-center overflow-hidden", className)}
      style={{ width: disc, height, alignItems: "end", borderRadius: `0 0 ${disc / 2}px ${disc / 2}px` }}
    >
      <span className="absolute bottom-0 left-0 rounded-full bg-lime/15" style={{ width: disc, height: disc }} />
      <Peep name={name} height={height} fill={fill} className="relative" />
      {children}
    </span>
  );
}

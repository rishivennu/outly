import { cn } from "@/lib/utils";

/**
 * 1183: a row of cards for the horizontal scrolling gallery (lib/motion/hscroll.ts, started by ScrollScenes). Each
 * child is one card wrapped in an .hs-item. As plain markup (no JS, reduced motion) it is a native sideways scroller
 * with snap points and a visible scrollbar; `label` names it for screen readers, and `focusable` gives a row with no
 * buttons of its own a tab stop, so the keyboard can scroll it. R1196: `list` makes the track a <ul> (its cards are
 * then <li class="hs-item">), for a row that is a list, like the pricing plans.
 */
export function HScroll({ children, label, focusable = false, list = false, className }: { children: React.ReactNode; label: string; focusable?: boolean; list?: boolean; className?: string }) {
  const Track = list ? "ul" : "div";
  return (
    <div className={cn("hs", className)} data-hscroll="">
      <div className="hs-box" data-hs-box="" role="region" aria-label={label} tabIndex={focusable ? 0 : undefined}>
        <Track className="hs-track" data-hs-track="">
          {children}
        </Track>
      </div>
      <p className="hs-hint" aria-hidden="true">Swipe or scroll sideways to see more</p>
    </div>
  );
}

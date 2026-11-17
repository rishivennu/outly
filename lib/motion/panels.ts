import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * 1181: pinned panels with overscroll, the GSAP demo the user asked for on the landing page (11-17,
 * demos.gsap.com/demo/pinned-panels-with-overscroll). Each panel is a full-screen sheet. When its bottom reaches the
 * bottom of the screen it stays put (pinned without spacing) while the next sheet slides up over it, and it sinks
 * away underneath: scale 1 to 0.7 and opacity 1 to 0.5 over the first 90% of that slide, then out to 0. Scrubbed,
 * so it is the scroll position itself (ScrollSmoother already smooths it), exactly as in the demo.
 *
 * A panel taller than the screen is simply read to its end first (the demo's "overscroll": its content scrolls on
 * before the next sheet comes in). It sinks around the middle of what is on screen, not its own middle far above.
 *
 * A hold (How it works, Demo) keeps a panel on screen for `hold` screens before the next sheet starts: the demo's fake
 * scroll ratio, done with bottom margin, so the panel can play its steps first. `onHold` gets that progress (0..1).
 *
 * Flow panels (data-panel="flow": a section with its own pinned header) slide over the panel before them like any
 * other sheet but are never pinned themselves, since ScrollTrigger cannot nest pins. The last panel is never pinned
 * (nothing comes after it), as in the demo.
 */
export type PanelHold = { screens: number; onHold?: (p: number, active: boolean) => void };

export function stackPanels(panels: HTMLElement[], holds = new Map<HTMLElement, PanelHold>()): () => void {
  const made: ScrollTrigger[] = [];
  // Sheet styling first (globals.css .lp-panel[data-sheet]: full-screen, opaque, rounded top), so every pin measures the
  // final layout. Attributes on the panels themselves: a pin wraps each one in a pin-spacer, breaking sibling selectors.
  const root = panels[0]?.parentElement;
  root?.setAttribute("data-stack", "");
  panels.forEach((p, i) => p.setAttribute("data-sheet", i ? "next" : "first"));
  const pinned = panels.slice(0, -1).filter((p) => p.dataset.panel !== "flow");
  for (const panel of pinned) {
    const hold = holds.get(panel);
    const k = hold?.screens ?? 0;
    if (k) panel.style.marginBottom = `${k * 100}vh`; // the next sheet waits this long
    const sink = () => gsap.set(panel, { transformOrigin: `50% ${Math.max(panel.offsetHeight - innerHeight / 2, 0)}px` });
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: panel,
        start: "bottom bottom",
        end: () => `+=${Math.round(innerHeight * (1 + k))}`,
        pin: true,
        pinSpacing: false,
        scrub: true,
        invalidateOnRefresh: true,
        onRefresh: sink,
        onUpdate: hold?.onHold ? (st) => hold.onHold?.(Math.min(1, (st.progress * (1 + k)) / k), st.isActive) : undefined,
        onToggle: hold?.onHold ? (st) => hold.onHold?.(Math.min(1, (st.progress * (1 + k)) / k), st.isActive) : undefined,
      },
    });
    if (k) tl.to({}, { duration: k }); // the hold: the panel stays whole while its steps play
    tl.fromTo(panel, { scale: 1, opacity: 1 }, { scale: 0.7, opacity: 0.5, duration: 0.9, ease: "power1.out" })
      .to(panel, { opacity: 0, duration: 0.1, ease: "power1.out" });
    sink();
    if (tl.scrollTrigger) made.push(tl.scrollTrigger);
  }
  return () => {
    made.forEach((st) => st.kill(true));
    for (const p of pinned) {
      p.style.marginBottom = "";
      gsap.set(p, { clearProps: "transform,opacity,transformOrigin" });
    }
    root?.removeAttribute("data-stack");
    panels.forEach((p) => p.removeAttribute("data-sheet"));
  };
}

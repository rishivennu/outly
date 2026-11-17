import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);
// 1183: the stack runs on phones too. Their address bar grows and shrinks the window as the page scrolls; re-measuring
// every pin on each of those would make them jump, so only a real resize (the width changing) re-measures.
ScrollTrigger.config({ ignoreMobileResize: true });

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
 *
 * 1183: phones get the stack as well (it used to be 768px and up). The hold's room is set in px from the same
 * innerHeight the pin's end uses (a phone's 100vh is the tall viewport, taller than innerHeight while the address bar
 * shows), and again before every refresh. `bind` hands the hold's owner the scroll position of a given hold progress
 * (the horizontal galleries use it to bring a focused card into view).
 */
export type PanelHold = {
  screens: number;
  onHold?: (p: number, active: boolean) => void;
  bind?: (toScroll: (p: number) => number) => void;
};

export function stackPanels(panels: HTMLElement[], holds = new Map<HTMLElement, PanelHold>()): () => void {
  const made: ScrollTrigger[] = [];
  const room: Array<() => void> = [];
  // Sheet styling first (globals.css .lp-panel[data-sheet]: full-screen, opaque, rounded top), so every pin measures the
  // final layout. Attributes on the panels themselves: a pin wraps each one in a pin-spacer, breaking sibling selectors.
  const root = panels[0]?.parentElement;
  root?.setAttribute("data-stack", "");
  panels.forEach((p, i) => p.setAttribute("data-sheet", i ? "next" : "first"));
  const pinned = panels.slice(0, -1).filter((p) => p.dataset.panel !== "flow");
  for (const panel of pinned) {
    const hold = holds.get(panel);
    const k = hold?.screens ?? 0;
    const space = () => void (panel.style.marginBottom = `${Math.round(k * innerHeight)}px`); // the next sheet waits this long
    if (k) {
      space();
      room.push(space);
    }
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
    const st = tl.scrollTrigger;
    if (st) {
      made.push(st);
      if (k) hold?.bind?.((p) => st.start + p * (st.end - st.start) * (k / (1 + k)));
    }
  }
  const respace = () => room.forEach((f) => f());
  ScrollTrigger.addEventListener("refreshInit", respace);
  return () => {
    ScrollTrigger.removeEventListener("refreshInit", respace);
    made.forEach((st) => st.kill(true));
    for (const p of pinned) {
      p.style.marginBottom = "";
      gsap.set(p, { clearProps: "transform,opacity,transformOrigin" });
    }
    root?.removeAttribute("data-stack");
    panels.forEach((p) => p.removeAttribute("data-sheet"));
  };
}

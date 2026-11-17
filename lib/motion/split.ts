"use client";
import { loadGsap, type GsapApi } from "./gsap-lazy";
import { reduced, simple } from "./prefs";
import { GSAP_EASE, sec } from "./tokens";

type SplitPlugin = typeof import("gsap/SplitText").SplitText;
type SplitInstance = InstanceType<SplitPlugin>;

/**
 * 1188: page headlines arrive line by line (GSAP SplitText).
 *
 * The headline is split into its rendered lines, each line gets its own mask, and the lines rise out of
 * those masks one after another. SplitText re-splits itself when the window resizes or a web font finishes
 * loading (autoSplit), so a headline that re-wraps is never left with the wrong line boxes, and it restores
 * the original markup on unmount. Screen readers read the headline as one sentence: SplitText puts an
 * aria-label back on the element and hides the line pieces (aria: "auto").
 *
 * The LCP headline must be painted, not hidden: CSS holds it at opacity .01 (never 0, which Chrome ignores
 * for LCP) under html.js only, so without JS the text is simply there, and a 2s failsafe shows it anyway if
 * this never runs. Reduced motion: no split at all, the headline is just shown. Phones and low-power
 * devices: one short fade of the whole headline, no per-line work.
 *
 * Time-based only: a headline below the fold waits for one IntersectionObserver hit and then plays on its
 * own clock. Nothing here follows the scrollbar.
 */
const DONE = "data-split-done";
const DUR = 0.62;
const STEP = 0.08;

let plugin: SplitPlugin | null = null;
let loading: Promise<SplitPlugin | null> | null = null;

/** Load GSAP and the SplitText plugin once, on demand. Never throws: a failed load just shows the text. */
export function loadSplitText(): Promise<SplitPlugin | null> {
  loading ??= Promise.all([loadGsap(), import("gsap/SplitText")])
    .then(([g, m]) => {
      g.registerPlugin(m.SplitText);
      return (plugin = m.SplitText);
    })
    .catch(() => {
      loading = null;
      return null;
    });
  return loading;
}

const show = (el: HTMLElement) => el.setAttribute(DONE, "");

/** Play the lines of one headline. Returns the cleanup: it reverts the split and leaves the text as it was. */
export function splitLinesIn(el: HTMLElement | null): () => void {
  if (!el || typeof window === "undefined") return () => {};
  if (el.hasAttribute(DONE)) return () => {};
  if (reduced()) {
    show(el);
    return () => {};
  }

  let dead = false;
  let split: SplitInstance | null = null;
  let gsap: GsapApi | null = null;
  let io: IntersectionObserver | null = null;

  const run = () => {
    if (dead || !el.isConnected || !gsap) return;
    show(el);
    // Phones and low-power devices: one fade of the whole headline. Splitting a headline into lines and
    // masks is DOM work and a repaint per line; it is not worth it where frames are scarce.
    if (simple() || !plugin) {
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: sec("nav"), ease: GSAP_EASE.fade, clearProps: "opacity" });
      return;
    }
    split = plugin.create(el, {
      type: "lines",
      mask: "lines",
      autoSplit: true, // re-split (and replay from where it was) when the headline re-wraps or the font lands
      aria: "auto",
      linesClass: "sl-line",
      onSplit: (self) =>
        gsap!.fromTo(
          self.lines,
          { yPercent: 110, opacity: 0 },
          {
            yPercent: 0,
            opacity: 1,
            duration: DUR,
            // power2.inOut (1187's curve): the line leaves its mask gently and settles without a snap.
            ease: GSAP_EASE.smooth,
            stagger: STEP,
            clearProps: "opacity",
          },
        ),
    });
  };

  void Promise.all([loadGsap(), loadSplitText()]).then(([g]) => {
    if (dead) return;
    gsap = g;
    // Already on screen (the usual case: this is the page's own headline): play straight away.
    const vh = window.innerHeight || 0;
    const box = el.getBoundingClientRect();
    if (box.top < vh * 0.95 && box.bottom > 0) {
      run();
      return;
    }
    io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io?.disconnect();
        io = null;
        run();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
  }).catch(() => {
    // GSAP never arrived: show the headline as it is (the CSS failsafe would do it a moment later anyway).
    if (!dead) show(el);
  });

  return () => {
    dead = true;
    io?.disconnect();
    gsap?.killTweensOf(el);
    split?.revert();
    split = null;
  };
}

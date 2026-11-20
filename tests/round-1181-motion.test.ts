import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SMOOTH } from "@/lib/motion/tokens";

/*
 * Round 1181 (user, 11-17): the four GSAP demos the user picked, built into the site.
 *   1. One smooth scroll on every page, one curve, entry to exit (R1262: Lenis only, ScrollSmoother removed).
 *   2. Pinned panels with overscroll: the landing sections as sheets that stack.
 *   3. Animate text replacement: send buttons that type their own progress.
 *   4. Orchestrated easeReverse + interruptible single timeline: the two nav menus.
 * These tests pin the parts that are easy to break later (ordering, lazy loading, the markup the motion needs).
 */
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const src = (["app", "components", "lib"] as const).flatMap((d) =>
  (readdirSync(d, { recursive: true }) as string[])
    .filter((f) => /\.(tsx?|css)$/.test(f))
    .map((f) => ({ file: join(d, f).replace(/\\/g, "/"), text: read(join(d, f)) })),
);

describe("one smooth scroll for the whole app (1181, Lenis only since R1262)", () => {
  const lenis = read("components/marketing/SmoothScroll.tsx");
  const registry = read("lib/motion/smooth.ts");
  const layout = read("app/(marketing)/layout.tsx");

  test("one engine: Lenis, mounted once in the root client for every page", () => {
    expect(existsSync("components/marketing/Smoother.tsx")).toBe(false);
    const root = read("components/shared/RootClient.tsx");
    expect((root.match(/<SmoothScroll\b/g) ?? []).length).toBe(1);
    expect(lenis).toContain('import("lenis")');
    expect(registry).toContain('kind: "lenis";');
  });

  test("public pages render main and the footer straight in the layout, no scroll wrapper", () => {
    expect(layout).not.toContain("Smoother");
    expect(layout).toMatch(/<main id="main" tabIndex=\{-1\} className="outline-none">\{children\}<\/main>\s*<MarketingFooter \/>/);
  });

  test("the glide keeps the one curve", () => {
    expect(SMOOTH.duration).toBe(1);
    expect(SMOOTH.gsap).toBe("expo.out");
    expect(lenis).toContain("duration: SMOOTH.duration");
    expect(lenis).toContain("easing: smoothEase");
  });

  test("nothing claims the page and nothing imports ScrollSmoother", () => {
    for (const name of ["claimSmooth", "smoothClaimed", "onSmoothClaim", "whenScrollReady"]) {
      expect(src.filter((f) => f.text.includes(name)).map((f) => f.file)).toEqual([]);
    }
    expect(src.filter((f) => /gsap\/ScrollSmoother|getSmoother|html\.smoother|smooth-wrapper/.test(f.text)).map((f) => f.file)).toEqual([]);
  });

  test("nobody scrolls the page behind the engine's back", () => {
    expect(read("components/marketing/PageScrollbar.tsx")).toContain("scrollPageTo");
    expect(registry).toContain("export function scrollPageTo");
  });

  test("touch and reduced motion keep plain native scroll", () => {
    expect(lenis).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;');
    expect(lenis).toContain('window.matchMedia("(pointer: coarse)").matches) return;');
  });

  test("sticky bars stick natively again, and the nav keeps its own flow", () => {
    const css = read("app/globals.css");
    expect(css).not.toContain("--smooth-top");
    expect(css).not.toContain("#smooth-content");
  });

  test("the engine is never in the first-load bundle", () => {
    expect(registry).not.toMatch(/^import .*(gsap|lenis)/m);
    expect(lenis).not.toMatch(/^import (?!type)[^\n]*from "(gsap|lenis)/m);
    expect(lenis).toMatch(/import\("lenis"\)/);
  });
});

describe("pinned panels with overscroll (1181)", () => {
  const panels = read("lib/motion/panels.ts");
  const page = read("app/(marketing)/page.tsx");
  const scenes = read("components/marketing/ScrollScenes.tsx");

  test("every landing section is a sheet of the stack", () => {
    expect(page).toContain('<div className="lp-panel" data-panel={flow ? "flow" : "pin"}>');
    expect((page.match(/<Panel[ >]/g) ?? []).length).toBeGreaterThan(8);
  });

  test("a sheet stays put while the next slides over it, and sinks away", () => {
    expect(panels).toContain('start: "bottom bottom"');
    expect(panels).toContain("pin: true");
    expect(panels).toContain("pinSpacing: false");
    expect(panels).toMatch(/fromTo\(panel, \{ scale: 1, opacity: 1 \}, \{ scale: 0\.7, opacity: 0\.5/);
  });

  test("the last sheet is never pinned, and a section with its own pin only flows over", () => {
    expect(panels).toContain('panels.slice(0, -1).filter((p) => p.dataset.panel !== "flow")');
  });

  test("the sheet look is driven by attributes, which survive the pin-spacers GSAP adds", () => {
    expect(panels).toContain('p.setAttribute("data-sheet", i ? "next" : "first")');
    const css = read("app/globals.css");
    expect(css).toContain(".lp-panel[data-sheet]");
    expect(css).toContain('.lp-panel[data-sheet="next"]');
  });

  test("How it works and Demo hold their sheet instead of pinning themselves (pins cannot nest)", () => {
    expect(scenes).toContain("holds.set(sheet, { screens: 1.3");
    expect(scenes).toContain("holds.set(sheet, { screens: 1.6");
    expect(scenes).toContain("undo.push(stackPanels(panels, holds))");
    // 1183: the hold's room is px of the same innerHeight the pin's end uses (a phone's 100vh is taller than that).
    expect(panels).toContain("panel.style.marginBottom = `${Math.round(k * innerHeight)}px`");
  });

  test("1183: the stack runs on phones too, on native scroll, and the address bar never re-measures it", () => {
    expect(scenes).toContain('const panels = Array.from(main.querySelectorAll<HTMLElement>(".lp-panel"))');
    expect(panels).toContain("ScrollTrigger.config({ ignoreMobileResize: true })");
  });

  test("it cleans up after itself", () => {
    expect(panels).toContain("st.kill(true)");
    expect(panels).toContain('clearProps: "transform,opacity,transformOrigin"');
    expect(panels).toContain('removeAttribute("data-sheet")');
  });
});

describe("the nav menus: orchestrated easeReverse and one interruptible timeline (1181)", () => {
  const motion = read("lib/motion/navMotion.ts");
  const nav = read("components/marketing/Nav.tsx");

  test("every entrance ease has its own way out", () => {
    const backs = [...motion.matchAll(/ease: "back[^"]*"/g)];
    expect(backs.length).toBeGreaterThan(2);
    for (const line of motion.split("\n")) {
      if (/ease: "back/.test(line)) expect(line).toContain("easeReverse");
    }
  });

  test("the phone menu leaves by a different door than it came in", () => {
    expect(motion).toContain("tl.addPause()");
    expect(motion).toContain("const enterEnd = tl.duration()");
    expect(motion).toMatch(/y: "110vh", rotation: "random\(-25, 25\)"/);
    expect(motion).toContain('stagger: { from: "end", each: 0.02 }');
  });

  test("an interruption is never a jump: mid-entrance rewinds, mid-exit restarts", () => {
    expect(motion).toContain("if (tl.time() >= enterEnd) tl.restart();");
    expect(motion).toContain("if (tl.time() < enterEnd) tl.timeScale(1.5).reverse();");
  });

  test("the burger draws itself into a cross with the same two lines", () => {
    expect(motion).toContain("export const BURGER");
    expect(motion).toContain("export const CROSS");
    expect(nav).toContain("<line ref={barTop}");
    expect(nav).toContain("<line ref={barBot}");
  });

  test("GSAP is lazy here too, and reduced motion gets the menus with no motion at all", () => {
    expect(motion).toMatch(/^import type \{ GsapApi \}/m);
    expect(nav).toContain("loadGsap");
    expect(nav).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;');
    expect(read("app/globals.css")).toContain(".mnav[data-gsap] .np-panel");
  });

  test("the open phone menu holds the page: nothing behind it is reachable or scrolls", () => {
    expect(nav).toContain('setAttribute("inert", "")');
    expect(nav).toContain('classList.add("mnav-lock")');
    expect(read("app/globals.css")).toContain("html.mnav-lock");
  });

  test("the menus stay out of the tab order while hidden", () => {
    expect(nav).toContain("hidden={!npShown}");
    expect(nav).toContain("hidden={!sheetShown}");
  });
});

describe("send buttons that type their own progress (1181)", () => {
  const hook = read("lib/motion/sendText.ts");

  test("the demo's timing: type it in, breathe, then the last word", () => {
    expect(hook).toMatch(/duration: 1, text: \{ value: words\.busy, type: "diff" \}, ease: "sine\.in"/);
    expect(hook).toMatch(/duration: 0\.6, text: \{ value: words\.pulse, type: "diff" \}, ease: "sine\.inOut", repeat: -1, yoyo: true/);
    expect(hook).toContain('const word = phase === "busy" ? words.busy : phase === "done" ? words.done : words.idle;');
    expect(hook).toMatch(/duration: 0\.4, text: \{ value: word, type: "diff" \}, ease: "none"/);
  });

  test("TextPlugin arrives on the first press, not with the page", () => {
    expect(hook).toMatch(/import\("gsap\/TextPlugin"\)/);
    expect(hook).not.toMatch(/^import [^\n]*from "gsap/m);
    const statics = src.filter((f) => /^import [^\n]*from "gsap\/TextPlugin"/m.test(f.text)).map((f) => f.file);
    expect(statics).toEqual([]);
  });

  test("GSAP owns the label from the start, so React never writes over a word being typed", () => {
    expect(hook).toContain("window.matchMedia(MOTION_OK).matches");
    expect(hook).toContain("text: typed ? words.idle : words[phase]");
  });

  test("reduced motion reads the plain word for the phase, swapped at once", () => {
    expect(hook).toContain("if (!typed || phase === said.current) return;");
  });

  test("the plugin is fetched after the page has settled, and a press before it lands still says the right word", () => {
    expect(hook).toContain("whenSettled(() => void loadText())");
    expect(hook).toContain("el.textContent = word;");
  });

  test("the public send buttons use it", () => {
    for (const f of ["components/waitlist/WaitlistForm.tsx", "components/marketing/ContactForm.tsx", "components/maintenance/NotifyForm.tsx"]) {
      const t = read(f);
      expect(t).toContain("useSendText(");
      expect(t).toContain("<span ref={label.ref}>{label.text}</span>");
    }
  });

  test("a form that swaps itself out waits for its own last word, and takes one submit only", () => {
    const wl = read("components/waitlist/WaitlistForm.tsx");
    expect(wl).toContain("if (busy || sent) return;");
    expect(wl).toContain("const SENT_MS = 620;");
    expect(wl).toMatch(/setSent\(true\);[\s\S]{0,200}SENT_MS/);
    const cf = read("components/marketing/ContactForm.tsx");
    expect(cf).toContain("if (busy || sent) return;");
    expect(cf).toMatch(/setSent\(true\);[\s\S]{0,200}setTimeout\(go, 620\)/);
  });
});

describe("the page transition sits above the page (1181)", () => {
  test("the wave is painted into the body", () => {
    const pt = read("components/shared/PageTransition.tsx");
    expect(pt).toContain("createPortal");
    expect(pt).toMatch(/createPortal\([\s\S]{0,500}document\.body,\s*\)/);
  });
});

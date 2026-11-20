import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { SCROLL, aheadLimit, capAhead, clampDelta, controlWheel, wheelDelta } from "@/lib/motion/scroll-control";

/*
 * Round 1262: one controlled smooth scroll. ScrollSmoother is gone (a hard flick moved the native scroll 2000+ px at
 * once); the one Lenis caps each wheel event and how far its target may run ahead of the painted page.
 */
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("clampDelta", () => {
  test("keeps the sign and caps both ways", () => {
    expect(clampDelta(100, 160)).toBe(100);
    expect(clampDelta(900, 160)).toBe(160);
    expect(clampDelta(-900, 160)).toBe(-160);
    expect(clampDelta(-40, 160)).toBe(-40);
  });
  test("NaN and Infinity are safe", () => {
    expect(clampDelta(Number.NaN, 160)).toBe(0);
    expect(clampDelta(Number.POSITIVE_INFINITY, 160)).toBe(0);
    expect(clampDelta(50, Number.NaN)).toBe(0);
  });
});

describe("capAhead", () => {
  test("passes while under the cap, trims at the cap", () => {
    expect(capAhead(100, 0, 480)).toBe(100);
    expect(capAhead(100, 420, 480)).toBe(60);
    expect(capAhead(-100, -420, 480)).toBe(-60);
  });
  test("cap reached in that direction gives 0", () => {
    expect(capAhead(50, 480, 480)).toBe(0);
    expect(capAhead(50, 600, 480)).toBe(0);
    expect(capAhead(-50, -480, 480)).toBe(0);
  });
  test("reversing is never blocked", () => {
    expect(capAhead(-120, 480, 480)).toBe(-120);
    expect(capAhead(120, -480, 480)).toBe(120);
    expect(capAhead(-160, 900, 480)).toBe(-160);
    // Swinging right past zero only trims what lands beyond the cap on the other side.
    expect(capAhead(-1000, 200, 480)).toBe(-680);
  });
  test("NaN safe", () => {
    expect(capAhead(Number.NaN, 0, 480)).toBe(0);
    expect(capAhead(100, Number.NaN, 480)).toBe(100);
  });
});

describe("controlWheel", () => {
  test("the ahead limit follows the viewport between its bounds", () => {
    expect(aheadLimit(800)).toBe(800 * SCROLL.maxAheadVh);
    expect(aheadLimit(1080)).toBeCloseTo(1080 * SCROLL.maxAheadVh);
    expect(aheadLimit(300)).toBe(SCROLL.minAhead);
    expect(aheadLimit(4000)).toBe(SCROLL.maxAhead);
    expect(aheadLimit(Number.NaN)).toBe(SCROLL.minAhead);
  });
  test("a mouse notch passes whole, a flick is clamped then capped", () => {
    expect(controlWheel(100, 0, 800)).toBe(100);
    expect(controlWheel(2400, 0, 800)).toBe(SCROLL.maxWheelDelta);
    expect(controlWheel(2400, aheadLimit(800) - 10, 800)).toBe(10);
    expect(controlWheel(-2400, 0, 800)).toBe(-SCROLL.maxWheelDelta);
  });
  test("a held flick never gets the target further ahead than the limit", () => {
    let ahead = 0;
    for (let i = 0; i < 200; i++) ahead += controlWheel(500, ahead, 1080);
    expect(ahead).toBeCloseTo(aheadLimit(1080));
  });
  test("custom config", () => {
    const cfg = { maxWheelDelta: 50, maxAheadVh: 1, minAhead: 100, maxAhead: 200, hold: 0.5 };
    expect(controlWheel(80, 0, 150, cfg)).toBe(50);
    expect(controlWheel(80, 140, 150, cfg)).toBe(10);
  });
  test("a capped event is handed to Lenis as a tiny step, never 0 (0 would let the browser scroll natively)", () => {
    const cap = aheadLimit(800);
    expect(wheelDelta(120, cap, 800)).toBe(SCROLL.hold);
    expect(wheelDelta(-120, -cap, 800)).toBe(-SCROLL.hold);
    expect(wheelDelta(0, cap, 800)).toBe(0);
    expect(wheelDelta(120, 0, 800)).toBe(120);
  });
  test("tops out near 4 screens a second", () => {
    const peak = (vh: number) => (10 * Math.LN2 * aheadLimit(vh)) / 1;
    expect(peak(800) / 800).toBeLessThan(5);
    expect(peak(1080) / 1080).toBeLessThan(5);
  });
});

describe("one engine, wired once (source)", () => {
  const lenis = read("components/marketing/SmoothScroll.tsx");
  const scenes = read("components/marketing/ScrollScenes.tsx");

  test("virtualScroll shapes wheel events only, with the live target and animated scroll", () => {
    expect(lenis).toContain("virtualScroll: (data) => {");
    expect(lenis).toContain('if (data.event.type.includes("wheel")) data.deltaY = wheelDelta(data.deltaY, l.targetScroll - l.animatedScroll, window.innerHeight);');
    expect(lenis).toContain("return true;");
    expect(lenis).not.toContain("syncTouch");
    for (const o of ["anchors: true", "autoRaf: true", "allowNestedScroll: true"]) expect(lenis).toContain(o);
  });

  test("the instance survives navigation and is re-measured after it", () => {
    expect(lenis).toContain("requestAnimationFrame(() => l.resize())");
    expect(lenis).toMatch(/\}, \[path\]\);/);
    expect((lenis.match(/l\.destroy\(\)/g) ?? []).length).toBe(1);
  });

  test("Radix dialogs pause it, also when one is already open as it lands", () => {
    expect(lenis).toContain('body.hasAttribute("data-scroll-locked") ? l.stop() : l.start()');
    expect(lenis).toMatch(/attributeFilter: \["data-scroll-locked"\] \}\);\n\s*sync\(\);/);
  });

  test("ScrollSmoother is gone from the files, the layout and the CSS", () => {
    expect(existsSync("components/marketing/Smoother.tsx")).toBe(false);
    expect(read("app/(marketing)/layout.tsx")).not.toContain("Smoother");
    expect(read("app/globals.css")).not.toContain("html.smoother");
    expect(read("components/marketing/Nav.tsx")).not.toContain("smooth-wrapper");
  });

  test("ScrollTrigger follows Lenis through exactly one hook, refreshed once Lenis is attached", () => {
    expect((scenes.match(/ScrollTrigger\.update/g) ?? []).length).toBe(1);
    expect(scenes).toContain('unhook = l.on("scroll", ScrollTrigger.update);');
    expect(scenes).toMatch(/whenLenis\(\(l\) => \{[\s\S]{0,200}ScrollTrigger\.refresh\(\)/);
  });
});

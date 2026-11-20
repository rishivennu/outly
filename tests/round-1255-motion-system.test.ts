import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EXIT_RATIO, FADE, FLUID_EASE, PANEL, PILL, PRESS, pillBox, pressScale } from "@/lib/motion/fluid";
import { EASE, GSAP_EASE } from "@/lib/motion/tokens";

// R1255: one fluid motion layer (lib/motion/fluid.ts + useFluid.ts): nav hover pill, shared press, panel open/close.
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = read("app/globals.css");
const hooks = read("lib/motion/useFluid.ts");

describe("R1255 shared easing and timing", () => {
  test("enter rides ease-out, exit rides ease-in, from the 1119 tokens", () => {
    expect([...FLUID_EASE.enter]).toEqual([0.16, 1, 0.3, 1]);
    expect([...FLUID_EASE.exit]).toEqual([0.7, 0, 0.84, 0]);
    expect(FLUID_EASE.enter).toBe(EASE.out);
    expect(FLUID_EASE.gsapEnter).toBe(GSAP_EASE.out);
    expect(FLUID_EASE.gsapExit).toBe(GSAP_EASE.in);
  });

  test("every close is a half to a third of its open", () => {
    expect(EXIT_RATIO).toBeLessThanOrEqual(0.5);
    for (const [name, v] of Object.entries(PANEL)) {
      expect(v.exit, name).toBeLessThan(v.enter);
      expect(v.exit, name).toBeLessThanOrEqual(v.enter / 2 + 0.001);
      expect(v.exit, name).toBeGreaterThanOrEqual(v.enter / 3);
    }
    expect(FADE.exit).toBeLessThan(FADE.enter);
    expect(PILL.exit).toBeLessThan(PILL.enter);
    expect(PRESS.down).toBeLessThan(PRESS.up);
  });

  test("open times sit in the brief's ranges", () => {
    const within = (v: number, lo: number, hi: number) => expect(v >= lo && v <= hi).toBe(true);
    within(PANEL.dropdown.enter, 0.18, 0.28);
    within(PANEL.rise.enter, 0.18, 0.28);
    within(PANEL.popover.enter, 0.15, 0.22);
    within(PANEL.drawer.enter, 0.25, 0.4);
    within(PANEL.sheet.enter, 0.25, 0.4);
    within(PANEL.instant.enter, 0.1, 0.2); // the palette is opened all day: near-instant
    within(PILL.move, 0.18, 0.28);
    within(PRESS.up, 0.18, 0.35);
  });

  test("no variant bounces, scales suddenly, or travels far", () => {
    for (const [name, v] of Object.entries(PANEL)) {
      const f = v.from as { scale?: number; x?: number; y?: number };
      if (f.scale !== undefined) expect(f.scale, name).toBeGreaterThanOrEqual(0.95);
      expect(Math.abs(f.y ?? 0), name).toBeLessThanOrEqual(12);
    }
    expect(PILL.from).toBeGreaterThanOrEqual(0.9);
  });
});

describe("R1255 pure helpers", () => {
  test("press squeezes about 3% and never more, less on wide rows, nothing on big surfaces", () => {
    expect(pressScale(44, 44)).toBeCloseTo(0.97, 5);
    expect(pressScale(400, 64)).toBeCloseTo(0.98, 5);
    expect(pressScale(700, 80)).toBeNull();
    expect(pressScale(0, 0)).toBeNull();
    for (const w of [10, 44, 120, 300, 600]) expect(pressScale(w, 40)!).toBeGreaterThanOrEqual(PRESS.min);
  });

  test("the hover pill sits on its item inside the host, cut to the visible part of a scrolling list", () => {
    const host = { left: 100, top: 50, right: 180, bottom: 850 };
    const item = { left: 118, top: 200, right: 162, bottom: 244 };
    expect(pillBox(item, host)).toEqual({ x: 18, y: 150, w: 44, h: 44 });
    expect(pillBox(item, host, { left: 1, top: 1 })).toEqual({ x: 17, y: 149, w: 44, h: 44 });
    expect(pillBox(item, host, undefined, { left: 100, top: 220, right: 180, bottom: 600 })).toEqual({ x: 18, y: 170, w: 44, h: 24 });
    expect(pillBox(item, host, undefined, { left: 100, top: 300, right: 180, bottom: 600 })).toBeNull();
  });
});

describe("R1255 source rules", () => {
  test("the nav pill is one GSAP-tweened element that flows between rail items", () => {
    const rail = read("components/shell/PulseRail.tsx");
    expect(rail).toContain('useHoverPill(aside, hoverPill, { items: HOVER_ITEMS, clip: ".rail-mid" });');
    expect(rail.match(/className="nav-hover"/g)?.length).toBe(1);
    expect(hooks).toMatch(/export function useHoverPill[\s\S]*loadGsap\(\)[\s\S]*overwrite: "auto"/);
    expect(hooks).toContain("focusin"); // the keyboard moves it too
    expect(css).toMatch(/\.nav-hover \{[^}]*position: absolute;[^}]*border-radius: 9999px;[^}]*pointer-events: none;/);
    expect(css).toContain('.rail[data-hpill] :is(.rail-row, .rail-bell):not([aria-current="page"]');
    // the active row keeps its lime pill (framer layoutId, 1065)
    expect(rail.match(/layoutId="rail-pill"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("one shared press, mounted once by the studio shell, skipping disabled and self-pressing controls", () => {
    expect(read("components/shell/PulseRail.tsx").match(/usePressFx\(\);/g)?.length).toBe(1);
    expect(hooks).toContain(`const OFF = ':disabled, [aria-disabled="true"], [data-disabled]';`);
    expect(hooks).toContain(".btn-lift");
    expect(css).toContain("[data-pressing] { scale: var(--press, 1); }");
    // Button keeps its own press and ripple (one system, not two)
    const button = read("components/ui/button.tsx");
    expect(button).toContain("ripple-host btn-lift");
    expect(button).toContain("active:scale-[0.96]");
  });

  test("every hook has a reduced-motion branch, and CSS backs it", () => {
    for (const fn of ["usePanelPresence", "useHoverPill", "usePressFx"]) {
      const body = hooks.slice(hooks.indexOf(`export function ${fn}`));
      expect(body.slice(0, 1200), fn).toContain("reduced()");
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\), \(forced-colors: active\) \{\s*\.nav-hover \{ display: none; \}\s*\[data-pressing\] \{ scale: none; \}/);
  });

  test("self-mounted panels close with GSAP (interruptible), not CSS keyframes, and go inert at once", () => {
    const bell = read("components/shell/NoticesBell.tsx");
    expect(bell).toContain("usePanelPresence(open, panel,");
    expect(bell).toContain("{shown &&");
    expect(css).not.toMatch(/\.notice-panel \{[^}]*animation: np-in/);
    expect(hooks).toContain("el.inert = true;");
    expect(hooks).toMatch(/usePanelPresence[\s\S]*overwrite: true/);
  });

  test("Radix overlays keep data-state CSS (Presence waits for it) and leave in half their open time", () => {
    expect(css).toContain('.mdrawer[data-state="closed"] { animation: mdrawer-out calc(var(--m-nav) / 2) var(--m-ease-in) forwards; }');
    expect(css).toContain('.acct-menu[data-state="closed"] { animation: acct-out calc(var(--m-menu) / 2) var(--m-ease-in) forwards; }');
    expect(css).toContain(".acct-menu { transform-origin: var(--radix-popover-content-transform-origin);");
    expect(css).toContain('.rail-tip[data-state="closed"] { animation: rail-tip-out .09s var(--m-ease-in) forwards; }');
  });

  test("the palette is near-instant and leaves on the ease-in", () => {
    const pal = read("components/shell/CommandPalette.tsx");
    expect(pal).toContain("PANEL.instant.enter");
    expect(pal).toMatch(/exit=\{\{[^\n]*PANEL\.instant\.exit, ease: ease\("in"\)/);
  });

  test("nothing in the fluid layer animates height:auto or a backdrop filter", () => {
    const fluid = read("lib/motion/fluid.ts") + hooks;
    expect(fluid).not.toMatch(/height:\s*["']auto["']/);
    expect(fluid).not.toMatch(/backdrop/i);
  });
});

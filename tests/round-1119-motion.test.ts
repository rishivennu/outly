import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DUR, EASE, FX, STAGGER, STAGGER_CAP, T, dampingRatio, ease, overshoots, staggerAt, type Bezier } from "@/lib/motion/tokens";

// Round 1119: one motion system (lib/motion/tokens.ts) for framer, GSAP and CSS. Time-based, no overshoot.
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = read("app/globals.css");
const src = (["app", "components", "lib"] as const).flatMap((d) =>
  (readdirSync(d, { recursive: true }) as string[])
    .filter((f) => /\.(tsx?|css)$/.test(f))
    .map((f) => ({ file: join(d, f).replace(/\\/g, "/"), text: read(join(d, f)) })),
);

describe("motion tokens (1119)", () => {
  test("durations sit inside the brief's ranges", () => {
    const within = (v: number, lo: number, hi: number) => expect(v >= lo && v <= hi).toBe(true);
    within(DUR.page, 350, 450);
    within(DUR.section, 500, 700);
    within(DUR.card, 400, 500);
    within(STAGGER, 60, 100);
    within(DUR.press, 150, 200);
    within(DUR.hover, 150, 200);
    within(DUR.menu, 200, 250);
    within(DUR.nav, 250, 350);
    within(DUR.count, 900, 1200);
    within(DUR.chart, 600, 800);
    expect(DUR.menuExit).toBeLessThan(DUR.menu);
  });

  test("the brief's curve is the default, and staggers are capped", () => {
    expect([...EASE.out]).toEqual([0.16, 1, 0.3, 1]);
    expect(ease("out")).toEqual([0.16, 1, 0.3, 1]);
    expect(staggerAt(0)).toBe(0);
    expect(staggerAt(3)).toBe(210);
    expect(staggerAt(400)).toBe(STAGGER_CAP);
    expect(staggerAt(-2)).toBe(0);
  });

  test("no token curve or spring overshoots", () => {
    for (const b of Object.values(EASE)) expect(overshoots(b as Bezier)).toBe(false);
    expect(T.glide.bounce).toBe(0);
    expect(dampingRatio(500, 60)).toBeGreaterThan(1); // kyma's overdamped spring, for reference
    for (const k of ["press", "hover", "menu", "menuExit", "nav", "page", "card", "section", "fill"] as const) expect(T[k].type).toBe("tween");
    expect(FX.dialog.animate.transition).toBe(T.card);
    expect(FX.pop.animate.transition).toBe(T.menu);
  });

  test("the CSS custom properties carry the same numbers", () => {
    const v = (name: string) => css.match(new RegExp(`--m-${name}:\\s*([^;]+);`))?.[1].trim();
    const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    for (const [k, ms] of Object.entries(DUR)) expect(v(kebab(k))).toBe(`${ms}ms`);
    expect(v("stagger")).toBe(`${STAGGER}ms`);
    for (const [k, b] of Object.entries(EASE)) expect(v(`ease-${k}`)).toBe(`cubic-bezier(${b.join(", ")})`);
    expect(css).toContain("--ease-out: var(--m-ease-out)");
    expect(css).toContain("--ease-liquid: var(--m-ease-out)");
  });

  test("tailwind maps its default duration and ease onto the tokens", () => {
    const tw = read("tailwind.config.ts");
    expect(tw).toMatch(/transitionTimingFunction:[\s\S]*DEFAULT: "var\(--m-ease-out\)"/);
    expect(tw).toMatch(/transitionDuration:[\s\S]*DEFAULT: "var\(--m-hover\)"/);
  });
});

describe("nothing bounces (1119)", () => {
  test("no hand-tuned framer springs left: every transition comes from the tokens", () => {
    const bad = src.filter((f) => f.file !== "lib/motion/tokens.ts" && /stiffness\s*:\s*\d/.test(f.text)).map((f) => f.file);
    expect(bad).toEqual([]);
    const bouncy = src.filter((f) => /bounce\s*:\s*0?\.[1-9]/.test(f.text)).map((f) => f.file);
    expect(bouncy).toEqual([]);
  });

  test("no GSAP back/elastic/bounce eases", () => {
    const bad = src.filter((f) => /["'](back|elastic|bounce)\.(in|out|inOut)\b/.test(f.text)).map((f) => f.file);
    expect(bad).toEqual([]);
  });

  test("no cubic-bezier or framer ease array leaves 0..1 on the y axis", () => {
    const bad: string[] = [];
    for (const f of src) {
      for (const m of f.text.matchAll(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g)) {
        if (overshoots([+m[1], +m[2], +m[3], +m[4]])) bad.push(`${f.file}: ${m[0]}`);
      }
      for (const m of f.text.matchAll(/ease:\s*\[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\]/g)) {
        if (overshoots([+m[1], +m[2], +m[3], +m[4]])) bad.push(`${f.file}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("the app's shared roots use the tokens", () => {
    expect(read("components/shared/MotionRoot.tsx")).toContain("T.card");
    expect(read("lib/motion/reveal.ts")).toContain("GSAP_EASE.out");
    expect(read("lib/motion/route.ts")).toContain("GSAP_EASE.out");
    expect(read("lib/motion/numbers.ts")).toContain("DUR.chart");
  });
});

describe("time-based, never scrubbed (1119)", () => {
  const ss = read("components/marketing/ScrollScenes.tsx");
  test("only the decorative parallax still follows the scroll position, anywhere in the app", () => {
    const scrubs = [...ss.matchAll(/scrub:\s*([^,}\s]+)/g)].map((m) => m[1]);
    expect(scrubs).toEqual(["0.6"]);
    const elsewhere = src.filter((f) => f.file !== "components/marketing/ScrollScenes.tsx" && /scrub:\s*[^,}\s]/.test(f.text)).map((f) => f.file);
    expect(elsewhere).toEqual([]);
    expect(ss).toMatch(/\[data-parallax\][\s\S]*scrub: 0\.6/);
  });

  test("hero leave, route line and step line play at the token pace once started", () => {
    expect(ss).toContain('gsap.timeline({ paused: true, defaults: { ease: out, duration: secs("section") } })');
    expect(ss).toContain("onLeaveBack: () => void tl.timeScale(1.4).reverse()");
    expect(ss).toMatch(/\[data-route\] svg[\s\S]*?once: true/);
    expect(ss).toMatch(/how-bar[\s\S]*?once: true/);
  });

  test("landing scenes use the token ease and stay inside the section band", () => {
    expect(ss).not.toContain('"power3.out"');
    expect(ss).toContain("const EASE = GSAP_EASE.out");
    // The pinned-steps fill runs in step units (step n ends at time n; tweenTo sets the real pace), so skip it.
    const lines = ss.split("\n").filter((l) => !l.includes("to(fill,"));
    for (const l of lines) for (const m of l.matchAll(/duration:\s*(\d*\.\d+|\d+)\b/g)) expect(+m[1]).toBeLessThanOrEqual(0.7);
    expect(ss).toContain("t.scrollTrigger?.kill(), t.play()"); // failsafe for the drawn lines
  });

  test("route timings come from the tokens", async () => {
    const { ROUTE_TIMING } = await import("@/lib/motion/route");
    expect(ROUTE_TIMING.page.mask).toBe(DUR.page / 1000);
    expect(ROUTE_TIMING.page.block).toBe(DUR.card / 1000);
  });

  test("the pinned steps jump to each step at a fixed pace instead of following the scroll", () => {
    expect(ss).toContain('tl.tweenTo(n, { duration: secs("section"), ease: out })');
    expect(ss).not.toMatch(/scrub:\s*0\.5/);
  });

  test("media inside a clipped frame settles from a slight zoom after its reveal (kyma), with an opt-out", () => {
    const reveal = read("lib/motion/reveal.ts");
    expect(reveal).toContain("settleMedia(");
    expect(reveal).toContain("data-no-settle");
  });
});

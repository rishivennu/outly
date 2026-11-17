import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import gsap from "gsap";
import { EASE, GSAP_EASE, T, DUR, overshoots, smoothInOut } from "@/lib/motion/tokens";

// Round 1187 (user, 11-17): "get the smooth ease in and out from gsap for tabs". Every tab move, the sidebar pill,
// the segmented pills, the filter-chip plate and the route entrance a tab click plays, rides GSAP's power2.inOut.
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("tabs ease in and out (1187)", () => {
  test("smoothInOut is GSAP's own power2.inOut", () => {
    const g = gsap.parseEase(GSAP_EASE.smooth);
    for (let i = 0; i <= 20; i++) expect(Math.abs(smoothInOut(i / 20) - g(i / 20))).toBeLessThan(1e-9);
    expect(GSAP_EASE.smooth).toBe("power2.inOut");
    expect(GSAP_EASE.fade).toBe("sine.inOut");
  });

  test("it starts and lands gently and is symmetric", () => {
    expect(smoothInOut(0.1)).toBeLessThan(0.01);
    expect(smoothInOut(0.5)).toBeCloseTo(0.5, 9);
    expect(smoothInOut(0.9)).toBeGreaterThan(0.99);
    expect(smoothInOut(0.3) + smoothInOut(0.7)).toBeCloseTo(1, 9);
  });

  test("the CSS curve is the same shape and never overshoots", () => {
    expect([...EASE.smooth]).toEqual([0.65, 0, 0.35, 1]);
    expect(overshoots(EASE.smooth)).toBe(false);
    const css = read("app/globals.css");
    expect(css).toContain("--m-ease-smooth: cubic-bezier(0.65, 0, 0.35, 1);");
    expect(css).toContain(".chip-plate { transition: transform var(--m-page) var(--m-ease-smooth)");
    expect(css).toContain(".pulse-underline, .pulse-seg-pill { transition: transform var(--m-page) var(--m-ease-smooth)");
  });

  test("the layoutId pills glide on it, timed with the page they open", () => {
    expect(T.glide).toEqual({ type: "tween", duration: DUR.page / 1000, ease: smoothInOut });
    expect(read("components/admin/AdminShell.tsx")).toContain("transition={T.glide}");
    // No tab pill is left on the default card tween (an ease-out only).
    const dir = "components/analytics";
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const bare = read(join(dir, f)).match(/<motion\.span layoutId="[^"]+"[^>]*\/>/g)?.filter((m) => !m.includes("transition=")) ?? [];
      expect({ f, bare }).toEqual({ f, bare: [] });
    }
  });

  test("route entrances ask GSAP for the in-out curves and nothing snaps", () => {
    const r = read("lib/motion/route.ts");
    expect(r).toContain("const EASE = GSAP_EASE.smooth;");
    expect(r).toContain("const FADE = GSAP_EASE.fade;");
    expect(r).not.toMatch(/"power3\.out"|"power1\.out"|"expo\.out"/);
    expect(r).toContain("if (reduced())"); // reduced motion still only fades
  });
});

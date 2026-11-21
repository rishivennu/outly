/**
 * R1293: Magnetic (motion-primitives) on the two desktop Create buttons: a slight, overdamped pull toward a fine
 * pointer, inert under reduced motion, with a window listener only while hovered.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SPRING_MAGNET, dampingRatio } from "@/lib/motion/tokens";
import { MAGNET_INTENSITY, MAGNET_RANGE, pull } from "@/components/ui/motion/Magnetic";

const read = (p: string) => readFileSync(p, "utf8");
const mag = read("components/ui/motion/Magnetic.tsx");
const dock = read("components/ui/motion/Dock.tsx");
const studio = read("components/shell/StudioDock.tsx");
const rail = read("components/shell/PulseRail.tsx");

describe("R1293 Magnetic source rules", () => {
  test("the spring is the SPRING_MAGNET token, never a literal", () => {
    expect(mag).toContain('import { SPRING_MAGNET } from "@/lib/motion/tokens";');
    expect(mag).toContain("useSpring(0, SPRING_MAGNET)");
    expect(mag).not.toMatch(/stiffness\s*:/);
  });
  test("fine pointers only, and inert under reduced motion", () => {
    expect(mag).toContain('"(hover: hover) and (pointer: fine)"');
    expect(mag).toContain("useReducedMotion()");
    expect(mag).toContain("const inert = off || still || !fine;");
    expect(mag).toContain("const handlers: Handlers = inert\n    ? {}");
  });
  test("pointermove on window is added on pointerenter and removed on pointerleave", () => {
    expect(mag).toContain("onPointerEnter: () => {");
    expect(mag).toContain("onPointerLeave: stop,");
    expect(mag).toContain('window.addEventListener("pointermove", move.current, { passive: true });');
    expect(mag).toContain('window.removeEventListener("pointermove", move.current);');
    expect(mag).not.toContain("document.addEventListener");
    expect(mag).toContain("e.clientX - (r.left + r.width / 2)");
  });
});

describe("R1293 tuning", () => {
  test("SPRING_MAGNET is overdamped", () => {
    expect(SPRING_MAGNET).toEqual({ mass: 0.2, stiffness: 180, damping: 20 });
    expect(dampingRatio(SPRING_MAGNET.stiffness, SPRING_MAGNET.damping, SPRING_MAGNET.mass)).toBeGreaterThanOrEqual(1);
  });
  test("defaults stay slight", () => {
    expect(MAGNET_INTENSITY).toBeLessThanOrEqual(0.5);
    expect(MAGNET_RANGE).toBeLessThanOrEqual(100);
    expect((MAGNET_INTENSITY * MAGNET_RANGE) / 4).toBeLessThanOrEqual(8);
  });
});

describe("R1293 pull()", () => {
  test("0 at the centre and at or beyond the range", () => {
    expect(pull(0, 0)).toEqual({ x: 0, y: 0 });
    expect(pull(MAGNET_RANGE, 0)).toEqual({ x: 0, y: 0 });
    expect(pull(80, 80)).toEqual({ x: 0, y: 0 });
    expect(pull(-500, 3)).toEqual({ x: 0, y: 0 });
  });
  test("symmetric and toward the pointer", () => {
    const a = pull(20, -10);
    const b = pull(-20, 10);
    expect(a.x).toBeCloseTo(-b.x, 10);
    expect(a.y).toBeCloseTo(-b.y, 10);
    expect(a.x).toBeGreaterThan(0);
    expect(a.y).toBeLessThan(0);
  });
  test("grows up to range / 2, then eases back, never past intensity * range / 4", () => {
    let prev = 0;
    for (let d = 1; d <= MAGNET_RANGE / 2; d++) {
      const p = Math.abs(pull(d, 0).x);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
    for (let d = MAGNET_RANGE / 2; d < MAGNET_RANGE; d++) {
      expect(Math.abs(pull(d, 0).x)).toBeLessThanOrEqual(prev + 1e-9);
      expect(Math.hypot(pull(d * 0.6, d * 0.8).x, pull(d * 0.6, d * 0.8).y)).toBeLessThanOrEqual((MAGNET_INTENSITY * MAGNET_RANGE) / 4 + 1e-9);
    }
    expect(prev).toBeCloseTo((MAGNET_INTENSITY * MAGNET_RANGE) / 4, 10);
  });
});

describe("R1293 wiring", () => {
  test("DockItem takes `magnetic` and moves its outer box with the magnet", () => {
    expect(dock).toContain("magnetic?: boolean;");
    expect(dock).toContain("const magnet = useMagnet(ref, { off: !magnetic || still });");
    expect(dock).toContain("style={{ width, height: REST, x: magnet.x, y: magnet.y }} {...magnet.handlers}");
  });
  test("only the studio dock's Create is magnetic", () => {
    expect(studio).toContain("magnetic={create}");
    expect(studio.match(/magnetic=/g)?.length).toBe(1);
  });
  test("the rail's New post sits in a Magnetic, with Tip still wrapping the link", () => {
    expect(rail).toContain('import { Magnetic } from "@/components/ui/motion/Magnetic";');
    expect(rail).toMatch(/<Magnetic className="block w-full shrink-0">\s*<Tip label="New post">\s*<HoverLink href="\/create"/);
    expect(rail).toMatch(/<\/HoverLink>\s*<\/Tip>\s*<\/Magnetic>/);
  });
});

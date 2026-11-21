/**
 * R1292: the dock marks the destination you are on with a solid lime fill under a dark icon (no dot), idle icons sit
 * at the one quiet grey, and the fill glides between items on the nav token. The Create button is outlined like the
 * rail's, so only the page you are on is solid lime.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DUR, EASE, T } from "@/lib/motion/tokens";

const read = (p: string) => readFileSync(p, "utf8");
const dock = read("components/ui/motion/Dock.tsx");
const studio = read("components/shell/StudioDock.tsx");

describe("R1292 DockItem active fill", () => {
  test("the dot is gone", () => {
    expect(dock).not.toContain("dock-dot");
    expect(dock).not.toContain("-bottom-1.5");
  });
  test("a solid lime fill (.nav-fill) sits under the icon of the active item and glides on T.nav", () => {
    expect(dock).toContain('{active && <motion.span layoutId={still ? undefined : fillId} transition={T.nav} aria-hidden="true" className="dock-fill nav-fill absolute inset-0 rounded-[16px]" />}');
    // the icon is stacked above the fill
    expect(dock).toContain('className="dock-ic relative grid place-items-center');
  });
  test("one layout id per dock, from the context", () => {
    expect(dock).toContain("const fillId = useId();");
    expect(dock).toContain("still, fillId }}>");
    expect(dock).toMatch(/type Ctx = \{[^}]*fillId: string \}/);
  });
  test("active ink is dark, idle is the quiet grey, colours swap on the nav timing", () => {
    expect(dock).toContain('"dock-btn relative grid h-full w-full place-items-center rounded-[16px] text-foreground/60 outline-none transition-colors duration-nav ease-out motion-reduce:transition-none hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"');
    expect(dock).toContain('active && "text-lime-foreground hover:bg-transparent hover:text-lime-foreground"');
    expect(dock).not.toContain("text-foreground/80");
  });
  test("a badge on the active item inverts so it stays readable on lime", () => {
    expect(dock).toContain('active ? "bg-lime-foreground text-lime ring-lime" : "bg-lime text-lime-foreground ring-[hsl(var(--glass-solid))]"');
  });
  test("T.nav is a 300ms ease-out tween (the brief's 250-350ms)", () => {
    expect(T.nav).toEqual({ type: "tween", duration: DUR.nav / 1000, ease: EASE.out });
    expect(DUR.nav).toBeGreaterThanOrEqual(250);
    expect(DUR.nav).toBeLessThanOrEqual(350);
  });
});

describe("R1292 StudioDock", () => {
  test("Create is outlined (.dock-new), not a second solid lime square", () => {
    expect(studio).toContain('className={create ? "dock-new" : undefined}');
    expect(studio).not.toContain("bg-lime text-lime-foreground hover:bg-lime");
  });
  test("every destination still reports active from the route", () => {
    expect((studio.match(/active=\{isActive\(path, href\)\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

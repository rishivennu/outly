/**
 * R1293: motion-primitives' TransitionPanel, rebuilt on the tokens, drives the admin dock popover: one panel stays up
 * while you move between groups, its content slides in from the side you came from, and the panel glides under the
 * new icon instead of popping down and up again.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { panelDir, panelVariants, PANEL_TRAVEL } from "@/components/ui/motion/TransitionPanel";
import { DUR, EASE } from "@/lib/motion/tokens";

const read = (p: string) => readFileSync(p, "utf8");
const panel = read("components/ui/motion/TransitionPanel.tsx");
const dock = read("components/admin/AdminDock.tsx");

describe("R1293 TransitionPanel", () => {
  test("popLayout presence, no animation on first paint, direction through `custom`", () => {
    expect(panel).toContain('<AnimatePresence initial={false} mode="popLayout" custom={dir}>');
    expect(panel).toContain('<motion.div key={activeIndex} custom={dir} variants={still ? fadeVariants : (variants ?? panelVariants)} initial="enter" animate="center" exit="exit"');
    expect(panel).toContain("{children[activeIndex]}");
  });
  test("curves from the tokens only: arrival T.nav, exit T.menuExit, reduced motion fades", () => {
    expect(panel).toContain("transition: T.nav");
    expect(panel).toContain("transition: T.menuExit");
    expect(panel).toContain("transition: T.fade");
    expect(panel).toContain("useReducedMotion()");
    expect(panel).not.toMatch(/stiffness|bounce|type: "spring"/);
  });
  test("variants travel a short way, forward from the right and back from the left, exit shorter than entry", () => {
    expect(PANEL_TRAVEL).toBeLessThanOrEqual(24);
    expect(panelVariants.enter(1)).toEqual({ opacity: 0, x: PANEL_TRAVEL });
    expect(panelVariants.enter(-1)).toEqual({ opacity: 0, x: -PANEL_TRAVEL });
    const out = panelVariants.exit(1) as { x: number; transition: { duration: number; ease: unknown } };
    expect(Math.abs(out.x)).toBeLessThan(PANEL_TRAVEL);
    expect(out.x).toBeLessThan(0);
    expect(out.transition.duration).toBe(DUR.menuExit / 1000);
    expect((panelVariants.center as { transition: { duration: number; ease: unknown } }).transition).toEqual({ type: "tween", duration: DUR.nav / 1000, ease: EASE.out });
  });
  test("panelDir: lower index means back", () => {
    expect(panelDir(0, 2)).toBe(1);
    expect(panelDir(2, 0)).toBe(-1);
    expect(panelDir(1, 1)).toBe(1);
  });
});

describe("R1293 AdminDock popover", () => {
  test("one persistent popover that glides (layout position on T.nav) instead of a remount per group", () => {
    expect(dock).toContain('key="menu"');
    expect(dock).not.toContain("key={menu.key}");
    expect(dock).toContain('layout="position"');
    expect(dock).toContain("transition={T.nav}");
    expect(dock).toContain("{...(reduce ? FX.fade : RISE)}");
  });
  test("content rides a TransitionPanel keyed on the group index, direction from the last group", () => {
    expect(dock).toContain('import { TransitionPanel, panelDir, type PanelDir } from "@/components/ui/motion/TransitionPanel";');
    expect(dock).toContain("const keys = [...list.map((g) => g.group), ACCOUNT];");
    expect(dock).toContain("const idx = menu ? keys.indexOf(menu.key) : -1;");
    expect(dock).toContain("panelDir(lastIdx.current, idx)");
    expect(dock).toContain('<TransitionPanel activeIndex={idx} dir={dir} panelClassName="flex flex-col gap-0.5">');
  });
  test("menu semantics kept: role=menu with its label, keyboard handler, the panel ref for focus", () => {
    expect(dock).toContain('role="menu"');
    expect(dock).toContain("aria-label={title}");
    expect(dock).toContain("onKeyDown={onMenuKey}");
    expect(dock).toContain("ref={panel}");
    expect(dock).toContain('id="admin-dock-menu"');
  });
});

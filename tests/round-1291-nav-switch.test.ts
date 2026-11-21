/** R1291 A: the quick dock-style switcher in the rail and the dock, and Settings on the shared NavStyleProvider. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const sw = read("components/shell/NavStyleSwitch.tsx");
const rail = read("components/shell/PulseRail.tsx");
const dock = read("components/shell/StudioDock.tsx");
const pref = read("components/settings/NavStylePref.tsx");
const view = read("components/settings/SettingsView.tsx");
const page = read("app/(studio)/settings/page.tsx");

describe("R1291 NavStyleSwitch", () => {
  test("client component on the shared state", () => {
    expect(sw.startsWith('"use client";')).toBe(true);
    expect(sw).toContain('export function NavStyleSwitch({ variant, wrap }: { variant: "rail" | "dock";');
    expect(sw).toContain("useNavStyle()");
    expect(sw).toContain('from "./NavStyleProvider"');
  });
  test("renders nothing when the admin set it for everyone", () => {
    expect(sw).toContain("if (!canSwitch) return null;");
  });
  test("rail trigger: a rail-row with the sliders icon and the label", () => {
    expect(sw).toContain('aria-label="Change dock style"');
    expect(sw).toContain('className="rail-row"');
    expect(sw).toContain('<span className="rail-ic">');
    expect(sw).toContain('<SlidersHorizontal size={20} strokeWidth={1.8} aria-hidden="true" />');
    expect(sw).toContain('<span className="rail-label">Dock style</span>');
    expect(sw).toContain('"aria-haspopup": "dialog" as const, "aria-expanded": open');
  });
  test("dock trigger: a DockItem measured through a display:contents wrapper", () => {
    expect(sw).toContain('<DockItem label="Change dock style" onClick={toggle} attrs={aria}>');
    expect(sw).toContain('<span ref={slot} className="contents">');
    expect(sw).toContain('slot.current?.querySelector("button")');
  });
  test("popover: portal dialog on strong glass, side of the rail or above the dock", () => {
    expect(sw).toContain("createPortal(");
    expect(sw).toContain('role="dialog" aria-label="Dock style"');
    expect(sw).toContain("glass-strong fixed z-[70] w-[300px] rounded-[20px] p-2 shadow-2xl");
    expect(sw).toContain('usePanelPresence(open, panel, PANEL.rise, variant === "rail" ? "0% 100%" : "50% 100%")');
    expect(sw).toContain("left: Math.min(r.right + 12, window.innerWidth - w - 12), bottom: Math.max(12, window.innerHeight - r.bottom)");
    expect(sw).toContain("bottom: window.innerHeight - top + 12");
  });
  test("closes on Escape, outside pointerdown and route change; focus goes back", () => {
    expect(sw).toContain('e.key === "Escape" && close(true)');
    expect(sw).toContain('document.addEventListener("pointerdown", onDown)');
    expect(sw).toContain("useEffect(() => setOpen(false), [path]);");
    expect(sw).toContain("if (back) trigger()?.focus();");
  });
  test("radiogroup with roving tabIndex and arrow keys", () => {
    expect(sw).toContain('role="radiogroup" aria-label="Dock style"');
    expect(sw).toContain('role="radio"');
    expect(sw).toContain("aria-checked={on}");
    expect(sw).toContain("tabIndex={on ? 0 : -1}");
    expect(sw).toContain('e.key === "ArrowDown"');
    expect(sw).toContain("NAV_TILES.map(");
  });
  test("selected row is SOLID bg-secondary with a lime ring and a check; others transparent with a hover tint", () => {
    expect(sw).toContain('on ? "bg-secondary ring-1 ring-lime/60" : "hover:bg-foreground/[0.06]"');
    expect(sw).not.toMatch(/on \? "bg-secondary\//);
    expect(sw).toContain('{on && <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />}');
    expect(sw).toContain("flex h-[72px] w-full items-center gap-3 rounded-2xl px-2.5 text-left");
    expect(sw).toContain("<NavPreview id={t.id} compact />");
  });
  test("picks through set(…, \"switcher\"), lingers, toasts errors, tracks the open", () => {
    expect(sw).toContain('await set(next, "switcher");');
    expect(sw).toContain("const SETTLE_MS = 220;");
    expect(sw).toContain("if (next === style) return close(true);");
    expect(sw).toContain('toast(e instanceof ApiError ? e.message');
    expect(sw).toContain('track("nav_switcher_opened", { style })');
  });
  test("links to the Settings card, which carries the id", () => {
    expect(sw).toContain('href="/settings?tab=personalization#navigation"');
    expect(sw).toContain("More in Settings");
    expect(pref).toContain('<section id="navigation"');
  });
  test("design rules: no spring literals, no emoji, 44px link target", () => {
    for (const s of [sw, pref]) {
      expect(s).not.toContain("stiffness:");
      expect(s).not.toMatch(/bounce:/);
      expect(s).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(s).not.toContain("—");
    }
    expect(sw).toContain("inline-flex h-11 items-center");
  });
});

describe("R1291 mounts", () => {
  test("rail: first in rail-bottom, before the theme, in the rail's tooltip", () => {
    const i = rail.indexOf('<div className="rail-bottom">');
    const s = rail.indexOf('<NavStyleSwitch variant="rail"', i);
    expect(i).toBeGreaterThan(0);
    expect(s).toBeGreaterThan(i);
    expect(s).toBeLessThan(rail.indexOf("<RailTheme />", i));
    expect(rail).toContain('wrap={(b) => <Tip label="Change dock style">{b}</Tip>}');
  });
  test("dock: after the second separator, right before Search", () => {
    const s = dock.indexOf('<NavStyleSwitch variant="dock" />');
    const search = dock.indexOf('<DockItem label="Search"');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(search);
    expect(dock.slice(dock.lastIndexOf("<DockSeparator />", s), s)).toMatch(/^<DockSeparator \/>\s*$/);
  });
  test("phones untouched: no switcher in the tab bar or More sheet", () => {
    expect(read("components/shell/MobileDrawer.tsx")).not.toContain("NavStyleSwitch");
  });
});

describe("R1291 Settings on the shared state", () => {
  test("NavStylePref uses useNavStyle, saves with source settings, no router refresh or local copy", () => {
    expect(pref).toContain("useNavStyle()");
    expect(pref).toContain('set(s, "settings")');
    expect(pref).not.toContain("router.refresh()");
    expect(pref).not.toContain("useRouter");
    expect(pref).not.toContain("useState");
    expect(pref).not.toContain('"/api/me/nav"');
    expect(pref).toContain("export function NavStylePref() {");
  });
  test("selected tile is solid bg-secondary; the lock note stays", () => {
    expect(pref).toContain('on ? "bg-secondary ring-1 ring-inset ring-lime/50"');
    expect(pref).toContain("{!canSwitch && <p");
    expect(pref).toContain("Your workspace admin has set the navigation for everyone.");
  });
  test("NavPreview gains a compact 88x56 size, default unchanged", () => {
    expect(pref).toContain("export function NavPreview({ id, compact = false }: { id: NavStyle; compact?: boolean })");
    expect(pref).toContain("h-14 w-[88px]");
    expect(pref).toContain('"h-24 gap-2 rounded-2xl p-2.5"');
  });
  test("SettingsView and the page no longer pass the nav props", () => {
    expect(view).toContain("<NavStylePref />");
    expect(view).not.toContain("navCanSwitch");
    expect(page).not.toContain("navFor");
    expect(page).not.toContain("navOwn");
  });
});

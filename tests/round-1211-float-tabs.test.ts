/**
 * R1211 (11-19): the phone tab bar floats as a pill and compacts, Instagram style, as you read on; a failed sign-in
 * shakes the field that is wrong, not the whole card (the recording showed the page itself shaking).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAB_SCROLL_START, tabScrollStep, type TabScroll } from "../lib/client/tab-bar";
import { SHAKE_X, shakeTargets } from "../lib/client/shake";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");
const nav = src("components/shell/Nav.tsx");
const rule = (sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  expect(i).toBeGreaterThan(0);
  return css.slice(i, css.indexOf("}", i));
};

// A long page: 3000px tall in a 800px viewport, so end = 2200.
const END = 2200;
const VP = 800;
const step = (s: TabScroll, y: number, hold?: { still?: boolean; typing?: boolean }) => tabScrollStep(s, y, END, VP, hold);
const scrollTo = (from: TabScroll, ys: number[], hold?: { still?: boolean; typing?: boolean }) => ys.reduce((s, y) => step(s, y, hold), from);

describe("R1211 compact rule (tabScrollStep)", () => {
  test("starts open and stays open near the top", () => {
    expect(TAB_SCROLL_START.compact).toBe(false);
    expect(scrollTo(TAB_SCROLL_START, [10, 40, 79]).compact).toBe(false);
  });
  test("reading on (scrolling down) more than 48px in one run compacts; small moves do not", () => {
    const at: TabScroll = { y: 100, run: 0, compact: false };
    expect(step(at, 140).compact).toBe(false); // 40px: not yet
    expect(step(at, 149).compact).toBe(true); // 49px: compact
    expect(scrollTo(at, [120, 140, 160]).compact).toBe(true); // three strokes add up
  });
  test("12px back up opens it; jitter of a few px does not flip either way", () => {
    const folded = scrollTo(TAB_SCROLL_START, [100, 200]);
    expect(folded.compact).toBe(true);
    expect(step(folded, 195).compact).toBe(true); // 5px of jitter
    expect(step(folded, 187).compact).toBe(false); // 13px back
    // a flip of direction restarts the run: 5 down after 5 up is not a 10px run
    const open = step(folded, 187);
    expect(scrollTo(open, [192, 187, 192, 187]).compact).toBe(false);
  });
  test("the same state coming back is the same state (no re-render, no animation while the direction holds)", () => {
    const folded = scrollTo(TAB_SCROLL_START, [100, 200]);
    const more = scrollTo(folded, [240, 280, 320]);
    expect(more.compact).toBe(true);
    expect(more.run).toBe(folded.run + 120);
  });
  test("the top of the page, the end, a short page and reduced motion always open it", () => {
    const folded = scrollTo(TAB_SCROLL_START, [100, 200]);
    expect(step(folded, 60).compact).toBe(false);
    expect(step(folded, END - 40).compact).toBe(false);
    expect(tabScrollStep(folded, 400, 500, 800).compact).toBe(false); // end 500 < 600 (three quarters of the viewport)
    expect(step(folded, 400, { still: true }).compact).toBe(false);
    expect(step(folded, 400, { still: true }).run).toBe(0);
  });
  test("typing holds the state: the page moving under the keyboard counts for nothing", () => {
    const folded = scrollTo(TAB_SCROLL_START, [100, 200]);
    expect(step(folded, 150, { typing: true }).compact).toBe(true);
    const open: TabScroll = { y: 100, run: 0, compact: false };
    expect(step(open, 400, { typing: true }).compact).toBe(false);
    expect(step(open, 400, { typing: true }).run).toBe(0);
  });
});

describe("R1211 floating pill", () => {
  test("the bar is a centred pill, 12px off the bottom and the sides, never wider than 440px, glass (R1213), rimmed, shadowed", () => {
    const r = rule(".mtab");
    expect(r).toContain("bottom: calc(var(--sa-b) + 12px);");
    expect(r).toContain("width: min(calc(100% - 2 * max(12px, var(--sa-l), var(--sa-r))), 440px);");
    expect(r).toContain("margin-inline: auto;");
    expect(r).toContain("border-radius: 9999px;");
    expect(r).toContain("border: 1px solid hsl(var(--mtab-line));");
    // R1213: liquid glass in place of the solid pill of 11-19 (tests/round-1213-liquid-tabs.test.ts has the recipe)
    expect(r).toContain("var(--mtab-shadow);");
    expect(r).toContain("background: linear-gradient(180deg, hsl(var(--mtab-bg) / .72), hsl(var(--mtab-bg) / .62));");
    expect(r).toContain("backdrop-filter: blur(22px) saturate(1.65);");
    expect(css).toMatch(/html\.dark \.mtab \{\r?\n  --mtab-bg: 240 5% 11%; --mtab-line: 0 0% 100% \/ \.1;/);
  });
  test("compact: 92% about the bottom centre, 56px, 300ms on the liquid curve, no layout move", () => {
    const r = rule(".mtab");
    expect(r).toContain("transform-origin: 50% 100%;");
    expect(r).toContain("transition: transform .3s var(--ease-liquid), height .3s var(--ease-liquid);");
    expect(css).toContain(".mtab[data-compact] { height: 56px; padding: 3px 10px; transform: scale(.92); --mtab-px: 10px; }");
    // the liquid curve is the one asked for
    expect(css).toMatch(/--m-ease-out: cubic-bezier\(0\.16, ?1, ?0\.3, ?1\)/);
    expect(css).toContain(":root { --ease-liquid: var(--m-ease-out); }");
    // reduced motion: no transition (and the hook never compacts)
    expect(css).toContain(".mtab, .mtab-item, .mtab-pill, .mtab-pill > svg, .mtab-ind, .mtab-ind::before, .mtab-ripple { transition: none; }");
    expect(nav).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
  });
  test("on a phone on its side the pill is 54px, 8px off the edge, and compact only drops to 50px", () => {
    expect(css).toContain(".mtab { height: 54px; padding: 2px 6px; bottom: calc(var(--sa-b) + 8px); }");
    expect(css).toContain(".mtab[data-compact] { height: 50px; transform: none; }");
    expect(css).toContain(".mmain { padding-bottom: calc(var(--sa-b) + 76px); }");
  });
  test("Nav.tsx: one rAF per scroll burst, cleanup, data-compact on the bar and the html, never hidden", () => {
    const hook = nav.slice(nav.indexOf("function useCompactOnScroll"), nav.indexOf("export function MobileNav"));
    expect(hook).toContain("if (!raf) raf = requestAnimationFrame(check);");
    expect(hook).toContain("s.current = tabScrollStep(s.current, window.scrollY, end, window.innerHeight, { still: still.matches, typing: typing() });");
    expect(hook).toContain("setCompact(s.current.compact);");
    expect(hook).toContain('window.removeEventListener("scroll", onScroll);');
    expect(hook).toContain("grew.disconnect();");
    expect(hook).toContain("cancelAnimationFrame(raf);");
    const tabs = nav.slice(nav.indexOf("export function MobileNav"), nav.indexOf("export function MobileTopBar"));
    expect(tabs).toContain('data-compact={compact ? "" : undefined}');
    expect(tabs).toContain('toggleAttribute("data-tabs-compact", compact)');
    expect(tabs).not.toContain("inert");
    expect(tabs).not.toContain("data-hidden");
    // the same five tabs, same routes, labels and icons as before
    expect(nav).toContain('const TABS = ["/home", "/create", "/calendar", "/inbox", "/analytics"];');
    expect(tabs).toContain("tabs.map(({ href, label, icon: Icon })");
    expect(tabs).toContain('aria-current={active ? "page" : undefined}');
    // icons only (the creator's call, 11-19), each tab still named for assistive tech
    expect(tabs).toContain('<span className="sr-only">{label}</span>');
    expect(tabs).not.toContain("mtab-label");
    expect(tabs).toContain('<Icon className="relative h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />');
  });
  test("what floats above the bar moved up with it (84px), Pip follows the compact flag, and nothing keeps the old names", () => {
    for (const f of ["components/create/ActionBar.tsx", "components/support/ChatWidget.tsx", "components/shared/Toast.tsx", "components/shared/DeviceHint.tsx", "components/shared/CookieConsent.tsx"]) {
      expect(src(f)).toContain("var(--sa-float)");
      expect(src(f)).not.toContain("+74px");
    }
    expect(css).toContain("html[data-tabs-compact] .pc-dock:not([data-open]) {");
    for (const f of ["components/shell/Nav.tsx", "components/shell/NoticesBell.tsx", "components/create/ActionBar.tsx", "app/globals.css"]) {
      expect(src(f)).not.toContain("data-tabs-tucked");
      expect(src(f)).not.toContain("data-hidden");
    }
    expect(src("components/shell/NoticesBell.tsx")).toContain("const floor = tabs && tabs.height > 0 ? tabs.top - 8 : window.innerHeight - 12;");
  });
});

/* A few DOM-shaped objects stand in for the form, so the rule runs without a browser. */
type Fake = { attrs: Record<string, string>; parent?: Fake; cls?: string[] };
const el = (attrs: Record<string, string> = {}, parent?: Fake, cls: string[] = []): Fake => ({ attrs, parent, cls });
const dom = (...els: Fake[]) => {
  const node = (f: Fake): HTMLElement =>
    ({ parentElement: f.parent ? node(f.parent) : null, classList: { contains: (c: string) => !!f.cls?.includes(c) }, _f: f }) as unknown as HTMLElement;
  const cache = new Map<Fake, HTMLElement>();
  const get = (f: Fake) => cache.get(f) ?? (cache.set(f, node(f)), cache.get(f)!);
  const root = {
    querySelectorAll: (sel: string) => {
      const m = /\[(\S+)="(\S+)"\]/.exec(sel)!;
      return els.filter((f) => f.attrs[m[1]] === m[2]).map(get) as unknown as NodeListOf<HTMLElement>;
    },
  } as unknown as ParentNode;
  return { root, get };
};

describe("R1211 the shake moves what is wrong, not the card", () => {
  test("the focused invalid field alone", () => {
    const email = el({ "aria-invalid": "true" });
    const pw = el({ "aria-invalid": "true" });
    const alert = el({ role: "alert" });
    const { root, get } = dom(email, pw, alert);
    expect(shakeTargets(root, get(pw))).toEqual([get(pw)]);
  });
  test("every invalid field when none has focus (the code boxes move as one); the message when none is invalid", () => {
    const boxes = [el({ "aria-invalid": "true" }), el({ "aria-invalid": "true" }), el({ "aria-invalid": "true" })];
    const alert = el({ role: "alert" });
    const d = dom(...boxes, alert);
    expect(d.root && shakeTargets(d.root, null)).toHaveLength(3);
    const d2 = dom(alert);
    expect(shakeTargets(d2.root, null)).toEqual([d2.get(alert)]);
    expect(shakeTargets(dom().root, null)).toEqual([]);
  });
  test("a field in a .relative box (the password with its eye button) moves with its box", () => {
    const box = el({}, undefined, ["relative"]);
    const pw = el({ "aria-invalid": "true" }, box);
    const { root, get } = dom(pw);
    const [t] = shakeTargets(root, get(pw));
    expect((t as unknown as { _f: Fake })._f).toBe(box);
  });
  test("AuthForm and the admin LoginForm shake those parts, one frame after the focus lands, never the root", () => {
    for (const f of ["components/auth/AuthForm.tsx", "components/admin/LoginForm.tsx"]) {
      const s = src(f);
      expect(s).toContain("const parts = shakeTargets(ref.current, document.activeElement);");
      expect(s).toContain("if (parts.length) gsap.fromTo(parts, { x: 0 }, { keyframes: { x: SHAKE_X }, duration: 0.4");
      expect(s).not.toContain("gsap.fromTo(ref.current, { x: 0 }");
      expect(s).toContain("if (!ref.current || !window.matchMedia(MOTION_OK).matches) return;");
    }
    expect(SHAKE_X[SHAKE_X.length - 1]).toBe(0);
    expect(Math.max(...SHAKE_X.map(Math.abs))).toBeLessThan(9);
  });
});

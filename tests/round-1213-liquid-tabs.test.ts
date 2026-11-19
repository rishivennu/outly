/**
 * R1213: the phone tab bar is liquid glass and follows the finger. The pill blurs what scrolls under it, one lime
 * marker slides between tabs (--i), a finger can hold and drag it across the bar to change page, and every effect
 * falls back to the solid pill of 11-19 where glass cannot or should not show.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { slideIndex, slideLock, slideStretch, slideTarget } from "@/lib/client/tab-bar";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");
const nav = src("components/shell/Nav.tsx");
const rule = (sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  expect(i).toBeGreaterThan(0);
  return css.slice(i, css.indexOf("}", i));
};
const mobile = nav.slice(nav.indexOf("export function MobileNav()"), nav.indexOf("export function MobileTopBar()"));
const slide = nav.slice(nav.indexOf("function useSlideTabs("), nav.indexOf("export function MobileNav()"));

describe("R1213 slide maths (lib/client/tab-bar.ts)", () => {
  test("slideIndex maps a finger x to a fractional tab index, clamped to the bar", () => {
    // five tabs over a 350px bar starting at x=20: tab centres every 70px from 55
    expect(slideIndex(55, 20, 350, 5)).toBe(0);
    expect(slideIndex(125, 20, 350, 5)).toBe(1);
    expect(slideIndex(90, 20, 350, 5)).toBeCloseTo(0.5, 5);
    expect(slideIndex(-500, 20, 350, 5)).toBe(0);
    expect(slideIndex(5000, 20, 350, 5)).toBe(4);
    expect(slideIndex(100, 0, 0, 5)).toBe(0);
    expect(slideIndex(100, 0, 300, 1)).toBe(0);
  });
  test("slideLock waits 10px, then locks to the dominant axis once", () => {
    expect(slideLock(4, 6)).toBeNull();
    expect(slideLock(9, -9)).toBeNull();
    expect(slideLock(14, 3)).toBe("h");
    expect(slideLock(-14, 3)).toBe("h");
    expect(slideLock(3, 14)).toBe("v");
    expect(slideLock(12, -20)).toBe("v");
    expect(slideLock(30, 2, 40)).toBeNull();
  });
  test("slideTarget lands on the nearest tab, or one step on for a quick flick that stayed on its own tab", () => {
    expect(slideTarget(2.3, 0, 160, 5)).toBe(2);
    expect(slideTarget(2.6, 0, 180, 5)).toBe(3);
    expect(slideTarget(1.1, 1, 30, 5)).toBe(2); // flick right, never left tab 1
    expect(slideTarget(0.9, 1, -30, 5)).toBe(0); // flick left
    expect(slideTarget(1.1, 1, 10, 5)).toBe(1); // too short for a flick
    expect(slideTarget(1.1, 1, 30, 5, 24, 0.05)).toBe(1); // a slow drift that stayed put stays put
    expect(slideTarget(1.1, 1, 30, 5, 24, 0.6)).toBe(2); // a real flick, still moving on release
    expect(slideTarget(1.1, 1, 30, 5, 24, 0.25)).toBe(2); // 0.2px/ms is the floor
    expect(slideTarget(4.2, 4, 60, 5)).toBe(4); // nothing past the last tab
    expect(slideTarget(0, 0, -60, 5)).toBe(0);
  });
  test("slideStretch lengthens the pill with finger speed, up to 35%, never shorter than 1", () => {
    expect(slideStretch(0)).toBe(1);
    expect(slideStretch(0.4)).toBeCloseTo(1.1, 5);
    expect(slideStretch(-0.4)).toBeCloseTo(1.1, 5);
    expect(slideStretch(9)).toBe(1.35);
    expect(slideStretch(9, 0.2)).toBe(1.2);
  });
});

describe("R1213 glass pill (globals.css)", () => {
  test("blur, saturation lift, a 62 to 72% tint, inner highlights, a masked gradient rim and a sheen", () => {
    const r = rule(".mtab");
    expect(r).toContain("backdrop-filter: blur(22px) saturate(1.65);");
    expect(r).toContain("-webkit-backdrop-filter: blur(22px) saturate(1.65);");
    expect(r).toContain("background: linear-gradient(180deg, hsl(var(--mtab-bg) / .72), hsl(var(--mtab-bg) / .62));");
    expect(r).toContain("isolation: isolate;");
    expect(r).toContain("box-shadow: inset 0 1px 0 hsl(0 0% 100% / .55), inset 0 -1px 0 hsl(0 0% 100% / .16), var(--mtab-shadow);");
    expect(r).toContain("touch-action: pan-y;");
    expect(rule(".mtab::before")).toContain("background: var(--mtab-rim);");
    expect(rule(".mtab::before")).toContain("mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);");
    expect(rule(".mtab::after")).toContain("background: var(--mtab-sheen);");
    expect(css).toMatch(/html\.dark \.mtab \{\n  --mtab-bg: 240 5% 11%; --mtab-line: 0 0% 100% \/ \.1;/);
  });
  test("the solid pill returns without blur support, with less transparency, more contrast or forced colours", () => {
    expect(css).toContain("@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {\n  .mtab { background: hsl(var(--mtab-bg)); }");
    expect(css).toContain("@media (prefers-reduced-transparency: reduce) {\n  .mtab { background: hsl(var(--mtab-bg)); -webkit-backdrop-filter: none; backdrop-filter: none; }\n  .mtab::before, .mtab::after { display: none; }");
    expect(css).toContain('html[data-contrast="more"] .mtab { background: hsl(var(--card)); border-color: hsl(var(--border)); -webkit-backdrop-filter: none; backdrop-filter: none;');
    expect(css).toContain("@media (forced-colors: active) { .mtab { border-color: CanvasText; } .mtab-ind::before { background: Highlight; }");
  });
  test("compact keeps the scale and height move, with the tabs closed up", () => {
    expect(css).toContain(".mtab[data-compact] { height: 56px; padding: 3px 10px; transform: scale(.92); --mtab-px: 10px; }");
    expect(rule(".mtab")).toContain("transition: transform .3s var(--ease-liquid), height .3s var(--ease-liquid);");
    expect(rule(".mtab")).not.toContain("padding .3s"); // the pill track (--mtab-px) steps with the icons, not after them
  });
  test("one marker for the bar: a track one tab wide slid by --i, with a 56 x 32 lime pill that stretches by --sx", () => {
    const ind = rule(".mtab-ind");
    expect(ind).toContain("width: calc((100% - 2 * var(--mtab-px)) / var(--n, 5));");
    expect(ind).toContain("translate: calc(var(--i, 0) * 100%) 0;");
    expect(ind).toContain("transition: translate .35s var(--ease-liquid), opacity .2s var(--ease-liquid);");
    expect(rule(".mtab-ind::before")).toContain("width: 56px; height: 32px;");
    expect(rule(".mtab-ind::before")).toContain("scale: var(--sx, 1) 1;");
    expect(css).toContain(".mtab[data-none]:not([data-drag]) .mtab-ind { opacity: 0; }");
    expect(css).toContain(".mtab[data-drag] .mtab-ind { transition: opacity .2s var(--ease-liquid); }");
    expect(css).not.toContain(".mtab-item .mtab-ind");
    expect(css).not.toContain(".mtab-item[aria-current] .mtab-ind");
  });
  test("ink follows the finger while dragging, and the glow under it blooms on release", () => {
    expect(css).toContain(".mtab[data-drag] .mtab-item[data-over] .mtab-pill > svg { color: hsl(var(--lime-foreground)); }");
    expect(css).toContain(".mtab[data-drag] .mtab-item[aria-current]:not([data-over]) .mtab-pill > svg { color: hsl(var(--foreground) / .72); }");
    expect(rule(".mtab-ripple")).toContain("translate: var(--fx, 50%) 0;");
    expect(css).toContain(".mtab[data-press] .mtab-ripple { opacity: 1; scale: 1; }");
    expect(css).toContain(".mtab[data-drop] .mtab-ripple { animation: mtab-drop .45s var(--ease-liquid) forwards; }");
  });
  test("reduced motion: nothing eases, the pill never stretches, no ripple", () => {
    expect(css).toContain(".mtab, .mtab-item, .mtab-pill, .mtab-pill > svg, .mtab-ind, .mtab-ind::before, .mtab-ripple { transition: none; }");
    expect(css).toContain(".mtab-ind::before { scale: 1 1; }");
    expect(css).toContain(".mtab-ripple { display: none; }");
  });
});

describe("R1213 finger-following nav (components/shell/Nav.tsx)", () => {
  test("the same five tabs, icons and routes as 11-19, now with one marker and one ripple before the links", () => {
    expect(mobile).toContain('className="mtab web-only fixed inset-x-0 z-40 flex items-stretch lg:hidden"');
    expect(mobile).toContain('<span className="mtab-ind" aria-hidden="true" />');
    expect(mobile).toContain('<span className="mtab-ripple" aria-hidden="true" />');
    expect(mobile.indexOf('className="mtab-ind"')).toBeLessThan(mobile.indexOf("{tabs.map("));
    expect(mobile).toContain('style={{ ["--i" as string]: Math.max(0, activeIdx), ["--n" as string]: tabs.length }}');
    expect(mobile).toContain('data-none={activeIdx < 0 ? "" : undefined}');
    expect(mobile).toContain("draggable={false}");
    expect(mobile).toContain('<span className="sr-only">{label}</span>');
    expect(mobile).toContain('<Icon className="relative h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />');
    expect(mobile.match(/className="mtab-ind"/g)?.length).toBe(1);
    expect(nav).toContain('const TABS = ["/home", "/create", "/calendar", "/inbox", "/analytics"]');
  });
  test("pointer events only, no state during the touch: CSS variables and attributes on the nav element", () => {
    expect(slide).toContain("const set = (k: string, v: string) => nav.current?.style.setProperty(k, v);");
    expect(slide).not.toContain("useState");
    expect(slide).toContain("s.lock = slideLock(dx, dy);");
    expect(slide).toContain('el.setAttribute("data-drag", "");');
    expect(slide).toContain("el.setPointerCapture(e.pointerId);");
    expect(slide).toContain('set("--i", fi.toFixed(3));');
    expect(slide).toContain("haptic(5);");
    expect(slide).toContain("const onPointerCancel = () => settle(activeIdx);");
    expect(slide).toContain("if (target !== activeIdx) go(hrefs[target]!);");
    // one navigation per gesture: the click the browser sends after a drag is swallowed, by time (no timer race, and a
    // cancelled or lost gesture never leaves the next tap swallowed)
    expect(slide).toContain("if (!dragEnd.current || e.timeStamp - dragEnd.current > 500) return;\n    dragEnd.current = 0;\n    e.preventDefault();\n    e.stopPropagation();");
    expect(slide).toContain("dragEnd.current = e.timeStamp;");
    expect(slide).not.toContain("dragged");
    // a gesture that never reached pointerup (mouse let go outside the bar) gives way instead of blocking every later press
    expect(slide).toContain("if (g.current) settle(activeIdx);");
    expect(slide).toContain("const onPointerLeave = (e: ReactPointerEvent<HTMLElement>) => {");
    // the finger is measured against the pill's own track (inside border and --mtab-px), re-read when the drag locks
    expect(slide).toContain('(parseFloat(cs.getPropertyValue("--mtab-px")) || 0)) * scale;');
    expect(slide).toContain("Object.assign(s, measure(el));");
    // the pill follows a navigation that lands anywhere, and the stretch relaxes when the finger stops
    expect(slide).toContain('if (!g.current) set("--i", String(Math.max(0, activeIdx)));');
    expect(slide).toContain('timers.current.stretch = setTimeout(() => set("--sx", "1"), 90);');
    expect(slide).toContain("clearTimeout(timers.current.drop);");
    expect(mobile).toContain("useSlideTabs(nav, TABS, activeIdx, (href) => router.push(href))");
    expect(slide).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
  });
  test("the scroll progress frame stays off the studio on a phone (it read as a frame around the app)", () => {
    expect(css).toContain('@media (max-width: 1023px) { body:has(main.mmain) .scroll-frame { display: none; } }');
    expect(css).toContain("@media print { .scroll-frame { display: none; } }"); // still there for everyone else
  });
  test("plain words, no em dashes", () => {
    for (const s of [css.slice(css.indexOf("R1213: liquid glass"), css.indexOf(".install-card {")), slide, mobile]) expect(s).not.toMatch(/\u2014/);
  });
});

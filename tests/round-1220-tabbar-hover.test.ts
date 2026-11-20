/**
 * R1220 (two phone screenshots, 11-19): the lime pill must fill the tab under the finger or pointer, never rest
 * between two icons; a gesture the bar never saw end can't park it; and in the installed app the folded top bar keeps
 * the safe-area strip, so the clock and battery sit on a frosted surface instead of bare scrolling content.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const nav = src("components/shell/Nav.tsx");
const css = src("app/globals.css");

describe("R1220 tab bar pill", () => {
  test("magnetic while dragging: the pill snaps to the nearest tab with a short glide; the glow still tracks the finger", () => {
    expect(nav).toContain('set("--i", String(Math.round(fi)));');
    expect(nav).not.toContain('set("--i", fi.toFixed(3));');
    expect(nav).toContain('set("--fx", fingerX(s, e.clientX));');
    expect(css).toContain(".mtab[data-drag] .mtab-ind { transition: translate .2s var(--ease-liquid), opacity .2s var(--ease-liquid); }");
  });
  test("a lost gesture settles on the current page (window end events, hidden tab), in the bubble phase so the bar's own handler runs first", () => {
    expect(nav).toContain('window.addEventListener("pointerup", end);');
    expect(nav).toContain('window.addEventListener("pointercancel", end);');
    expect(nav).toContain('document.addEventListener("visibilitychange", hide);');
    expect(nav).not.toContain('window.addEventListener("pointerup", end, true);');
    expect(nav).toContain("if (g.current) settle(activeIdx);");
  });
  test("pointer devices: hover moves the pill (and the ink) to the hovered tab; touch screens are excluded", () => {
    const i = css.indexOf("@media (hover: hover) {\n  .mtab:has(.mtab-item:nth-of-type(1):hover) .mtab-ind { translate: 0 0; }");
    expect(i).toBeGreaterThan(0);
    const block = css.slice(i, css.indexOf("}\n", css.indexOf(".mtab-item:hover .mtab-pill > svg", i)) + 2);
    for (let k = 1; k <= 5; k++) expect(block).toContain(`.mtab:has(.mtab-item:nth-of-type(${k}):hover) .mtab-ind { translate: ${k === 1 ? "0" : `${(k - 1) * 100}%`} 0; }`);
    expect(block).toContain(".mtab:has(.mtab-item:hover) .mtab-item[aria-current]:not(:hover) .mtab-pill > svg { color: hsl(var(--foreground) / .72); }");
    expect(block).toContain(".mtab-item:hover .mtab-pill > svg { color: hsl(var(--lime-foreground)); }");
    expect(block).toContain(".mtab[data-none]:has(.mtab-item:hover) .mtab-ind { opacity: 1; }");
    // the old faint grey hover fill is gone: lime is the hover
    expect(css).not.toContain(".mtab-item:not([aria-current]):hover .mtab-pill { background-color: hsl(var(--foreground) / .06); }");
    // the tabs are the only <a> children of the bar, so nth-of-type counts them alone
    expect(nav).toContain('<span className="mtab-ind" aria-hidden="true" />');
    expect(nav).toContain('<span className="mtab-ripple" aria-hidden="true" />');
  });
  test("the folded top bar keeps the safe-area strip in the installed app", () => {
    expect(css).toContain(".mtop[data-folded] { transform: translateY(-100%); pointer-events: none; }");
    expect(css).toContain(".mtop {\n  padding-top: var(--sa-t);");
  });

  test("the bell and the menu button do not touch: an 8px gap between two 44px glass circles (each wears a 1px ring)", () => {
    expect(nav).toContain('<div className="flex items-center gap-2 justify-self-end">');
    expect(nav).toContain('<NoticesBell placement="below" className="mtop-btn gbtn-icon ripple-host" />');
    expect(nav).toContain('<MobileDrawer className="mtop-btn gbtn-icon ripple-host" />');
    expect(css).toContain("width: 44px; height: 44px; flex-shrink: 0; border-radius: 9999px;");
  });
});

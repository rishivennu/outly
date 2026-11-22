// R1305 .mtab Liquid Glass: the web tab bar takes the recipe the Android AppTabBar shipped on 11-22 (GlassStrength.Bar in
// GlassSurface.kt, tabBarGlass in AppTabBar.kt), so the two bars read the same over the same page. A 20px blur with a
// 1.65 saturation lift under a 30 -> 22% white tint (48 -> 38% of the dark surface), a .65 top lip over a .22 bottom lip
// (.16 / .06 dark), a lens edge of three 1px ink rings fading inwards (.07 / .04 / .015; black .18 / .10 / .04 dark), the
// gradient rim of R1213, and a specular arc (an ellipse 40% wide and 40% of the bar tall, at 30% x on the top edge,
// white .30 -> 0 at 70%; .08 dark) over a .24 sheen (.07 dark). The fallbacks of R1213 (no blur support, less
// transparency, more contrast, forced colours) still swap in the solid pill.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const css = read("app/globals.css");
const block = (sel: string) => {
  const i = css.indexOf("\n" + sel + " {\n");
  expect(i).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("\n}", i));
};
const light = block(".mtab");
const dark = block("html.dark .mtab");

describe("R1305 .mtab glass recipe (mirror of the Android AppTabBar)", () => {
  test("fill: a 20px blur, saturate 1.65, the tint read from --mtab-fill-a/b (30 -> 22% light, 48 -> 38% dark)", () => {
    expect(light).toContain("-webkit-backdrop-filter: blur(20px) saturate(1.65);");
    expect(light).toContain("backdrop-filter: blur(20px) saturate(1.65);");
    expect(light).toContain("background: linear-gradient(180deg, hsl(var(--mtab-bg) / var(--mtab-fill-a)), hsl(var(--mtab-bg) / var(--mtab-fill-b)));");
    expect(light).toContain("--mtab-fill-a: .30; --mtab-fill-b: .22;");
    expect(dark).toContain("--mtab-fill-a: .48; --mtab-fill-b: .38;");
    expect(dark).toContain("--mtab-bg: 240 5% 11%;"); // hsl(240 5% 11%) is #1B1B1D, the Android dark glass colour
    expect(css).not.toContain("hsl(var(--mtab-bg) / .72)");
    expect(css).not.toContain("blur(22px) saturate(1.65)");
  });
  test("lips and lens edge: inset highlights top and bottom, then three 1px ink rings fading inwards, then the drop shadow", () => {
    expect(light).toContain("box-shadow: inset 0 1px 0 hsl(0 0% 100% / var(--mtab-lip-t)), inset 0 -1px 0 hsl(0 0% 100% / var(--mtab-lip-b)), var(--mtab-lens), var(--mtab-shadow);");
    expect(light).toContain("--mtab-lip-t: .65; --mtab-lip-b: .22;");
    expect(light).toContain("--mtab-lens: inset 0 0 0 1px rgb(15 20 40 / .07), inset 0 0 0 2px rgb(15 20 40 / .04), inset 0 0 0 3px rgb(15 20 40 / .015);");
    expect(dark).toContain("--mtab-lip-t: .16; --mtab-lip-b: .06;");
    expect(dark).toContain("--mtab-lens: inset 0 0 0 1px rgb(0 0 0 / .18), inset 0 0 0 2px rgb(0 0 0 / .10), inset 0 0 0 3px rgb(0 0 0 / .04);");
    // the dark theme only re-points variables; it no longer carries its own box-shadow
    expect(css).not.toContain("html.dark .mtab { box-shadow:");
  });
  test("specular arc over the sheen: an ellipse at 30% x on the top edge, 40% of the width and 40% of the bar tall (80% of the half-height ::after)", () => {
    expect(light).toContain("--mtab-sheen: radial-gradient(40% 80% at 30% 0%, hsl(0 0% 100% / .30), hsl(0 0% 100% / 0) 70%), linear-gradient(180deg, hsl(0 0% 100% / .24), hsl(0 0% 100% / 0));");
    expect(dark).toContain("--mtab-sheen: radial-gradient(40% 80% at 30% 0%, hsl(0 0% 100% / .08), hsl(0 0% 100% / 0) 70%), linear-gradient(180deg, hsl(0 0% 100% / .07), hsl(0 0% 100% / 0));");
    const after = block(".mtab::after");
    expect(after).toContain("inset: 1px 1px auto; height: 50%;");
    expect(after).toContain("background: var(--mtab-sheen);");
  });
  test("the rim and the solid fallbacks of R1213 stand", () => {
    expect(block(".mtab::before")).toContain("background: var(--mtab-rim);");
    expect(css).toContain("@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {\n  .mtab { background: hsl(var(--mtab-bg)); }");
    expect(css).toContain("@media (prefers-reduced-transparency: reduce) {\n  .mtab { background: hsl(var(--mtab-bg)); -webkit-backdrop-filter: none; backdrop-filter: none; }");
    expect(css).toContain('html[data-contrast="more"] .mtab { background: hsl(var(--card));');
  });
});

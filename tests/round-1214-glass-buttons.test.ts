/**
 * R1214: one liquid glass button system on the phone. The shared Button carries the glass classes on every variant
 * (globals.css .gbtn*), the header's round actions and the hand-built segmented controls and chips share the same
 * tokens, and every rule sits inside the phone media query so desktop buttons are untouched.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");
const btn = src("components/ui/button.tsx");
const block = css.slice(css.indexOf("R1214: one liquid glass button system"), css.indexOf("/* 1099 Add to Home Screen card"));

describe("R1214 glass tokens and surfaces (globals.css)", () => {
  test("tokens live on :root and html.dark, and cover tint, blur, edge, highlights, shadow, radius, size, motion", () => {
    for (const t of ["--gb-bg", "--gb-a", "--gb-blur", "--gb-sat", "--gb-line", "--gb-hi", "--gb-hi2", "--gb-shadow", "--gb-r", "--gb-icon", "--gb-dur", "--gb-ease", "--gb-press"]) {
      expect(block).toContain(`${t}:`);
    }
    expect(block).toContain("html.dark {\n  --gb-bg:");
    expect(block).toContain("--gb-dur: .2s; --gb-ease: var(--ease-liquid); --gb-press: .96;");
  });
  test("every glass rule is scoped to the phone (under 1024px), tokens aside", () => {
    const rules = block.slice(block.indexOf("@media (max-width: 1023.98px) {"));
    expect(block.indexOf(".gbtn,")).toBeGreaterThan(block.indexOf("@media (max-width: 1023.98px) {"));
    // the only top-level selectors before the media query are the token blocks
    const head = block.slice(0, block.indexOf("@media (max-width: 1023.98px) {"));
    expect(head.match(/^[.a-z]/gm)?.filter((l) => l.startsWith(".")) ?? []).toEqual([]);
    expect(rules).toContain("backdrop-filter: blur(var(--gb-blur)) saturate(var(--gb-sat));");
  });
  test("R1215: the positioned box comes from a zero-specificity :where, so a page's absolute/fixed placement wins", () => {
    expect(block).toContain(":where(.gbtn, .gbtn-icon, .gchip, .gseg) { position: relative; }");
    const main = block.slice(block.indexOf(".gbtn, .gbtn-icon, .gchip, .gseg {"), block.indexOf("/* the press:"));
    expect(main).not.toContain("position: relative");
    // the Pip sheet's X is placed by the page and must stay top-right
    expect(src("components/create/CreateWorkspace.tsx")).toContain('className="absolute right-3 top-4 z-[2] xl:hidden" onClick={closeDrawer} aria-label="Close Pip"');
  });
  test("four surfaces: frosted, lime, ink and red, plus the circle, the segment trough and the chip", () => {
    expect(block).toContain(".gbtn-lime {\n    --gb-bg: var(--lime);");
    expect(block).toContain("color: hsl(var(--lime-foreground));");
    expect(block).toContain(".gbtn-primary { --gb-bg: var(--primary);");
    expect(block).toContain(".gbtn-danger { --gb-bg: var(--destructive);");
    expect(block).toContain(".gbtn-icon { border-radius: var(--gb-r); min-width: var(--gb-icon); min-height: var(--gb-icon); }");
    expect(block).toContain(".gseg { border-radius: var(--gb-r); padding: 3px; }");
    expect(block).toContain('.gseg > [aria-pressed="true"], .gseg > [aria-selected="true"], .gseg > [aria-checked="true"]:not(:has(.gseg-pane)), .gseg > [data-on="true"], .gseg .gseg-pane {');
    expect(block).toContain('.gseg > [aria-pressed], .gseg > [aria-selected], .gseg > [role="tab"], .gseg > [role="radio"], .gseg > [data-on] {');
    expect(block).toContain('.gchip[aria-pressed="true"], .gchip[aria-selected="true"], .gchip[data-on="true"] {');
  });
  test("press feedback: a light pane fades in and the control scales to 96%, settling on the liquid curve", () => {
    expect(block).toContain(".gbtn:not(:disabled):active::after, .gbtn-icon:not(:disabled):active::after, .gchip:not(:disabled):active::after { opacity: 1; }");
    expect(block).toContain("transform: scale(var(--gb-press));");
    expect(block).not.toContain("transition-all");
    expect(block).not.toMatch(/\d{3,}ms|[.]?[5-9]s\b/); // nothing slower than the 200ms token
  });
  test("disabled is muted and flat", () => {
    expect(block).toContain(".gbtn:disabled, .gbtn-icon:disabled, .gchip:disabled {\n    background: hsl(var(--secondary) / .7); color: hsl(var(--muted-foreground));");
  });
  test("fallbacks: no blur support, reduced transparency, more contrast, forced colours, reduced motion", () => {
    expect(block).toContain("@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {\n    .gbtn, .gbtn-icon, .gchip, .gseg { background: hsl(var(--gb-bg) / .94); }");
    expect(block).toContain("@media (prefers-reduced-transparency: reduce) {\n    .gbtn, .gbtn-icon, .gchip, .gseg { background: hsl(var(--gb-bg) / .96); -webkit-backdrop-filter: none; backdrop-filter: none; }");
    expect(block).toContain('html[data-contrast="more"] .gbtn-lime { background: hsl(var(--lime)); }');
    expect(block).toContain("@media (forced-colors: active) {\n    .gbtn, .gbtn-icon, .gchip, .gseg { background: ButtonFace; color: ButtonText;");
    expect(block).toContain("@media (prefers-reduced-motion: reduce) {\n    .gbtn, .gbtn-icon, .gchip, .gseg, .gseg > *, .gseg-pane, .gbtn::after, .gbtn-icon::after, .gchip::after { transition: none; }");
  });
});

describe("R1214 the shared Button wears the glass (components/ui/button.tsx)", () => {
  test("every variant maps to a glass surface except ghost (text), and icon sizes add the circle", () => {
    expect(btn).toContain('const GLASS: Record<string, string> = { primary: "gbtn gbtn-primary", lime: "gbtn gbtn-lime", energy: "gbtn gbtn-lime", subtle: "gbtn", outline: "gbtn", danger: "gbtn gbtn-danger" };');
    expect(btn).toContain('const glass = cn(GLASS[variant ?? "subtle"], (size === "icon" || size === "icon-sm") && "gbtn-icon");');
    expect(btn).toContain("className={cn(buttonVariants({ variant, size }), glass, className)}");
  });
  test("handlers and the cva variants are untouched: same props spread, same variant names", () => {
    expect(btn).toContain("{...props} />");
    for (const v of ["primary:", "lime:", "energy:", "subtle:", "ghost:", "outline:", "danger:"]) expect(btn).toContain(v);
  });
});

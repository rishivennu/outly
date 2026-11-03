/** 1100: every studio card wears the liquid glass, blurred on desktop only; controls share one motion language. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n"); // the repo is CRLF
const css = read("app/globals.css");
const start = css.indexOf("1100: Liquid glass on every studio card");
const layer = css.slice(start).replace(/\/\*[\s\S]*?\*\//g, ""); // declarations only, no comments
const cut = layer.indexOf("@media (prefers-reduced-motion: no-preference)");
const glass = layer.slice(0, cut);
const motion = layer.slice(cut);
const S = "html:not([data-app]) .mmain :is(.glass, .pulse-card, .card-glass)";
const RINGS = "var(--cg-ring), var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow, 0 0 #0000)";

describe("1100 glass cards", () => {
  test("scoped to studio cards, never the Android app", () => {
    expect(start).toBeGreaterThan(0);
    expect(glass).toContain(`${S} {`);
    expect(read("app/(studio)/layout.tsx")).toMatch(/<main id="main" tabIndex=\{-1\} className="mmain /);
    for (const line of glass.split("\n").filter((l) => /\.mmain/.test(l))) expect(line).toMatch(/:not\(\[data-app\]\)/);
  });
  test("painted with backgrounds and inset shadows only: no pseudo-elements, no size change", () => {
    expect(glass).not.toMatch(/::(before|after)/);
    expect(glass).not.toMatch(/[{;]\s*(padding|margin|width|height|border|inset)[\w-]*\s*:/);
    expect(glass).toContain("inset 1px 1px 0 var(--cg-rim), inset -1px -1px 0 var(--cg-far)");
  });
  test("every shadow stack keeps focus, selected and Tailwind rings (the glass never erases them)", () => {
    const stacks = [...glass.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]).filter((v) => v.trim() !== "none");
    expect(stacks.length).toBe(3); // base, less transparency, more contrast
    for (const s of stacks) expect(s).toContain(RINGS);
    expect(glass).toMatch(/\.lime-ring \{ --cg-ring: inset 0 0 0 1px hsl\(var\(--lime\)/);
    for (const s of [".pulse-card:hover", '.pulse-card[aria-pressed="true"]']) expect(glass).toContain(s);
  });
  test("blur only on a desktop with a pointer; phones get tint and rim without it", () => {
    const base = glass.slice(glass.indexOf(`${S} {`), glass.indexOf("}", glass.indexOf(`${S} {`)));
    expect(base).toContain("backdrop-filter: none");
    const desk = glass.slice(glass.indexOf("@media (min-width: 1024px) and (hover: hover)"));
    expect(desk.slice(0, desk.indexOf("prefers-reduced-transparency"))).toMatch(/backdrop-filter: blur\(20px\)/);
    expect(desk).toContain("hsl(var(--card) / .3)"); // an opaque base under the blur keeps text at 4.5:1
    expect(glass).toMatch(/\.glass:is\(\.sticky, \.fixed\) \{\s*-webkit-backdrop-filter: blur/);
    expect(glass).toContain(`${S} :is(.glass, .pulse-card, .card-glass) { -webkit-backdrop-filter: none`); // one blur pass
  });
  test("solid for less transparency, more contrast and forced colours, sticky bars included", () => {
    const bars = `${S}, html:not([data-app]) .mmain .glass:is(.sticky, .fixed)`;
    expect(glass).toContain(`prefers-reduced-transparency: reduce) {\n  ${bars} {\n    background: hsl(var(--glass-solid))`);
    expect(glass).toContain(`html[data-contrast="more"]:not([data-app]) .mmain :is(.glass, .pulse-card, .card-glass), html[data-contrast="more"]:not([data-app]) .mmain .glass:is(.sticky, .fixed) {\n  background: hsl(var(--card))`);
    expect(glass).toContain(`forced-colors: active) {\n  ${bars} { outline: 1px solid CanvasText`);
  });
  test("phone-only reset for desktop panels, without a bare outline: none", () => {
    expect(glass).toMatch(/max-width: 1023\.98px\) \{\s*html:not\(\[data-app\]\) \.mmain \.card-glass\.card-glass-desk \{ background: none; box-shadow: none; \}/);
    expect(layer).not.toMatch(/outline:\s*(none|0)\b/);
  });
  test("the flat Billing, Calendar and Inbox cards opt in", () => {
    expect(read("components/billing/BillingParts.tsx")).toContain('cn("card-glass min-w-0 rounded-[28px] bg-card');
    const plan = read("components/billing/BillingView.tsx");
    expect(plan).toContain('"admin-card card-glass flex');
    expect(plan).toContain('p.highlight && "border-2 border-lime"'); // a highlighted plan keeps its lime edge
    expect(read("components/calendar/CalendarView.tsx")).toContain('isToday ? "glass lime-ring" : "card-glass bg-card/50 hairline"');
    for (const f of ["components/inbox/InboxView.tsx", "components/inbox/MessagesView.tsx"]) expect(read(f)).toContain("lg:hairline card-glass card-glass-desk");
  });
});

describe("1100 motion sweep", () => {
  const calm = motion.slice(0, motion.indexOf("@media (prefers-reduced-motion: reduce)"));
  test("switches, tabs and hoverable glass use the shared curve, only without reduced motion", () => {
    for (const s of ['button[role="switch"][data-state] > span[data-state]', '[role="tab"][class*="transition"]', ":is(.glass, .card-glass) { transition: box-shadow"]) expect(calm).toContain(s);
    expect(calm).toContain("var(--ease-liquid)");
    expect(calm).not.toMatch(/cubic-bezier\([^)]*(1\.[1-9]|-0?\.\d)/);
  });
  test("no card movement: hover sharpens the edge instead of lifting", () => {
    expect(layer).not.toMatch(/translate/);
    expect(glass).toMatch(/:is\(a, button, \[class\*="hover:bg-"\]\):is\(\.glass, \.card-glass\):hover \{ --cg-ring:/);
  });
  test("transform, colour and shadow only: nothing reflows", () => {
    for (const m of motion.matchAll(/transition:\s*([^;]+);/g)) for (const part of m[1].split(",")) expect(part.trim().split(/\s+/)[0]).toMatch(/^(transform|background-color|box-shadow)$/);
  });
  test("reduced motion keeps the colour change, drops the slide", () => {
    const red = motion.slice(motion.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(red).toContain("transition: background-color .15s ease");
    expect(red).not.toContain("transform");
  });
});

describe("1100 welcome review fixes", () => {
  const layout = read("app/(studio)/layout.tsx");
  const lib = read("lib/pwa-welcome.ts");
  const comp = read("components/shell/PwaWelcome.tsx");
  const route = read("app/api/admin/welcome/route.ts");
  test("rendered from normalised config, before the notices that wait for it", () => {
    expect(layout).toContain("{welcomeCfg.enabled && <PwaWelcome config={welcomeCfg} />}");
    const at = layout.indexOf("<PwaWelcome");
    expect(at).toBeLessThan(layout.indexOf("<PrivacyNotice"));
    expect(at).toBeLessThan(layout.indexOf("<SendingPill"));
  });
  test("a watchdog lifts the pre-paint cover if the app never hydrates", () => {
    expect(lib).toMatch(/WELCOME_WATCHDOG_MS = 10_000/);
    expect(lib).toContain("__owT");
    expect(comp).toMatch(/clearTimeout\([^)]*__owT/);
  });
  test("decides before paint, traps the page behind it, hands focus to the page after", () => {
    expect(comp).toContain("useLayoutEffect");
    expect(comp).toMatch(/useIso\(/);
    expect(comp).toContain("inert");
    expect(comp).toContain('getElementById("main")');
  });
  test("admin route caps points after dropping blanks and logs who changed it", () => {
    expect(route).toContain("z.preprocess");
    expect(route).toContain(".max(WELCOME_LIMITS.points)");
    expect(read("lib/pwa-welcome.ts")).toMatch(/points: 3\b/);
    expect(route).toContain("adminEvent(");
  });
});

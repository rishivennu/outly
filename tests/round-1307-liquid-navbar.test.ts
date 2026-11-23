// R1307: the public header is the Nimbus UI "Waterline" liquid navbar (components/ui/liquid-glass-navbar.tsx, kept
// verbatim) inside three floating glass pills (components/marketing/LiquidNav.tsx). Scrolling down splits the row into
// a brand pill top-left and a call-to-action pill top-right; scrolling up joins it again. These tests pin the parts
// that are easy to break later: the component's effects staying intact, the wrapper's wiring, the thresholds, the
// cleanup, reduced motion, the phone drawer and the CSS block's place and fallbacks.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NAV, SPLIT } from "@/components/marketing/LiquidNav";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const nimbus = read("components/ui/liquid-glass-navbar.tsx");
const nav = read("components/marketing/LiquidNav.tsx");
const layout = read("app/(marketing)/layout.tsx");
const css = read("app/globals.css");
const block = css.slice(css.indexOf("/* R1307 liquid nav"), css.indexOf("/* end R1307 liquid nav */"));

describe("R1307 the Nimbus component is in components/ui, whole", () => {
  test("exports and the water: shader, physics, ripples, icon scenes, CSS fallback, sound", () => {
    expect(nimbus.startsWith('"use client"\n')).toBe(true);
    expect(nimbus).toContain("export function LiquidNavbar(");
    expect(nimbus).toContain("export const NimbusIcons = {");
    expect(nimbus).toContain("export type LiquidNavItem = {");
    expect(nimbus).toContain("export { LiquidNavbar as Component }");
    expect(nimbus).toContain("export default LiquidNavbar");
    expect(nimbus).toContain("const FRAG = `precision highp float;"); // the WebGL water
    expect(nimbus).toContain('canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false })');
    expect(nimbus).toContain("float caus(vec2 p,float t)"); // caustics
    expect(nimbus).toContain("// break the neck: spawn droplets between head and tail");
    expect(nimbus).toContain("s.rips.push({ x, y, age: 0, amp })"); // ripples
    for (const fx of ["nvPop", "nvPlane", "nvTrail", "nvDrop", "nvSplashL", "nvSplashR", "nvSpin", "nvHop", "nvDoor", "nvWave"]) expect(nimbus).toContain(`@keyframes ${fx}`);
    expect(nimbus).toContain('.nimbus-nav[data-gl="off"] .nimbus-drop{display:block}'); // CSS drop without WebGL
    expect(nimbus).toContain('<filter id="nimbus-refract"');
    expect(nimbus).toContain("const plip = () => {");
    expect(nimbus).toContain("by guglielmogiannattasio.it");
  });
  test("it already pauses off screen and hidden, handles context loss, honours reduced motion and cleans up", () => {
    expect(nimbus).toContain("new IntersectionObserver(([e]) => { s.visible = e.isIntersecting; if (s.visible) loop() })");
    expect(nimbus).toContain('document.addEventListener("visibilitychange", vis)');
    expect(nimbus).toContain('cv?.addEventListener("webglcontextlost", lost)');
    expect(nimbus).toContain('s.reduce = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches');
    expect(nimbus).toContain("@media (prefers-reduced-motion:reduce){.nv-ico svg,.nv-ico::before,.nv-ico::after,.nv-door{animation:none!important;transition:none}}");
    expect(nimbus).toContain("cancelAnimationFrame(s.raf)");
    expect(nimbus).toContain("return () => ro.disconnect()");
    expect(nimbus).not.toContain("@/"); // no dependency besides React
    expect(nimbus.match(/^import /gm)).toEqual(['import ']);
  });
});

describe("R1307 LiquidNav wiring", () => {
  test("the marketing layout mounts it in place of the old bar, which stays in the tree", () => {
    expect(layout).toContain('import { LiquidNav } from "@/components/marketing/LiquidNav";');
    expect(layout).toContain("<LiquidNav />");
    expect(layout).not.toContain("MarketingNav");
    expect(read("components/marketing/Nav.tsx")).toContain("export function MarketingNav()");
  });
  test("Outlly items: real sections and routes, one icon and one scene each, Home first", () => {
    expect(NAV.map((n) => n.label)).toEqual(["Home", "How it works", "Features", "Pricing", "Resources", "Workshops", "Contact"]);
    expect(NAV.map((n) => n.href)).toEqual(["/", "/#how", "/#features", "/#pricing", "/help", "/workshops", "/contact"]);
    expect(NAV.filter((n) => n.sec).map((n) => n.sec)).toEqual(["how", "features", "pricing"]);
    for (const n of NAV) {
      expect(n.icon).toBeTruthy();
      expect(["plane", "drop", "spin", "glow", "wave", "pop"]).toContain(n.fx);
    }
    expect(NAV[4].routes?.test("/blog/some-post")).toBe(true);
    expect(NAV[5].routes?.test("/workshops/creator-hooks")).toBe(true); // R1309
    expect(NAV[6].routes?.test("/contact")).toBe(true);
    expect(NAV[4].routes?.test("/contact")).toBe(false);
    // every section the pill links to exists on the landing page
    for (const id of ["how", "features", "pricing"]) expect(read("app/(marketing)/page.tsx")).toMatch(new RegExp(`on\\("${id}"\\)`));
    expect(nav).toContain('import { LiquidNavbar, NimbusIcons, type LiquidNavItem } from "@/components/ui/liquid-glass-navbar";');
    expect(nav).toContain("icon: NimbusIcons.home");
    expect(nav).toContain('from "lucide-react"');
  });
  test("brand, log in and the call to action keep the site's rules", () => {
    expect(nav).toContain('<OutlyLogo className="text-[17.4px]" compactBelow={360} />');
    expect(nav).toContain('const ctaHref = waitlist ? joinHref(pathname) : "/signup";');
    expect(nav).toContain('const ctaLabel = waitlist ? "Join waitlist" : "Get started";');
    expect(nav).toContain('href="/login"');
    expect(nav).toContain("useSignedIn(");
    expect(nav).toContain('<Link href="/home" data-mag=""');
    expect(nav).toContain("useHiddenSections(pathname)");
    expect(nav).toContain("NAV.filter((n) => !n.sec || !hidden.has(n.sec))");
    expect(nav).not.toContain("hairline");
    expect(nav).not.toMatch(/[\u2013\u2014]/);
    // header pads the status bar inset like every pinned top edge (R1283 sweep)
    expect(nav).toContain('className="lnav sticky top-0 z-50 pl-[max(0.75rem,var(--sa-l))] pr-[max(0.75rem,var(--sa-r))] pt-[calc(var(--sa-t)+0.75rem)]');
    expect(nav).not.toContain("env(safe-area-inset");
  });
  test("the 1119 overshoot sweep carves out ONLY the verbatim Nimbus file", () => {
    const sweep = read("tests/round-1119-motion.test.ts");
    expect(sweep).toContain('f.file === "components/ui/liquid-glass-navbar.tsx"');
    expect(sweep).toContain("R1307");
    // the wrapper itself stays inside the house rules: no overshoot curves of its own
    expect(nav).not.toMatch(/cubic-bezier/);
  });
  test("split: direction with thresholds, never on every tick, held while a click glides, whole at the top", () => {
    expect(SPLIT.at).toBeGreaterThan(SPLIT.join);
    expect(SPLIT.down).toBeGreaterThanOrEqual(16);
    expect(SPLIT.up).toBeGreaterThanOrEqual(SPLIT.down);
    expect(nav).toContain("if (y < SPLIT.join) next = false;");
    expect(nav).toContain("else if (!held && dir > 0 && y > SPLIT.at && acc > SPLIT.down) next = true;");
    expect(nav).toContain("else if (!held && dir < 0 && acc > SPLIT.up) next = false;");
    expect(nav).toContain("if (next !== splitRef.current && !openRef.current) go(next);");
    expect(nav).toContain('window.addEventListener("scroll", onScroll, { passive: true });');
    expect(nav).toContain("if (!raf) raf = requestAnimationFrame(tick);");
    expect(nav).toContain("lockUntil.current = Date.now() + HOLD_MS;");
  });
  test("the move is GSAP (lazy), from layout offsets, with the token eases and no overshoot", () => {
    expect(nav).toContain('import { loadGsap, type GsapApi } from "@/lib/motion/gsap-lazy";');
    expect(nav).not.toMatch(/^import gsap/m);
    expect(nav).toContain("const bx = next ? left - (rr.left + brand.offsetLeft) : 0;");
    expect(nav).toContain("const ax = next ? right - menuW - (rr.left + actions.offsetLeft + actions.offsetWidth) : 0;");
    expect(nav).toContain('g.to(brand, { x: bx, duration: travel, ease: GSAP_EASE.out, overwrite: "auto" });');
    expect(nav).toContain('g.to(actions, { x: ax, duration: travel, ease: GSAP_EASE.out, overwrite: "auto" });');
    expect(nav).toContain('const travel = now ? 0 : sec("card");');
    expect(nav).toContain('const fade = now ? 0 : sec("nav");');
    expect(nav).not.toMatch(/["'](back|elastic|bounce)\./);
    expect(nav).not.toMatch(/scrub:/);
    // reduced motion jumps; the water pill leaves layout once faded so its loop stops, and returns before fading in
    expect(nav).toContain("const now = instant || reduced();");
    expect(nav).toContain('if (splitRef.current) water.style.display = "none";');
    expect(nav).toContain('water.style.display = ""; // back in layout first');
    // a page opened mid-scroll is split at once; resizes re-place the pills; cleanup kills the tweens
    expect(nav).toContain("apply(splitRef.current, true); // a page opened mid-scroll is already split");
    expect(nav).toContain("if (splitRef.current) apply(true, true);");
    expect(nav).toContain("g.killTweensOf(el)");
    expect(nav).toContain("ro.disconnect()");
  });
  test("links glide through the one scroll engine, the active item follows the 40% line and the route", () => {
    expect(nav).toContain('import { scrollPageTo } from "@/lib/motion/smooth";');
    expect(nav).toContain("scrollPageTo(Math.max(0, y));");
    expect(nav).toContain("const line = window.innerHeight * 0.4;");
    expect(nav).toContain("items.findIndex((it) => it.routes?.test(pathname ?? \"\"))");
    expect(nav).toContain("onClickCapture={onWaterClick}");
    expect(nav).toContain("if (!a || MOD(e)) return;"); // modified clicks open in a new tab as the browser likes
    expect(nav).toContain("<LiquidNavbar items={items} active={current} onChange={onWaterChange} tone={dark ? \"dark\" : \"light\"} />");
    expect(nav).not.toContain("Smoother");
  });
  test("phones: no water pill, a glass menu pill and a Radix drawer with the links, log in and the theme", () => {
    expect(nav).toContain("{desktop && (");
    expect(nav).toContain('window.matchMedia("(min-width: 1024px)")');
    expect(nav).toContain('import * as Dialog from "@radix-ui/react-dialog";');
    expect(nav).toContain("<Dialog.Trigger asChild>");
    expect(nav).toContain('<Dialog.Title className="sr-only">Menu</Dialog.Title>');
    expect(nav).toContain('data-lenis-prevent=""');
    expect(nav).toContain("lnav-sheet fixed left-[max(0.75rem,var(--sa-l))] right-[max(0.75rem,var(--sa-r))] top-[calc(var(--sa-t)+4.75rem)]");
    expect(nav).toContain('aria-label={open ? "Close menu" : "Open menu"}');
    expect(nav).toContain("<ThemeToggle compact />");
    expect(nav).toContain('{ href: "/partners", label: "Partner with us" }');
  });
});

describe("R1307 CSS", () => {
  test("the block sits before the 1120 block and is named", () => {
    const a = css.indexOf("/* R1307 liquid nav");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(css.indexOf("/* ---------- 1120: creator profile card"));
    expect(css).toContain("/* end R1307 liquid nav */");
  });
  test("three pills, one height and recipe; the water pill re-pointed at the tokens, 44px items", () => {
    expect(block).toContain(".lnav-pill { position: relative; isolation: isolate; height: 56px; border-radius: 9999px;");
    expect(block).toContain("-webkit-backdrop-filter: blur(20px) saturate(1.6); backdrop-filter: blur(20px) saturate(1.6);");
    expect(block).toContain("html.dark .lnav {");
    expect(block).toContain("html .lnav .nimbus-nav { font-family: inherit; --n-tint: hsl(var(--ln-bg) / .58); --n-fg: hsl(var(--foreground));");
    expect(block).toContain("html .lnav .nimbus-nav .nimbus-item { height: 44px;");
    expect(block).toContain("@media (min-width: 1024px) and (max-width: 1279px) {"); // icons only where six labels do not fit
    expect(block).toContain(".lnav-pill .lime-glow {");
    expect(block).toMatch(/hsl\(var\(--lime\) \/ \.5\)/); // the brand catch-light on the rim
  });
  test("fallbacks and motion tokens", () => {
    expect(block).toContain("@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {");
    expect(block).toContain("@media (prefers-reduced-transparency: reduce) {");
    expect(block).toContain('html[data-contrast="more"] .lnav-pill {');
    expect(block).toContain("@media (forced-colors: active) {");
    expect(block).toContain("@media (prefers-reduced-motion: reduce) { .lnav-dim, .lnav-sheet { animation: none !important; } }");
    expect(block).toContain("animation: lnav-drop var(--m-card) var(--m-ease-out) both;");
    expect(block).toContain("animation: lnav-lift var(--m-menu-exit) var(--m-ease-in) both;");
    expect(block).not.toContain("cubic-bezier(");
    expect(block).not.toContain("env(safe-area-inset");
  });
});

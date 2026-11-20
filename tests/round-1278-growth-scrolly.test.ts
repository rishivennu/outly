import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { GrowthEngine } from "../components/marketing/GrowthEngine";
import { GROWTH_BLOCKS } from "../lib/marketing/content";

/* R1278: the Growth Engine cards become a sticky film-strip scrolly from lg; below lg they stay today's cards. */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const html = renderToStaticMarkup(createElement(GrowthEngine));
const src = read("components/marketing/GrowthEngine.tsx");
const scrolly = read("components/marketing/growth/Scrolly.tsx");
const css = read("app/globals.css");
const START = "/* R1278 growth scrolly */";
const END = "/* end R1278 */";
const block = css.slice(css.indexOf(START), css.indexOf(END));
const rules = block.replace(/\/\*[\s\S]*?\*\//g, "");
const classOf = (marker: string) => {
  const at = html.indexOf(marker);
  return html.slice(html.lastIndexOf('class="', at), html.indexOf('"', html.lastIndexOf('class="', at) + 7) + 1);
};

describe("R1278 markup", () => {
  test("wrapper, stage, strip and one frame per block", () => {
    expect(html).toMatch(/<div class="ge-scrolly lg:mt-14 lg:grid lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,34rem\)\] lg:gap-x-16">/);
    expect((html.match(/class="ge-stage /g) ?? []).length).toBe(1);
    expect((html.match(/class="ge-strip /g) ?? []).length).toBe(1);
    expect((html.match(/class="ge-frame /g) ?? []).length).toBe(GROWTH_BLOCKS.length);
    GROWTH_BLOCKS.forEach((_, i) => expect(html).toContain(`data-i="${i}" class="ge-frame`));
  });
  test("the stage is lg only, sticky, decorative, and repeats no text", () => {
    const stage = classOf("ge-stage");
    for (const c of ["hidden", "lg:block", "sticky", "self-start", "overflow-hidden", "rounded-[1.75rem]", "border-border", "bg-card"]) expect(stage.split(/[\s"]/)).toContain(c);
    const s = html.slice(html.indexOf("ge-stage") - 40);
    expect(s).toMatch(/^[\s\S]*?<div aria-hidden="true" class="ge-stage/);
    expect(s).not.toContain("<h3");
    expect(s).not.toContain("<article");
    expect((html.match(/<h3 /g) ?? []).length).toBe(GROWTH_BLOCKS.length);
  });
  test("the inline example hides at lg, the cards keep their phone and tablet classes", () => {
    const cards = html.slice(0, html.indexOf("ge-stage"));
    expect((cards.match(/<div class="lg:hidden"><div aria-hidden="true" class="ge-viz/g) ?? []).length).toBe(GROWTH_BLOCKS.length);
    expect(cards).toContain("mt-12 grid gap-5 sm:mt-14 md:grid-cols-2 md:gap-6 lg:mt-0 lg:flex lg:flex-col lg:gap-0");
    expect((cards.match(/class="ge-item flex md:row-span-3 md:grid md:grid-rows-subgrid lg:flex lg:min-h-\[70vh\] lg:items-center"/g) ?? []).length).toBe(GROWTH_BLOCKS.length);
    const card = classOf("ge-card");
    for (const c of ["border", "bg-card", "p-6", "sm:p-8", "md:p-6", "md:grid", "md:grid-rows-subgrid", "motion-safe:[@media(hover:hover)]:hover:-translate-y-1"]) expect(card.split(/[\s"]/)).toContain(c);
    for (const c of ["lg:border-0", "lg:bg-transparent", "lg:p-0", "lg:shadow-none", "lg:!translate-y-0", "lg:flex"]) expect(card.split(/[\s"]/)).toContain(c);
    expect(card).not.toContain("lg:p-8");
  });
  test("no step is active in the server markup; GrowthEngine stays a server component", () => {
    expect(html).not.toContain("data-on");
    expect(html).not.toContain("data-live");
    expect(src).not.toContain('"use client"');
    expect(src).toContain('import { Scrolly } from "./growth/Scrolly";');
  });
});

describe("R1278 motion (Scrolly)", () => {
  test("a use client leaf, lg only through gsap.matchMedia, reverted on unmount", () => {
    expect(scrolly.startsWith('"use client";')).toBe(true);
    expect(scrolly).toContain('const LG = "(min-width: 1024px)";');
    expect(scrolly).toContain("const mm = gsap.matchMedia();");
    expect(scrolly).toContain("mm.add(LG, (ctx) => {");
    expect(scrolly).toContain("return () => mm.revert();");
    expect(scrolly).toContain("io.disconnect();");
  });
  test("an IntersectionObserver band at the viewport centre picks one step, starting at 0", () => {
    expect(scrolly).toContain('const BAND = "-45% 0px -45% 0px";');
    expect(scrolly).toContain("{ rootMargin: BAND }");
    expect(scrolly).toContain('steps.forEach((s, n) => s.toggleAttribute("data-on", n === i));');
    expect(scrolly).toContain("show(0);");
  });
  test("time-based tween at the section pace, never scrubbed or pinned", () => {
    expect(scrolly).toContain('duration: sec("section"), ease: GSAP_EASE.out');
    expect(scrolly).toContain(".to(strip, { yPercent: -i * 100 }, 0)");
    expect(scrolly).toContain(".fromTo(frames[i], { scale: 0.96, opacity: 0.6 }, { scale: 1, opacity: 1 }, 0)");
    const code = scrolly.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/scrub|pin:|ScrollTrigger|ScrollSmoother/);
  });
  test("reduced motion sets the frame, no tween", () => {
    expect(scrolly).toContain("const still = reduced();");
    const r = scrolly.slice(scrolly.indexOf("if (still || first)"), scrolly.indexOf("return;", scrolly.indexOf("if (still || first)")));
    expect(r).toContain("gsap.set(strip, { yPercent: -i * 100 });");
    expect(r).not.toMatch(/gsap\.(to|from|timeline)/);
  });
  test("no ScrollSmoother anywhere in the section, no new dependencies", () => {
    for (const f of [src, scrolly]) expect(f).not.toContain("ScrollSmoother");
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const d of ["locomotive-scroll", "scrollmagic", "aos", "animejs", "motion", "@react-spring/web", "react-intersection-observer", "@studio-freight/lenis"]) expect(deps).not.toContain(d);
    expect(deps).toContain("gsap");
    expect(deps).toContain("lenis");
  });
});

describe("R1278 CSS block", () => {
  test("delimited once, before the 1100 studio card marker", () => {
    expect(css.split(START).length - 1).toBe(1);
    expect(css.split(END).length - 1).toBe(1);
    expect(css.indexOf(END)).toBeGreaterThan(css.indexOf(START));
    expect(css.indexOf(END)).toBeLessThan(css.indexOf("/* ---------- 1100: Liquid glass on every studio card ----------"));
  });
  test("the stage is centred by CSS vars, the strip is never moved from CSS", () => {
    expect(rules).toContain("--stage-h: min(34rem, calc(100vh - 9rem));");
    expect(rules).toContain("top: calc((100vh - var(--stage-h)) / 2);");
    expect(rules).toContain("height: var(--stage-h);");
    expect(rules).not.toMatch(/transform|translate|yPercent|ge-strip|ge-frame/);
    expect(rules).not.toMatch(/backdrop-filter|blur\(/);
  });
  test("ink: muted until data-on, only after Scrolly arms, a timed colour and opacity fade, none when reduced", () => {
    expect(rules).toContain("html.js .ge-scrolly[data-live] .ge-item > .ge-card { color: hsl(var(--muted-foreground)); opacity: .7;");
    expect(rules).toContain("transition: color var(--m-card) var(--m-ease-out), opacity var(--m-card) var(--m-ease-out);");
    expect(rules).toContain("html.js .ge-scrolly[data-live] .ge-item[data-on] > .ge-card { color: hsl(var(--foreground)); opacity: 1; }");
    expect(rules).toContain("@media (prefers-reduced-motion: reduce) { html.js .ge-scrolly[data-live] .ge-item > .ge-card { transition: none; } }");
    expect(rules).toMatch(/^\s*@media \(min-width: 1024px\) \{/);
  });
});

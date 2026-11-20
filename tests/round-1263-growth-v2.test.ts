import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { GrowthEngine } from "../components/marketing/GrowthEngine";
import { GROWTH_BLOCKS } from "../lib/marketing/content";

/* R1263: Content Growth Engine v2, the refined layout. */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const html = renderToStaticMarkup(createElement(GrowthEngine));
const src = read("components/marketing/GrowthEngine.tsx");
const loop = read("components/marketing/GrowthLoop.tsx");
const examples = read("components/marketing/growth/Examples.tsx");
const css = read("app/globals.css");
const START = "/* R1263 growth engine */";
const END = "/* end R1263 growth engine */";
const block = css.slice(css.indexOf(START), css.indexOf(END));
const rules = block.replace(/\/\*[\s\S]*?\*\//g, "");
const vizOf = (id: string) => {
  const at = html.indexOf(`id="ge-${id}"`);
  const from = html.lastIndexOf("<div", html.indexOf('class="ge-viz', at));
  return html.slice(from, html.indexOf("</article>", from));
};

describe("R1263 workflow", () => {
  const ol = html.slice(html.indexOf('aria-label="The growth loop"'), html.indexOf("</ol>"));
  test("one track element for all four steps, four nodes, no per-step segments", () => {
    expect((html.match(/class="ge-track"/g) ?? []).length).toBe(1);
    expect((ol.match(/class="ge-track-fill"/g) ?? []).length).toBe(1);
    expect((ol.match(/class="ge-node"/g) ?? []).length).toBe(4);
    expect((ol.match(/class="ge-step"/g) ?? []).length).toBe(4);
    expect(html).not.toContain("ge-seg");
    expect(ol).toMatch(/^aria-label="The growth loop"><li aria-hidden="true" class="ge-track">/); // first grid item
  });
  test("each step is placed by --n, the hooks the motion pass will use are present", () => {
    for (let i = 0; i < 4; i++) expect(ol).toContain(`style="--i:${i};--n:${i + 1}"`);
    for (const c of ["ge-label", "ge-hint", "ge-card", "ge-viz"]) expect(html).toContain(c);
  });
  test("the track spans first to last node on phones and runs across from sm", () => {
    expect(rules).toContain("grid-row: 1 / 4");
    expect(rules).toMatch(/margin-bottom: calc\(-1 \* \(var\(--ge-row\) \+ var\(--ge-top\) \+ var\(--ge-node\) \/ 2\)\)/);
    expect(rules).toMatch(/@media \(min-width: 640px\) \{\s*\.ge-steps \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(rules).toContain("calc((100% - 3 * var(--ge-gap)) / 8)");
    expect(rules).toContain(".ge-step { grid-column: var(--n); grid-row: 1;");
  });
  test("the hidden pre-state exists only under html.js, until GrowthLoop arms, with a failsafe", () => {
    const hides = [...rules.matchAll(/[^{};]*:not\(\[data-ge="live"\]\)[^{]*\{[^}]*\}/g)].map((m) => m[0].trim());
    expect(hides.length).toBeGreaterThanOrEqual(3);
    for (const h of hides) for (const sel of h.slice(0, h.indexOf("{")).split(/,(?![^(]*\))/)) expect(sel.trim()).toMatch(/^(\[dir="rtl"\] )?html\.js/);
    expect(rules).toContain('html.js .ge-loop:not([data-ge="live"]) :is(.ge-node-lit, .ge-label, .ge-hint, .ge-note) { opacity: 0; animation: ge-failsafe 0s linear 3s forwards; }');
    expect(rules).toContain("@keyframes ge-failsafe { to { opacity: 1; clip-path: inset(0); } }");
    expect(rules).not.toContain("data-shown");
    expect(rules).not.toMatch(/ge-draw|ge-node-on/); // the phase-1 CSS draw is gone: one owner
  });
});

describe("R1263 examples", () => {
  test("four examples, each labelled Example and hidden from assistive tech", () => {
    // R1278: the lg stage repeats each example once more, after the cards.
    const cards = html.slice(0, html.indexOf("ge-stage"));
    expect((cards.match(/<div aria-hidden="true" class="ge-viz[^"]*"><p[^>]*>Example<\/p>/g) ?? []).length).toBe(4);
    expect((html.match(/<div aria-hidden="true" class="ge-viz[^"]*"><p[^>]*>Example<\/p>/g) ?? []).length).toBe(8);
  });
  test("memory: the exact tracking state per version, X never implies metrics", () => {
    const m = vizOf("memory");
    expect(m).toContain("Original upload");
    const rows = ["Instagram Reel", "YouTube Short", "X post"].map((w) => m.indexOf(`${w}</span>`));
    rows.forEach((i) => expect(i).toBeGreaterThan(-1));
    const state = (i: number) => m.slice(rows[i], i < 2 ? rows[i + 1] : undefined);
    expect(state(0)).toContain("Views tracked");
    expect(state(1)).toContain("Views tracked");
    expect(state(2)).toContain("Not provided by X");
    expect(state(2)).not.toContain("Views tracked");
    expect((m.match(/\/brand\/logos\//g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(examples).not.toMatch(/\bbg-white\b/);
  });
  test("adaptation: Video, Instagram image and carousel, Text post the only Coming soon", () => {
    const a = vizOf("adapt");
    for (const s of ["One idea", "Video", "Image post", "Carousel", "Text post"]) expect(a).toContain(s);
    expect((a.match(/>Instagram</g) ?? []).length).toBe(2);
    expect((a.match(/Coming soon/g) ?? []).length).toBe(1);
    expect(a.slice(a.indexOf("Text post"))).toContain("Coming soon");
    const soonTags = html.slice(0, html.indexOf("ge-stage")).match(/class="lt-soon[^"]*">Coming soon</g) ?? [];
    expect(soonTags.length).toBe(GROWTH_BLOCKS.flatMap((b) => b.bullets.filter((x) => x.soon)).length + 1);
    for (const id of ["intelligence", "memory", "planner"]) expect(vizOf(id)).not.toContain("Coming soon");
  });
  test("planner: Accepted, Saved, Open, only Accepted is lime", () => {
    const p = vizOf("planner");
    const chip = (s: string) => new RegExp(`<span class="ge-status[^"]*"[^>]*>(?:<svg(?:(?!<span)[\\s\\S])*?</svg>)?${s}</span>`).exec(p)?.[0] ?? "";
    expect(chip("Accepted")).toContain("bg-lime");
    for (const s of ["Saved", "Open"]) {
      expect(chip(s)).not.toBe("");
      expect(chip(s)).not.toContain("bg-lime");
    }
  });
  test("intelligence: relative words only, no figures", () => {
    const i = vizOf("intelligence").replace(/<[^>]+>/g, " ");
    for (const s of ["Best-performing", "High confidence", "Above usual", "Next:"]) expect(i).toContain(s);
    expect(i).not.toMatch(/\d/);
  });
});

describe("R1263 cards", () => {
  test("hover lift only for hover-capable pointers and never under reduced motion", () => {
    expect(src).toContain("motion-safe:[@media(hover:hover)]:hover:-translate-y-1");
    expect(src).toContain("transition-[transform,box-shadow] duration-200");
    expect(src).toContain("motion-reduce:transition-none");
    expect(src.replace(/\[@media\(hover:hover\)\]:hover:/g, "")).not.toMatch(/\shover:/);
    expect(rules).toMatch(/@media \(hover: hover\) \{\s*\.ge-card:hover/);
    expect(rules.replace(/@media \(hover: hover\) \{[\s\S]*?\n\}/, "")).not.toContain(":hover");
  });
  test("bullets and examples align across a row: the cards are subgrids from md", () => {
    expect((src.match(/md:row-span-3 [^"]*md:grid md:grid-rows-subgrid/g) ?? []).length).toBe(2);
    expect(html).toContain("md:grid-cols-2");
  });
  test("no React state, still a server component", () => {
    for (const f of [src, examples]) {
      expect(f).not.toContain('"use client"');
      expect(f).not.toMatch(/\buse(State|Effect|Ref)\b/);
    }
  });
});

describe("R1263 CSS block", () => {
  test("start and end markers present exactly once, old markers gone", () => {
    expect(css.split(START).length - 1).toBe(1);
    expect(css.split(END).length - 1).toBe(1);
    expect(css.indexOf(END)).toBeGreaterThan(css.indexOf(START));
    expect(css).not.toContain("R1261 growth engine");
  });
  test("no backdrop-filter or blur, no transforms or transitions (the 1100 sweep reads to the end of the file)", () => {
    expect(rules).not.toMatch(/backdrop-filter|blur\(/);
    expect(rules).not.toMatch(/transform|translate|transition:/);
    expect(examples).not.toMatch(/backdrop|blur/);
    expect(src).not.toMatch(/backdrop|blur/);
  });
  test("reduced motion shows the final state; forced colours kept", () => {
    expect(rules).toContain("@media (prefers-reduced-motion: reduce) { .ge-loop :is(.ge-node-lit, .ge-label, .ge-hint, .ge-note) { opacity: 1; } .ge-loop .ge-track-fill { clip-path: none; } }");
    expect(rules).toMatch(/@media \(forced-colors: active\) \{\s*\.ge-node, \.ge-node-lit, \.ge-track-fill \{ background: CanvasText;/);
  });
});

describe("R1263 motion (GrowthLoop)", () => {
  test("a use client leaf; GrowthEngine and the examples stay server components", () => {
    expect(loop.startsWith('"use client";')).toBe(true);
    expect(src).toContain('import { GrowthLoop } from "./GrowthLoop";');
  });
  test("gsap.context scoped to the root, reverted on unmount; once, never scrubbed or pinned", () => {
    expect(loop).toMatch(/gsap\.context\(\(\) => \{[\s\S]*\}, root\)/);
    expect(loop).toContain("return () => ctx.revert();");
    expect(loop).toContain("once: true");
    expect(loop).toContain('start: "top 80%"');
    expect(loop).toContain("onEnter: () => tl.play()");
    expect(loop).toContain("if (self.progress === 1) tl.progress(1);");
    expect(loop).not.toMatch(/scrub|pin:/);
  });
  test("reduced motion runs no timeline; simple() drops clip and scale", () => {
    const r = loop.slice(loop.indexOf("if (reduced())"), loop.indexOf("const lite"));
    expect(r).toContain('el.dataset.ge = "live";');
    expect(r).toContain("return;");
    expect(r).not.toContain("tl.");
    expect(loop).toContain("lite ? { clipPath: OPEN, autoAlpha: 0 } : { clipPath: shut }");
    expect(loop).toContain("scale: lite ? 1 : 0.6");
  });
  test("from-values are set before arming, final state cleared after", () => {
    expect(loop.indexOf("gsap.set([...label, ...hint, ...note]")).toBeLessThan(loop.indexOf('el.dataset.ge = "live";\n\n'));
    expect(loop).toContain('clearProps: "opacity,visibility,transform"');
    expect(loop).toContain("const TRACK = 0.7;");
  });
  test("the loop is no longer wrapped in Reveal, the cards still are", () => {
    expect(src).not.toMatch(/<Reveal[^>]*ge-loop/);
    expect(src).toContain('<GrowthLoop className="mt-12 sm:mt-14">');
    expect(src).toContain('<Reveal as="ul" stagger');
    expect(html).toMatch(/<div class="ge-loop mt-12 sm:mt-14" data-ge="">/);
    expect((html.match(/class="ge-node-lit"/g) ?? []).length).toBe(4);
    for (const c of ["ge-note", "ge-return"]) expect(html).toContain(c);
    expect(loop).not.toContain("ge-viz"); // examples ride the card reveal only
  });
});

describe("R1263 head and accessibility", () => {
  test("section landmark, one h2 split into its two sentences", () => {
    expect(html).toMatch(/^<section id="growth"[^>]*aria-labelledby="growth-title"/);
    const h2 = html.slice(html.indexOf("<h2"), html.indexOf("</h2>"));
    expect(h2).toContain('id="growth-title"');
    expect(h2).toContain("clamp(1.95rem,2.9vw+1.15rem,3.5rem)");
    expect((h2.match(/class="block text-balance"/g) ?? []).length).toBe(2);
    expect(h2.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).toBe("More than publishing. A smarter way to grow.");
  });
  test("readable body measure and the Play pass hooks kept", () => {
    expect(html).toContain("rv-body rv-kw max-w-[60ch]");
    for (const c of ["rv-head", "rv-eyebrow", "rv-words"]) expect(html).toContain(c);
  });
  test("lists are real lists", () => {
    expect((html.match(/<ol /g) ?? []).length).toBe(1);
    expect((html.match(/<article /g) ?? []).length).toBe(4);
    for (const b of GROWTH_BLOCKS) expect(html).toContain(`aria-labelledby="ge-${b.id}"`);
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { GrowthEngine } from "../components/marketing/GrowthEngine";
import { FEATURES, GROWTH, GROWTH_BLOCKS, STEPS } from "../lib/marketing/content";
import { supportsFormat } from "../lib/formats";

/* R1261: the Content Growth Engine section on the landing page. Copy is checked against what the product ships. */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const html = renderToStaticMarkup(createElement(GrowthEngine));
const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("R1261 render", () => {
  test("headline, supporting copy and section id", () => {
    expect(html).toContain('id="growth"');
    expect(html).toContain('aria-labelledby="growth-title"');
    expect(text).toContain("More than publishing.");
    expect(text).toContain("A smarter way to grow.");
    expect(text).toContain("understand what works, discover what to create next");
  });
  test("the four block headlines and names", () => {
    for (const t of ["Understand what works.", "Your content has a memory.", "One idea. Multiple ways to connect.", "Know what to create next."]) expect(text).toContain(t);
    for (const n of ["Outlly Intelligence", "Content Memory", "Smart Content Adaptation", "Growth Planner"]) expect(text).toContain(n);
    expect((html.match(/<article /g) ?? []).length).toBe(4);
  });
  test("the loop reads Create, Publish, Learn, Improve in order, on one track (R1263)", () => {
    const labels = GROWTH.loop.map((s) => s.label.toUpperCase());
    expect(labels).toEqual(["CREATE", "PUBLISH", "LEARN", "IMPROVE"]);
    const ol = html.slice(html.indexOf('aria-label="The growth loop"'), html.indexOf("</ol>")).toUpperCase();
    const at = labels.map((l) => ol.indexOf(`>${l}<`));
    at.forEach((i) => expect(i).toBeGreaterThan(-1));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect((html.match(/class="ge-track"/g) ?? []).length).toBe(1);
    expect((html.match(/class="ge-node"/g) ?? []).length).toBe(4);
  });
});

describe("R1261 accuracy", () => {
  test("every not-yet-built bullet carries a Coming soon tag, and only those", () => {
    const soon = GROWTH_BLOCKS.flatMap((b) => b.bullets.filter((x) => x.soon));
    expect(soon.map((x) => x.label)).toEqual(["Text posts"]);
    const tags = (html.slice(0, html.indexOf("ge-stage")).match(/class="lt-soon[^"]*">Coming soon</g) ?? []).length; // R1278: before the lg stage copy
    expect(tags).toBe(soon.length + 1); // the bullet and the Text chip in the adaptation example
  });
  test("text posts are not a post format today, photos and carousels are Instagram only", () => {
    expect(supportsFormat("instagram", "photo")).toBe(true);
    expect(supportsFormat("instagram", "carousel")).toBe(true);
    expect(supportsFormat("youtube", "carousel")).toBe(false);
    const adapt = GROWTH_BLOCKS.find((b) => b.id === "adapt")!;
    expect(adapt.bullets.find((x) => x.label === "Image posts")?.note).toBe("Instagram today");
    expect(adapt.bullets.find((x) => x.label === "Carousel content")?.note).toBe("Instagram today");
    expect(adapt.body).toContain("text posts are next");
  });
  test("topic insights and per-platform numbers are qualified", () => {
    const intel = GROWTH_BLOCKS.find((b) => b.id === "intelligence")!;
    expect(intel.bullets.find((x) => x.label.includes("topic"))?.note).toBeTruthy();
    expect(intel.bullets.find((x) => x.label.startsWith("Platform"))?.note).toContain("where the platform");
  });
  test("every example visual is labelled as an example and hidden from assistive tech", () => {
    const viz = html.slice(0, html.indexOf("ge-stage")).match(/<div aria-hidden="true" class="ge-viz[^"]*"><p[^>]*>Example<\/p>/g) ?? [];
    expect(viz.length).toBe(4);
  });
});

describe("R1261 page wiring", () => {
  const page = read("app/(marketing)/page.tsx");
  test("GrowthEngine renders after Features and before TimeSaved, behind the features switch", () => {
    const f = page.indexOf("<Panel><Features />");
    const g = page.search(/\{on\("features"\) && <Panel><GrowthEngine \/><\/Panel>\}/);
    const t = page.indexOf("<Panel><TimeSaved />");
    expect(f).toBeGreaterThan(0);
    expect(g).toBeGreaterThan(f);
    expect(t).toBeGreaterThan(g);
    expect(page.indexOf('import { GrowthEngine } from "@/components/marketing/GrowthEngine"')).toBeGreaterThan(page.indexOf('import { Features }'));
  });
  test("keywords added, title and description untouched", () => {
    expect(page).toContain('"content intelligence",');
    expect(page).toContain('"content growth engine",');
    expect(page).toContain('title: { absolute: "Outlly · Your content deserves to be everywhere" }');
  });
  test("one hero only, no new nav item", () => {
    expect((page.match(/<Hero /g) ?? []).length).toBe(1);
    expect(read("components/marketing/Nav.tsx")).not.toContain("#growth");
  });
  test("the CSS block is appended and delimited, with a reduced-motion rule", () => {
    const css = read("app/globals.css");
    const at = css.indexOf("/* R1263 growth engine */"); // R1263 renamed the R1261 markers
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, css.indexOf("/* end R1263 growth engine */"));
    expect(block).toContain("@media (prefers-reduced-motion: reduce) { .ge-loop :is(.ge-node-lit, .ge-label, .ge-hint, .ge-note) { opacity: 1; } .ge-loop .ge-track-fill { clip-path: none; } }");
    expect(block).toContain('html.js .ge-loop:not([data-ge="live"]) .ge-track-fill { clip-path: inset(0 0 100% 0);'); // R1263: GrowthLoop draws it
    expect(block.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/transform|translate|transition:/); // the 1100 motion sweep reads to the end of the file
  });
});

describe("R1261 copy", () => {
  test("no em-dashes in the new or touched copy", () => {
    const strings = [
      GROWTH.eyebrow, GROWTH.title, GROWTH.body, GROWTH.loopNote, ...GROWTH.loop.flatMap((s) => [s.label, s.hint]),
      ...GROWTH_BLOCKS.flatMap((b) => [b.name, b.title, b.body, ...b.bullets.flatMap((x) => [x.label, x.note ?? ""])]),
      ...FEATURES.map((f) => f.body), ...STEPS.map((s) => s.body),
    ];
    for (const s of strings) expect(s).not.toContain("\u2014");
    expect(html).not.toContain("\u2014");
  });
  test("the engine clauses landed on the existing features", () => {
    const body = (t: string) => FEATURES.find((f) => f.title === t)!.body;
    expect(body("Scheduling and a calendar")).toStartWith("Plan and manage your publishing");
    expect(body("AI captions and hooks")).toContain("every audience");
    expect(body("Analytics where the platform allows")).toContain("Outlly Intelligence turns them into decisions");
    expect(STEPS[2].body).toStartWith("Publish across every supported platform");
  });
});

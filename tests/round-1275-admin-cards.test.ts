/**
 * R1275 admin cards: one soft card surface token (.admin-card) instead of the bright hairline frame, Card tones,
 * hover elevation only for clickable cards, and the kit type scale (sentence-case table heads, tabular figures,
 * nothing heavier than 700).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Card, CardTitle, Empty, PageHead, Section, Table } from "../components/admin/ui";

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const css = read("app/globals.css");
const block = css.slice(css.indexOf("/* R1275 admin cards */"), css.indexOf("/* end R1275 */"));
const KIT = ["components/admin/ui.tsx", "components/admin/ChartCard.tsx", "components/admin/motion/AdminKpi.tsx", "components/admin/FilterBar.tsx", "components/admin/SearchBox.tsx", "components/admin/Pagination.tsx", "components/admin/kit.ts"];

describe("surface token", () => {
  test("the block sits before the 1100 marker and defines the line and shadows for light and dark", () => {
    const at = css.indexOf("/* R1275 admin cards */");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(css.indexOf("/* ---------- 1100: Liquid glass on every studio card ----------"));
    expect(block).toContain(".admin-root, .admin-layer {\n  --admin-card-line: var(--foreground) / .07;");
    expect(block).toContain(".dark .admin-root, .dark .admin-layer, .dark.admin-layer {\n  --admin-card-line: 0 0% 100% / .055;");
    for (const v of ["--admin-card-shadow:", "--admin-card-hover-shadow:"]) expect(block.split(v).length - 1).toBe(2);
  });
  test(".admin-card paints the card fill, the line and the shadow at zero specificity", () => {
    expect(block).toContain(":where(.admin-card) { background: hsl(var(--card)); border-radius: 24px; box-shadow: inset 0 0 0 1px hsl(var(--admin-card-line)), var(--admin-card-shadow); }");
    expect(block).toContain(":where(.admin-card.admin-card--flat) { background: hsl(var(--secondary) / .4); box-shadow: none; }");
    expect(block).toContain(":where(.admin-card.admin-card--float)");
    expect(block).toContain("backdrop-filter: blur(var(--glass-blur))");
    expect(block).toContain("prefers-reduced-transparency: reduce");
  });
  test("hover elevation is gated on hover devices, clickable cards only, and the lift on motion preference", () => {
    expect(block).toContain("@media (hover: hover) {\n  :is(.admin-card[data-interactive], a.admin-card):hover { box-shadow:");
    expect(block).toContain("@media (hover: hover) and (prefers-reduced-motion: no-preference) {\n  :is(.admin-card[data-interactive], a.admin-card):hover { transform: translateY(-1px); }");
    const lifts = block.match(/translateY\([^)]*\)/g) ?? [];
    expect(lifts).toEqual(["translateY(-1px)"]);
    expect(block).not.toContain("transition");
    expect(block).not.toContain("font-family");
  });
  test("the shared .hairline stays as it was (the studio uses it)", () => {
    expect(css).toContain(".hairline {\n    box-shadow: inset 0 0 0 1px hsl(var(--foreground) / 0.07);\n  }");
  });
});

describe("Card", () => {
  test("no hairline, the token class, tones and interactive", () => {
    const plain = renderToStaticMarkup(createElement(Card, null, "x"));
    expect(plain).toContain("admin-card");
    expect(plain).toContain("bg-card");
    expect(plain).not.toContain("hairline");
    expect(plain).not.toContain("data-interactive");
    const flat = renderToStaticMarkup(createElement(Card, { tone: "flat" }, "x"));
    expect(flat).toContain("admin-card--flat");
    expect(flat).not.toContain("bg-card");
    expect(renderToStaticMarkup(createElement(Card, { tone: "float" }, "x"))).toContain("admin-card--float");
    expect(renderToStaticMarkup(createElement(Card, { interactive: true, as: "article" }, "x"))).toMatch(/^<article[^>]*data-interactive=""/);
  });
  test("a page's own classes still merge over the defaults", () => {
    const html = renderToStaticMarkup(createElement(Card, { className: "bg-lime/[0.05] p-4" }, "x"));
    expect(html).toContain("bg-lime/[0.05]");
    expect(html).not.toContain("bg-card");
    expect(html).not.toContain("p-5");
  });
});

describe("kit type scale", () => {
  test("headings: page 26-30px at 650, section 20px, card 16px, empty 15px", () => {
    const head = renderToStaticMarkup(createElement(PageHead, { title: "T", body: "B" }));
    expect(head).toContain("text-[26px] font-[650] leading-[1.2] tracking-[-0.01em] sm:text-[28px] lg:text-[30px]");
    expect(head).toContain("max-w-prose text-[14px] leading-relaxed text-muted-foreground sm:text-[15px]");
    expect(renderToStaticMarkup(createElement(Section, { title: "S", children: null }))).toContain("text-[20px] font-semibold leading-[1.3]");
    const card = renderToStaticMarkup(createElement(CardTitle, { hint: "h", children: "C" }));
    expect(card).toContain("text-[16px] font-semibold");
    expect(card).toContain("text-[13px]");
    const empty = renderToStaticMarkup(createElement(Empty, { title: "E", body: "b" }));
    expect(empty).toContain("text-[15px] font-semibold");
    expect(empty).toContain("text-[13px]");
  });
  test("table heads are sentence case at 12px/600 and every cell uses tabular figures", () => {
    const html = renderToStaticMarkup(createElement(Table, { head: ["Name", "Count"], children: createElement("tr", { key: "a" }, createElement("td", null, "x"), createElement("td", null, "3")) }));
    expect(html).toContain("text-[12px] font-semibold tracking-normal text-muted-foreground");
    expect(html).not.toContain("uppercase");
    expect(html).toContain("[&amp;_td]:tabular-nums");
    expect(html).toContain('data-cell="lead"');
    expect(html).toContain('data-label="Count"');
    expect(html).toContain('data-flip-id="a"');
  });
  test("KPI value is tabular at 650; nothing in the kit is heavier than 700", () => {
    const kpi = read("components/admin/motion/AdminKpi.tsx");
    expect(kpi).toContain("text-[26px] font-[650] leading-none tabular tabular-nums sm:text-[28px]");
    expect(kpi).not.toContain("hairline");
    for (const f of KIT) {
      const s = read(f);
      expect(s).not.toMatch(/font-black|font-extrabold|font-bold/);
      for (const m of s.matchAll(/font-\[(\d+)\]/g)) expect(Number(m[1])).toBeLessThanOrEqual(700);
      expect(s).not.toContain("transition-all");
      expect(s).not.toContain("border-white");
    }
  });
  test("hairline survives in the kit only as the field edge of the filter select", () => {
    const hits = KIT.flatMap((f) => read(f).split("\n").filter((l) => l.includes("hairline")).map((l) => `${f}: ${l.trim().slice(0, 40)}`));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("SearchBox.tsx");
  });
});

/**
 * R1295: the Outlly cast, eleven Open Peeps (CC0) composed through react-peeps and SVGO into one server-only data file.
 * Ink follows currentColor and paper takes --peep-fill, so one drawing works on light, dark and every pastel tile.
 * The figures stand in the /partners tier tiles, the application success card, the partnerships empty state, the
 * partnership detail header and the home chart's empty state; client components receive them as ReactNode props.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PEEPS, PEEP_NAMES } from "@/components/ui/art/peeps/data";
import { Peep, PeepSpot, peepWidth } from "@/components/ui/art/peeps/Peep";
import { STATUS_PEEP } from "@/components/partnerships/model";
import { PARTNER_STATUSES } from "@/lib/partners/types";

const read = (p: string) => readFileSync(p, "utf8");

describe("R1295 cast data", () => {
  test("eleven named figures, every name in the table, server-only", () => {
    expect(PEEP_NAMES.length).toBe(11);
    for (const n of PEEP_NAMES) expect(PEEPS[n]).toBeDefined();
    expect(read("components/ui/art/peeps/data.ts")).toMatch(/^import "server-only";/);
    expect(read("components/ui/art/peeps/Peep.tsx")).toMatch(/^import "server-only";/);
    for (const f of readdirSync("components/ui/art/peeps")) expect(read(`components/ui/art/peeps/${f}`)).not.toContain('"use client"');
  });
  test("every figure is paths only: ink currentColor, paper --peep-fill, no fixed colours, nothing live", () => {
    for (const n of PEEP_NAMES) {
      const { viewBox, markup } = PEEPS[n];
      expect(viewBox).toMatch(/^-?\d+ -?\d+ \d+ \d+$/);
      expect(markup).toContain('fill="currentColor"');
      expect(markup).toContain('fill="var(--peep-fill)"');
      expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(markup).not.toMatch(/<script|<image|<foreignObject|<style|href=|on[a-z]+=/i);
      expect(markup).not.toMatch(/<(?!\/?(path|g)\b)/);
      expect(markup.length).toBeLessThan(20_000);
    }
  });
  test("no two figures are the same drawing", () => {
    const seen = new Set(PEEP_NAMES.map((n) => PEEPS[n].markup));
    expect(seen.size).toBe(PEEP_NAMES.length);
  });
});

describe("R1295 Peep component", () => {
  test("decorative svg with its size written in, the fill as a custom property", () => {
    const html = renderToStaticMarkup(createElement(Peep, { name: "relax", height: 100 }));
    expect(html).toMatch(/^<svg viewBox="[^"]+" width="\d+" height="100" aria-hidden="true" focusable="false" data-peep="relax"/);
    expect(html).toContain("--peep-fill:hsl(var(--card))");
    expect(html).toContain('fill="currentColor"');
    expect(peepWidth("relax", 100)).toBe(Math.round((100 * 832) / 1157));
  });
  test("a custom paper colour and class go through", () => {
    const html = renderToStaticMarkup(createElement(Peep, { name: "creator", height: 208, fill: "#ffffff", className: "x" }));
    expect(html).toContain("--peep-fill:#ffffff");
    expect(html).toContain('class="shrink-0 select-none x"');
  });
  test("PeepSpot: a sticker (dark ink, warm-white paper) in a lime disc, bust sunk below the box and clipped to the disc's arc", () => {
    const html = renderToStaticMarkup(createElement(PeepSpot, { name: "question", height: 100 }));
    const figure = 116;
    const w = peepWidth("question", figure);
    const disc = 84;
    expect(w).toBeGreaterThan(disc);
    expect(html).toContain(`data-peep-spot="question"`);
    expect(html).toContain(`width:${w}px;height:100px;clip-path:path(&quot;M0 0H${w}V100H${w / 2 + 42}V58A42 42 0 0 1 ${w / 2 - 42} 58V100H0Z&quot;)`);
    expect(html).toContain('class="absolute bottom-0 rounded-full bg-lime/15 dark:bg-lime/20"');
    expect(html).toContain(`width:${disc}px;height:${disc}px`);
    expect(html.indexOf("bg-lime/15")).toBeLessThan(html.indexOf("<svg"));
    expect(html).toMatch(/<svg [^>]*height="116"[^>]*data-peep="question"/);
    expect(html).toContain("--peep-fill:#f6f4ee");
    expect(html).toContain("bottom:-16px;color:#131315");
    expect(html).toContain('aria-hidden="true"');
  });
  test("PeepSpot: the box is never narrower than the disc", () => {
    const html = renderToStaticMarkup(createElement(PeepSpot, { name: "creator", height: 100 }));
    expect(peepWidth("creator", 116)).toBeLessThan(84);
    expect(html).toContain("width:84px;height:100px");
  });
});

describe("R1295 placements", () => {
  test("partners tiers: one figure per tier, all different, standing at the stage's left before the card (R1303), ink in the tile tone", () => {
    const s = read("components/partners/Sections.tsx");
    const peeps = [...s.matchAll(/^\s+peep: "([a-z]+)",$/gm)].map((m) => m[1]);
    expect(peeps).toEqual(["creator", "growing", "established"]);
    expect(s).toContain('<Peep name={peep} height={176} fill="color-mix(in srgb, #ffffff 82%, var(--t-bg))" className={s.peep} />');
    expect(s.indexOf("className={s.peep}")).toBeLessThan(s.indexOf("<div className={s.creator}"));
    const css = read("components/partners/sections.module.css");
    expect(css).toMatch(/\.peep \{[^}]*position: absolute;[^}]*left: 3\.25rem;[^}]*bottom: 0;[^}]*translate: -50% 0;[^}]*color: var\(--t-ink\);/s);
    expect(css).not.toMatch(/\.peep \{[^}]*right:/s);
    expect(css).toMatch(/\.creator \{[^}]*, 0 0 0 1px color-mix\(in srgb, var\(--t-ink\) 14%, #ffffff\);/s);
  });
  test("client components take the figure as a prop; the pages render it (server-only stays out of client bundles)", () => {
    for (const f of ["components/partners/ApplyForm.tsx", "components/partnerships/PartnershipsList.tsx", "components/dashboard/PulseHome.tsx"]) {
      const s = read(f);
      expect(s).toMatch(/^"use client";/);
      expect(s).not.toMatch(/from "@\/components\/ui\/art\/peeps/);
    }
    expect(read("components/partners/ApplyForm.tsx")).toContain("doneArt?: ReactNode");
    expect(read("components/partnerships/PartnershipsList.tsx")).toContain("emptyArt?: ReactNode");
    expect(read("components/dashboard/PulseHome.tsx")).toContain("emptyArt?: ReactNode");
    expect(read("app/(marketing)/partners/page.tsx")).toContain('doneArt={<PeepSpot name="cheers" height={112} />}');
    expect(read("app/(studio)/dashboard/partnerships/page.tsx")).toContain('emptyArt={<PeepSpot name="relax" height={136} />}');
    expect(read("app/(studio)/home/page.tsx")).toContain('emptyArt={<PeepSpot name="numbers" height={88} />}');
  });
  test("empty states keep their icon when no figure is passed; the text stays the carrier of meaning", () => {
    const l = read("components/partnerships/PartnershipsList.tsx");
    expect(l).toContain("{emptyArt ?? (");
    expect(l).toContain('<h2 id="pp-empty" className="mt-4 text-[19px] font-semibold">No applications yet</h2>');
    const p = read("components/dashboard/PulseHome.tsx");
    expect(p).toContain("{emptyArt}");
    expect(p).toContain('<p className="text-[15px] font-semibold">Your numbers land here</p>');
  });
  test("every partnership status has a figure; the detail header shows it beside the pill", () => {
    for (const st of PARTNER_STATUSES) expect(PEEP_NAMES).toContain(STATUS_PEEP[st]);
    expect(STATUS_PEEP.more_info).toBe("question");
    expect(STATUS_PEEP.rejected).toBe(STATUS_PEEP.withdrawn);
    const d = read("components/partnerships/PartnershipDetail.tsx");
    expect(d).toContain('<PeepSpot name={STATUS_PEEP[app.status as PartnerStatus] ?? "relax"} height={96} />');
    expect(read("components/partnerships/model.ts")).toContain('import type { PeepName } from "@/components/ui/art/peeps/data";');
  });
  test("the generator lives in the repo and is not an app dependency", () => {
    expect(read("scripts/peeps/README.md")).toContain("bun gen.mjs");
    const pkg = read("package.json");
    expect(pkg).not.toContain("react-peeps");
    expect(pkg).not.toContain('"svgo"');
  });
});

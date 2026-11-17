import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LANDING_DEFAULT, LANDING_SECTIONS, hiddenAnchors, shown } from "../lib/landing";
import { USP } from "../lib/marketing/content";
import { CORE_PLATFORMS, EXTRA_PLATFORMS } from "../lib/domain";

/* Why Outlly (1161): the section after the hero. The copy is checked against what the product does. */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("1161 registry", () => {
  test("usp sits right after try, so the hero and the live box keep their places", () => {
    const ids = LANDING_SECTIONS.map((s) => s.id);
    expect(ids.indexOf("try")).toBe(1);
    expect(ids.indexOf("usp")).toBe(2);
    expect(ids.indexOf("how")).toBe(3);
  });
  test("its anchor is why-outlly and does not collide with the older why section", () => {
    const usp = LANDING_SECTIONS.find((s) => s.id === "usp")!;
    expect(usp.anchor).toBe("why-outlly");
    expect(LANDING_SECTIONS.filter((s) => s.anchor === "why").length).toBe(1);
    expect(shown(LANDING_DEFAULT, "usp")).toBe(true);
    expect(hiddenAnchors({ ...LANDING_DEFAULT, sections: { ...LANDING_DEFAULT.sections, usp: false } })).toEqual(["why-outlly"]);
  });
  test("the page renders it after the ticker and before Try it, behind its switch", () => {
    const page = read("app/(marketing)/page.tsx");
    const a = page.indexOf("<LogoTicker");
    const b = page.search(/\{on\("usp"\) && <(Panel><)?WhyOutlly/); // 1181: each section is wrapped in a <Panel> sheet
    const c = page.indexOf("<TryIt");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
  test("footer and scroll scenes know the anchor", () => {
    expect(read("components/marketing/Footer.tsx")).toContain('"/#why-outlly"');
    expect(read("components/marketing/ScrollScenes.tsx")).toContain('sec("#why-outlly")');
  });
});

describe("R1180 copy (simplified section)", () => {
  test("the brief's headlines, word for word", () => {
    expect(USP.eyebrow.toUpperCase()).toBe("WHY CREATORS CHOOSE OUTLLY");
    expect(USP.title).toBe("Your entire creator workflow. One powerful platform.");
    expect(USP.body).toBe("Create, publish, manage and grow your content from one place. No switching between multiple tools.");
    expect(USP.cards.map((c) => c.title)).toEqual(["AI Captions & Subtitles", "Multi-Platform Publishing", "Smart Content Calendar", "Unified Analytics", "Pip AI Assistant"]);
    expect(USP.cards[0].body).toBe("Turn videos into accurate captions, translate regional languages and create synchronized subtitles faster.");
    expect(USP.cta.title).toBe("Everything your creator workflow needs. In one place.");
    expect(USP.cta.body).toBe("Spend less time managing tools and more time creating.");
    expect(USP.cta.label).toBe("Explore Outlly");
  });
  test("five cards and no with/without comparison", () => {
    expect(USP.cards.length).toBe(5);
    expect("compare" in USP).toBe(false);
    const src = read("components/marketing/WhyOutlly.tsx");
    expect(src).not.toContain("Without Outlly");
    expect(src).not.toContain("usp-cmp");
  });
  test("no platform that is not connected is named as live, and no numbers are invented", () => {
    const text = JSON.stringify(USP);
    for (const p of EXTRA_PLATFORMS) expect(text.toLowerCase()).not.toContain(p);
    expect(text).not.toMatch(/\d+%|\d+x\b|\d[\d,]*\s*(followers|views|hours)/i);
    expect(text).not.toMatch(/[\u2014\u2013]/); // no dashes in copy
  });
  test("one larger card, four equal ones; the CTA follows waitlist mode", () => {
    const src = read("components/marketing/WhyOutlly.tsx");
    expect(src).toContain("lg:grid-cols-4");
    expect(src).toContain("md:col-span-2 lg:row-span-2");
    expect(src).toContain("#173A24");
    expect(src).toContain("#B5FF00");
    expect(src).toContain("<SignupCta");
    expect(src).not.toContain("CaptionPreview");
  });
});

describe("R1180 motion", () => {
  test("no loops: the old keyframes are gone, hover lift is off under reduced motion", () => {
    const css = read("app/globals.css");
    const block = css.slice(css.indexOf("Why Outlly (R1180"), css.indexOf("1163: admin tooltip"));
    expect(block).not.toContain("@keyframes");
    expect(block).toContain("prefers-reduced-motion: reduce");
    expect(block).not.toContain("transition: all");
    expect(css).not.toContain("usp-word");
  });
  test("the grid enters once in ScrollScenes, with no per-card stagger", () => {
    const src = read("components/marketing/ScrollScenes.tsx");
    expect(src).toContain('usp.querySelector(".usp-grid")');
    expect(src).not.toContain(".usp-cmp");
  });
});

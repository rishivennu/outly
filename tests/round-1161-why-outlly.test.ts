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
    const b = page.indexOf('{on("usp") && <WhyOutlly');
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

describe("1161 copy", () => {
  test("the brief's headlines, word for word", () => {
    expect(USP.eyebrow.toUpperCase()).toBe("WHY CREATORS CHOOSE OUTLLY");
    expect(USP.title).toBe("Your entire creator workflow. One powerful platform.");
    expect(USP.cards.map((c) => c.title)).toEqual([
      "Your videos. Captions in seconds.",
      "Create once. Customize for every platform.",
      "Your entire content schedule. Under control.",
      "Know what is working across every platform.",
      "Your creator conversations in one place.",
      "Meet Pip. Your AI-powered creator companion.",
    ]);
    expect(USP.cta.title).toBe("Everything your creator workflow needs. In one place.");
    expect(USP.cta.label).toBe("Explore Outlly");
  });
  test("six cards, five against five in the comparison", () => {
    expect(USP.cards.length).toBe(6);
    expect(USP.compare.without.items.length).toBe(5);
    expect(USP.compare.with.items.length).toBe(5);
  });
  test("no platform that is not connected is named as live, and no numbers are invented", () => {
    const text = JSON.stringify(USP);
    for (const p of EXTRA_PLATFORMS) expect(text.toLowerCase()).not.toContain(p);
    expect(text).not.toMatch(/\d+%|\d+x\b|\d[\d,]*\s*(followers|views|hours)/i);
    expect(text).not.toMatch(/[\u2014\u2013]/); // no dashes in copy
  });
  test("the inbox and analytics cards say what they do not do", () => {
    const inbox = USP.cards.find((c) => c.id === "inbox")!;
    expect(inbox.note).toMatch(/Direct messages are not included/);
    const analytics = USP.cards.find((c) => c.id === "analytics")!;
    expect(analytics.note).toMatch(/never filled in/);
  });
  test("previews only draw the three core platforms by default", () => {
    const src = read("components/marketing/usp/Previews.tsx");
    for (const p of EXTRA_PLATFORMS) expect(src).not.toContain(`"${p}"`);
    for (const p of CORE_PLATFORMS) expect(src).toContain(`"${p}"`);
  });
});

describe("1161 motion", () => {
  test("loops are transform and opacity only, paused until the grid is on screen, off under reduced motion", () => {
    const css = read("app/globals.css");
    const block = css.slice(css.indexOf("Why Outlly (1161)"));
    const frames = [...block.matchAll(/@keyframes [\w-]+ \{([^}]*\}\s*)*?\}/g)].map((m) => m[0]);
    expect(frames.length).toBeGreaterThan(8);
    for (const f of frames) {
      const props = [...f.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      for (const p of props) expect(["opacity", "transform", "color", "text-shadow"]).toContain(p);
    }
    expect(block).toContain("html.js .usp-grid:not([data-live])");
    expect(block).toContain("prefers-reduced-motion: reduce");
    expect(block).not.toContain("transition: all");
  });
  test("the stage only marks the grid live while visible", () => {
    const src = read("components/marketing/usp/Stage.tsx");
    expect(src).toContain("IntersectionObserver");
    expect(src).toContain("visibilitychange");
    expect(src).toContain('"data-live"');
  });
});

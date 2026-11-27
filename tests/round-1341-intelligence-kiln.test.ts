/** R1341: the Intelligence Engine landing section, the kiln (heat-field canvas, GSAP). */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LANDING_DEFAULT, LANDING_SECTIONS, hiddenAnchors, shown } from "../lib/landing";
import { ENGINE } from "../lib/marketing/content";
import { UPGRADE_COPY } from "../lib/intelligence/entitlements-core";
import { NEVER_INCLUDED } from "../lib/intelligence/consent-core";
import * as H from "../components/marketing/intelligence/heat";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const page = read("app/(marketing)/page.tsx");
const section = read("components/marketing/IntelligenceEngine.tsx");
const stage = read("components/marketing/intelligence/EngineStage.tsx");
const field = read("components/marketing/intelligence/HeatField.tsx");
const card = read("components/marketing/intelligence/EngineCard.tsx");
const css = read("app/globals.css");
const block = css.slice(css.indexOf("/* R1341 intelligence kiln */"), css.indexOf("/* end R1341 intelligence kiln */"));

describe("R1341 registry", () => {
  test("engine sits after How it works, before Features, shown by default, with its own anchor", () => {
    const ids = LANDING_SECTIONS.map((s) => s.id);
    expect(ids.indexOf("how")).toBe(3);
    expect(ids.indexOf("engine")).toBe(4);
    expect(ids.indexOf("features")).toBe(5);
    const e = LANDING_SECTIONS.find((s) => s.id === "engine")!;
    expect(e.anchor).toBe("intelligence");
    expect(e.label).toBe("Intelligence Engine");
    expect(shown(LANDING_DEFAULT, "engine")).toBe(true);
    expect(shown(null, "engine")).toBe(true);
    expect(hiddenAnchors({ ...LANDING_DEFAULT, sections: { ...LANDING_DEFAULT.sections, engine: false } })).toEqual(["intelligence"]);
  });
  test("the page wires it on its own switch, after How it works, and hands it the Features switch for the second button", () => {
    expect(page).toContain('{on("engine") && <Panel><IntelligenceEngine showGrowth={on("features")} /></Panel>}');
    expect(page.indexOf("<HowItWorks")).toBeLessThan(page.indexOf("<IntelligenceEngine"));
    expect(page.indexOf("<IntelligenceEngine")).toBeLessThan(page.indexOf("<Features"));
  });
});

describe("R1341 copy", () => {
  test("the four parts are the engine's own claims, in its own order", () => {
    expect(ENGINE.parts.map((p) => p.n)).toEqual(["01", "02", "03", "04"]);
    expect(ENGINE.parts.map((p) => p.name)).toEqual(["Baselines", "Forecasts", "Made for you", "Clip ranking"]);
    const [base, fore, made, clip, weekly] = UPGRADE_COPY.points;
    expect(base).toContain("per platform, with the sample it rests on");
    expect(ENGINE.parts[0].line).toContain("per platform, with the sample it rests on");
    expect(fore).toContain("judged against the real number a week later");
    expect(ENGINE.parts[1].line).toContain("judged against the real number a week later");
    expect(made).toContain("both sides of the evidence");
    expect(ENGINE.parts[2].line).toContain("both sides of the evidence");
    expect(clip).toContain("what has worked for you");
    expect(ENGINE.parts[3].line).toContain("what has worked for you");
    expect(weekly).toContain("weekly accuracy line");
    expect(ENGINE.accuracy).toContain("weekly accuracy line");
  });
  test("plans and sharing are stated honestly: Creator and Agency, loop on every plan, opt-in and off by default, no content", () => {
    expect(ENGINE.plans).toContain("Creator and Agency");
    expect(ENGINE.plans).toContain("on every plan");
    expect(ENGINE.sharing).toContain("opt-in");
    expect(ENGINE.sharing).toContain("off by default");
    expect(ENGINE.sharing).toMatch(/never your videos, captions or drafts/);
    expect(NEVER_INCLUDED.join(" ")).toMatch(/videos/);
    expect(NEVER_INCLUDED.join(" ")).toMatch(/drafts/i);
  });
  test("no prices, no currency, no upgrade nag; the spelled word is the headline's last word", () => {
    const all = JSON.stringify(ENGINE);
    expect(all).not.toMatch(/\$|INR|₹|[Uu]pgrade/);
    expect(ENGINE.title).toHaveLength(2);
    const last = ENGINE.title[1].replace(/[.!]$/, "").split(" ").pop()!;
    expect(ENGINE.spell).toBe(last.toUpperCase());
    expect(ENGINE.spell).toMatch(/^[A-Z]{3,12}$/);
    expect(ENGINE.secondary.href).toBe("#growth");
    expect(read("components/marketing/GrowthEngine.tsx")).toContain('id="growth"');
  });
});

describe("R1341 heat arithmetic", () => {
  test("palette: five bands above the thresholds, clear below the first", () => {
    expect(H.THRESHOLDS).toEqual([0.3, 0.44, 0.6, 0.76, 0.9]);
    expect(H.COLORS).toHaveLength(5);
    expect(H.band(0.1)).toBe(-1);
    expect(H.band(0.3)).toBe(0);
    expect(H.band(0.75)).toBe(2);
    expect(H.band(0.77)).toBe(3);
    expect(H.band(0.9)).toBe(4);
    expect(H.band(1.6)).toBe(4);
    for (const c of H.RGB) for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(255); }
  });
  test("noise is deterministic and in 0..1; the cloud never reaches the hot bands on its own", () => {
    expect(H.hash2(3, 7)).toBe(H.hash2(3, 7));
    expect(H.hash2(3, 7)).not.toBe(H.hash2(7, 3));
    let lo = 1, hi = 0;
    for (let i = 0; i < 2000; i++) {
      const v = H.fbm(i * 0.37, i * 0.11);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
    }
    expect(hi - lo).toBeGreaterThan(0.3);
    for (let i = 0; i < 500; i++) expect(H.cloud(i % 90, Math.floor(i / 90) * 3, i * 0.2)).toBeLessThanOrEqual(H.CLOUD_CAP);
    expect(H.band(H.CLOUD_CAP)).toBe(2); // cyan at most
  });
  test("the word is forced into the lime band, never the top one; the outline is cooled", () => {
    expect(H.band(H.withWord(0.1, 2))).toBe(3);
    expect(H.band(H.withWord(1.4, 2))).toBe(3);
    expect(H.withWord(0.5, 1)).toBeCloseTo(0.5 - H.OUTLINE_COOL);
    expect(H.withWord(0.5, 0)).toBe(0.5);
  });
  test("outline dilates letter cells by one into value 1 and leaves letters alone", () => {
    const m = new Uint8Array(25); m[12] = 2; // centre of 5x5
    const o = H.outline(m, 5, 5);
    expect(o[12]).toBe(2);
    expect(o[7]).toBe(1); expect(o[6]).toBe(1); expect(o[13]).toBe(1);
    expect(o[0]).toBe(0); expect(o[24]).toBe(0);
    expect(Array.from(o).filter((v) => v === 1)).toHaveLength(8);
  });
  test("layout: columns from the width, drip rows below the field (shorter on phones); reveal grows row by row", () => {
    const f = H.layout(1176, 300, false);
    expect(f.cols).toBe(Math.ceil(1176 / 11));
    expect(f.fieldRows).toBe(Math.floor(300 / 11));
    expect(f.dripRows).toBe(Math.round(160 / 11));
    expect(f.rows).toBe(f.fieldRows + f.dripRows);
    expect(H.layout(360, 200, true).dripRows).toBe(Math.round(66 / 11));
    expect(H.revealedRows(0, 40)).toBe(0);
    expect(H.revealedRows(0.5, 40)).toBe(20);
    expect(H.revealedRows(1, 40)).toBe(40);
    expect(H.revealedRows(2, 40)).toBe(40);
  });
  test("drip cut stays inside the drip zone; a burst rings out and is spent after its time", () => {
    for (let x = 0; x < 200; x += 3) for (const t of [0, 4.2, 9.9]) {
      const c = H.dripCut(x, t, 27, 14);
      expect(c).toBeGreaterThanOrEqual(27); expect(c).toBeLessThanOrEqual(41);
    }
    expect(H.burst(10, 10, 10, 10, 0)).toBe(0);
    expect(H.burst(10, 10, 10, 10, H.BURST.seconds)).toBe(0);
    const reach = H.BURST.reachPx / H.PITCH;
    const half = 1 - Math.pow(1 - 0.5, 3);
    expect(H.burst(10 + reach * half, 10, 10, 10, H.BURST.seconds / 2)).toBeGreaterThan(0.2);
    expect(H.burst(10, 10, 10, 10, H.BURST.seconds / 2)).toBeLessThan(0.05);
  });
  test("blobs shrink with a narrow field: a 32-column phone field is never flooded", () => {
    let maxWide = 0, maxNarrow = 0, meanNarrow = 0, n = 0;
    for (let i = 0; i < 400; i++) {
      const t = i * 0.3;
      maxWide = Math.max(maxWide, H.blobs(53, 10, t, 107, 21, 1));
      const v = H.blobs(16, 7, t, 32, 15, 1);
      maxNarrow = Math.max(maxNarrow, v);
      for (let y = 0; y < 15; y += 2) for (let x = 0; x < 32; x += 2) { meanNarrow += H.blobs(x, y, t, 32, 15, 1); n++; }
    }
    expect(maxWide).toBeGreaterThan(0.3); // the blobs do glow on the wide field
    expect(maxNarrow).toBeLessThanOrEqual(2 * H.BLOB.strength);
    expect(meanNarrow / n).toBeLessThan(0.16); // most of the narrow field is outside the blobs at any moment
  });
  test("intensity levels: calm, default, hot; clamped", () => {
    expect(H.LEVELS).toHaveLength(3);
    expect(H.LEVELS[H.LEVEL_DEFAULT]).toEqual({ heat: 0, speed: 1 });
    expect(H.LEVELS[0].heat).toBeLessThan(0); expect(H.LEVELS[2].heat).toBeGreaterThan(0);
    expect(H.clampLevel(-3)).toBe(0); expect(H.clampLevel(9)).toBe(2); expect(H.clampLevel(1.2)).toBe(1);
  });
});

describe("R1341 components", () => {
  test("section: server-rendered, labelled, anchored #intelligence, pixel face on the spelled word, text alternative, both buttons", () => {
    expect(section.startsWith('"use client"')).toBe(false);
    expect(section).toContain('<section id="intelligence" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="engine-title">');
    expect(section).toContain('<h2 id="engine-title"');
    expect(section).toContain("pixelFont.className");
    expect(section).toContain('data-ek-head=""');
    expect(section).toContain("<EngineStage word={ENGINE.spell} alt={ENGINE.alt}>");
    expect(section).toContain("<SignupCta");
    expect(section).toContain("showGrowth && (");
    expect(section).toContain("href={ENGINE.secondary.href}");
  });
  test("stage: GSAP (useGSAP, matchMedia on MOTION_OK, ScrollTrigger once) starts the entrance; reduced motion lands on the final state", () => {
    expect(stage).toContain("useGSAP(");
    expect(stage).toContain("gsap.matchMedia()");
    expect(stage).toContain("mm.add(MOTION_OK");
    expect(stage).toContain('mm.add("(prefers-reduced-motion: reduce)"');
    expect(stage).toContain("once: true");
    expect(stage).toContain('start: "top 75%"');
    expect(stage).toContain("if (self.progress === 1)");
    expect(stage).not.toContain("scrub");
    expect(stage).toContain('el.dataset.ek = "live"');
    expect(stage).toContain('<p className="sr-only">{alt}</p>');
    // Controls: three real buttons, 44 px, named, the pause one a toggle; not offered under reduced motion.
    expect(stage).toContain('aria-label="Calmer field"');
    expect(stage).toContain('aria-label="Hotter field"');
    expect(stage).toContain("aria-pressed={paused}");
    expect(stage.match(/h-11 w-11/g)).toHaveLength(3);
    expect(stage).toContain("{!still && (");
  });
  test("field: aria-hidden canvas, 30 fps cap, DPR cap, no smoothing, stops off screen and when hidden, GSAP reveal and intensity tweens", () => {
    expect(field).toContain('aria-hidden="true"');
    expect(field).toContain("imageSmoothingEnabled = false");
    expect(field).toContain("IntersectionObserver");
    expect(field).toContain('"visibilitychange"');
    expect(field).toContain("cancelAnimationFrame");
    expect(field).toContain("gsap.to(e.s, { reveal: 1, duration: H.REVEAL_SEC");
    expect(field).toContain("gsap.to(e.s, { heat: L.heat, speed: L.speed");
    expect(field).toContain("e.still()");
    expect(field).toContain('closest("a, button, input, [role=button]")');
    expect(H.FPS).toBe(30); expect(H.DPR_CAP).toBe(2);
  });
  test("card: rows are buttons with aria-expanded and aria-controls, auto-advance holds on hover, focus, pause and hidden tab", () => {
    expect(card).toContain("aria-expanded={isOpen}");
    expect(card).toContain("aria-controls={`ek-line-${i}`}");
    expect(card).toContain('role="region" aria-labelledby={`ek-part-${i}`} hidden={!isOpen}');
    expect(card).toContain("min-h-11");
    expect(card).toContain("gsap.delayedCall(ADVANCE");
    expect(card).toContain("if (!live || hold || paused || hidden) return;");
    expect(card).toContain("onPointerEnter={() => setHold(true)}");
    expect(card).toContain("onFocusCapture={() => setHold(true)}");
    expect(card).toContain("mm.add(MOTION_OK");
  });
});

describe("R1341 css", () => {
  test("one named block at the end, after the 1100 sweep marker, with no transforms or translates (GSAP sets them inline)", () => {
    expect(block.length).toBeGreaterThan(200);
    expect(css.indexOf("/* R1341 intelligence kiln */")).toBeGreaterThan(css.indexOf("/* end R1263 growth engine */"));
    const decl = block.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(decl).not.toMatch(/transform|translate|scale\(/);
    for (const m of decl.matchAll(/transition:\s*([^;]+);/g)) for (const part of m[1].split(",")) expect(part.trim().split(/\s+/)[0]).toMatch(/^(transform|background-color|box-shadow)$/);
  });
  test("pre-state only under html.js until the stage arms, failsafe, reduced motion and forced colours covered", () => {
    expect(block).toContain('html.js .ek-stage:not([data-ek="live"]) .ek-rise { opacity: 0; animation: ek-failsafe 0s linear 3s forwards; }');
    expect(block).toContain("@media (prefers-reduced-motion: reduce) { .ek-stage .ek-rise { opacity: 1; } }");
    expect(block).toContain("@media (forced-colors: active)");
    expect(block).toContain(".ek-field { display: none; }");
    expect(block).toContain("image-rendering: pixelated");
    expect(block).toContain(":focus-visible { outline: 2px solid hsl(var(--lime))");
    expect(block).toContain("pointer-events: none");
  });
});

// R1287 /partners tiers, criteria, steps and contact band in the flat pastel tile style.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const src = read("components/partners/Sections.tsx");
const css = read("components/partners/sections.module.css");
const flat = src.replace(/\s+/g, " ");

const PALETTE = ["dcd2f7", "3b2a6b", "f5b6cc", "5b1d38", "cfe3a8", "1e3a14", "f7e6a3", "5a4300", "f4b183", "5a2a0b", "bbd6ea", "1f3a52", "b5ff00", "0b1a00", "173a24", "e9ffe0", "ffffff"];

const lum = (hex: string) => {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [lo, hi] = [lum(a), lum(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a: string, b: string, t: number) =>
  [0, 2, 4].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, "0")).join("");

describe("R1287 sections exports", () => {
  test("the five exports exist and WhatYouGet renders nothing", async () => {
    const m = await import("../components/partners/Sections");
    for (const k of ["WhoCanPartner", "WhatYouGet", "WhatWeLookFor", "PartnerSteps", "PartnersContactBand"]) expect(typeof (m as Record<string, unknown>)[k]).toBe("function");
    expect(m.WhatYouGet()).toBeNull();
  });
});

describe("R1287 copy unchanged", () => {
  test("tiers, criteria, steps and note", () => {
    for (const r of ["1K to 5K followers", "5K to 10K followers", "10K+ followers", "Small and engaged beats big and quiet."]) expect(flat).toContain(r);
    expect(flat).toContain("PARTNER_TIER_LABEL[t.tier]");
    expect(flat).toContain("Tiers are indicative. We review every application on fit, not size.");
    for (const c of ["Likes, comments, shares and saves", "Niche fit: tech, AI tools, productivity, creators, business", "Ability to demonstrate Outlly"]) expect(flat).toContain(c);
    expect(flat).toContain("Follower count alone never decides it.");
    const steps = [...src.matchAll(/n: "(0\d)", title: "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(steps).toEqual(["01 Apply", "02 We review", "03 Get your offer", "04 Create and grow"]);
    expect(flat).toContain('<span className="sr-only">Step {Number(st.n)}: </span>');
    expect(src).not.toContain("\u2014");
  });
  test("creator cards carry follower pills that match their ranges", () => {
    expect(flat).toContain('followers: "3.2K followers"');
    expect(flat).toContain('followers: "7.8K followers"');
    expect(flat).toContain('followers: "24K followers"');
  });
});

describe("R1287 tile style", () => {
  test("tier and step tones follow the brief", () => {
    const tones = [...src.matchAll(/tone: "(\w+)"/g)].map((m) => m[1]);
    expect(tones).toEqual(["sky", "butter", "blush", "lavender", "moss", "apricot", "sky"]);
  });
  test("only palette hexes in both files", () => {
    const hexes = [...(src + css).matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => m[1].toLowerCase());
    expect(hexes.length).toBeGreaterThan(10);
    for (const h of hexes) expect(PALETTE).toContain(h);
  });
  test("section titles and tile titles use the play serif", () => {
    expect(src).toContain('const SECTION_TITLE = "play ');
    expect(src.match(/className=\{SECTION_TITLE\}/g)?.length).toBe(1);
    expect(src.match(/<Head\b/g)?.length).toBe(3);
    expect(flat).toMatch(/<h2 id="partners-contact" className=\{cn\("play"/);
    expect(src.match(/<h3 className=\{cn\("play", s\.title\)\}>/g)?.length).toBe(2);
    expect(src).toContain('<p className="eyebrow mb-5">');
  });
  test("tiles: radius 24 phone / 28 desktop, overflow hidden, no border, gradient or shadow", () => {
    const tile = css.match(/\.tile \{[^}]+\}/)![0];
    expect(tile).toContain("border-radius: 24px");
    expect(tile).toContain("overflow: hidden");
    expect(css).toMatch(/@media \(min-width: 640px\) \{\s*\.tile \{ border-radius: 28px;/);
    expect(css).not.toMatch(/gradient|backdrop-filter|border:/);
    const shadows = [...css.matchAll(/([.\w\s-]+)\{[^}]*box-shadow/g)].map((m) => m[1].trim());
    expect(shadows).toEqual([".creator"]);
    expect(css).toContain("box-shadow: 0 20px 50px -20px rgb(0 0 0 / 0.35)");
  });
  test("deep-tone body copy stays at least 4.5:1 on every tile", () => {
    expect(css).toContain("color-mix(in srgb, var(--t-ink) 85%, transparent)");
    const tones = [...css.matchAll(/--t-bg: #(\w{6}); --t-ink: #(\w{6});/g)].map((m) => [m[1], m[2]]);
    expect(tones.length).toBeGreaterThanOrEqual(7);
    for (const [bg, ink] of tones) expect(ratio(bg, mix(ink, bg, 0.85))).toBeGreaterThanOrEqual(4.5);
  });
  test("criteria are a semantic list of 44px sticker chips with tilts", () => {
    expect(flat).toContain('<Reveal as="ul" stagger className={s.chips}>');
    expect(flat).toContain("<li key={c} className={s.chip}>");
    expect(css).toMatch(/\.chip \{[^}]*min-height: 44px;[^}]*border-radius: 9999px;/);
    const tilts = [...css.matchAll(/\.chip:nth-child\(8n \+ \d\) \{ rotate: (-?[\d.]+)deg; \}/g)].map((m) => Math.abs(Number(m[1])));
    expect(tilts.length).toBe(8);
    for (const d of tilts) expect(d).toBeLessThanOrEqual(3);
  });
  test("phone mockups shrink", () => {
    expect(css).toMatch(/@media \(max-width: 639px\) \{\s*\.creator \{ scale: 0\.85; \}/);
  });
});

describe("R1287 motion", () => {
  test("idle float only with hover and motion allowed, none when reduced", () => {
    const anim = [...css.matchAll(/animation: idle-float/g)];
    expect(anim.length).toBe(1);
    expect(css).toMatch(/@media \(hover: hover\) and \(prefers-reduced-motion: no-preference\) \{\s*\.creator \{ animation: idle-float 6s ease-in-out/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.creator \{ animation: none; \}/);
    expect(css).toContain("translate: 0 -6px");
    expect(src).not.toMatch(/gsap|ScrollTrigger|useGSAP/);
    expect(src).not.toContain("transition-all");
  });
  test("tiles reveal on enter", () => {
    expect(src.match(/<Reveal as="li"/g)?.length).toBe(2);
    expect(src).toContain('import { Reveal } from "@/components/marketing/Reveal"');
  });
});

describe("R1287 contact band", () => {
  test("mailto button kept as is, FAQ ghost link to /help", () => {
    expect(flat).toContain('href="mailto:partners@outlly.com"');
    expect(flat).toContain(
      'className="inline-flex min-h-11 items-center rounded-full bg-[#B5FF00] px-5 text-[15px] font-semibold text-[#0b1a00] transition-transform active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B5FF00]"',
    );
    expect(flat).toContain("Write to partners@outlly.com");
    expect(flat).toMatch(/<Link href="\/help" className="inline-flex min-h-11 [^"]*border-\[#E9FFE0\]\/40[^"]*text-\[#E9FFE0\][^"]*focus-visible:outline[^"]*" > Read the FAQ <\/Link>/);
    expect(flat).toContain("s.deep");
    expect(css).toContain(".deep { --t-bg: #173a24; --t-ink: #e9ffe0; }");
  });
});

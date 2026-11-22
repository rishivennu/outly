// R1303 /partners polish: the page is set in the "Outlly classic" pair (Bricolage display, DM Sans body, Instrument
// Serif accent) through a scoped module, the hero copy leaves the stage before the handshake appears (nothing is read
// through the artwork), the tier figure stands to the left of its creator card, and the shared footer regroups its
// links into four short columns of about the same height.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const page = read("app/(marketing)/partners/page.tsx");
const classic = read("components/partners/classic.module.css");
const fonts = read("lib/fonts.ts");
const hero = read("components/partners/Hero.tsx");
const sections = read("components/partners/Sections.tsx");
const sectionsCss = read("components/partners/sections.module.css");
const bento = read("components/partners/Bento.tsx");
const footer = read("components/marketing/Footer.tsx");

describe("R1303 classic type on /partners", () => {
  test("the page wraps everything in the classic scope and the module re-points the three role variables", () => {
    expect(page).toContain('import classic from "@/components/partners/classic.module.css";');
    expect(page).toMatch(/return \(\s*<div className=\{classic\.classic\}>\s*<PartnersHero \/>/);
    expect(page).toMatch(/<PartnersContactBand \/>\s*<\/div>\s*\);/);
    expect(classic).toContain("--font-display: var(--font-bricolage), var(--font-dmsans), system-ui, sans-serif;");
    expect(classic).toContain("--font-body: var(--font-dmsans), system-ui, sans-serif;");
    expect(classic).toContain("--font-serif: var(--font-instrument), Georgia, serif;");
    expect(classic).toContain("font-family: var(--font-body);");
  });
  test("headlines carry the classic look from lib/fonts.ts (650, wdth 96 / opsz 72, -0.028em, 1.02)", () => {
    expect(fonts).toContain(`look: { weight: 650, tracking: "-0.028em", leading: 1.02, axes: '"wdth" 96, "opsz" 72' }`);
    const display = classic.split(".classic :global(.display) {")[1].split("}")[0];
    expect(display).toContain("font-weight: 650;");
    expect(display).toContain('font-variation-settings: "wdth" 96, "opsz" 72;');
    expect(display).toContain("letter-spacing: -0.028em;");
    expect(display).toContain("line-height: 1.02;");
    expect(classic).toMatch(/\.classic :global\(h1\),\s*\.classic :global\(h2\),\s*\.classic :global\(h3\),\s*\.classic :global\(h4\) \{[^}]*"wdth" 96;/);
  });
  test("every partners headline is `display`, the one accent word is `accent-serif`, and the Fraunces play classes are gone", () => {
    for (const src of [page, sections, bento, hero]) {
      expect(src).not.toMatch(/["'` ]play(?:-i)?["'` ]/);
    }
    expect(page).toContain('<h2 id="partners-apply" className="display text-[clamp(2rem,2.4vw+1rem,3rem)]">');
    expect(sections).toContain('const SECTION_TITLE = "display text-balance text-[clamp(2rem,2.4vw+1rem,3rem)]";');
    expect(sections.match(/cn\("display", s\.(?:title|numeral|bandTitle)\)/g)?.length).toBe(4);
    expect(bento).toContain('<h2 id="partners-what" className="display text-balance text-[clamp(2rem,2.4vw+1rem,3rem)]">');
    expect(bento).toContain('Six things you get, <span className="accent-serif">in plain words.</span>');
    expect(bento).toContain('<h3 className={cx("display", s.title)}>{title}</h3>');
    expect(bento).toContain('<span className={cx("display", s.planBig)} data-p="planBig">');
    expect(hero).toContain('<h1 id="partners-title" className={`display ${s.title}`}>');
  });
  test("the classic faces are mounted globally by the root layout, so the scope only re-points variables", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('variable: "--font-bricolage"');
    expect(layout).toContain('variable: "--font-dmsans"');
    expect(layout).toContain('variable: "--font-instrument"');
  });
});

describe("R1303 hero: the copy is read in full or not at all", () => {
  test("the copy lifts and fades to 0 between 0.2 and 0.5, before the SWAP window opens at CONTACT - 0.02", () => {
    expect(hero).toContain(".fromTo(copy, { opacity: 1, y: 0 }, { opacity: 0, y: -48, duration: 0.3 }, 0.2);");
    expect(hero).toContain("const CONTACT = 0.55;");
    expect(hero).toContain("const SWAP = { at: CONTACT - 0.02, duration: 0.06 };");
    expect(0.2 + 0.3).toBeLessThan(0.55 - 0.02);
    expect(hero).not.toContain("opacity: 0.12");
  });
});

describe("R1303 tier cards: figure left, card right", () => {
  test("the peep is anchored to the stage's left and bottom through a -50% translate, no right offset", () => {
    const peep = sectionsCss.split(".peep {")[1].split("}")[0];
    expect(peep).toContain("left: 3.25rem;");
    expect(peep).toContain("bottom: 0;");
    expect(peep).toContain("translate: -50% 0;");
    expect(peep).not.toContain("right:");
    expect(sectionsCss).toMatch(/@media \(min-width: 640px\) \{\s*\.peep \{ left: 3\.75rem; height: 11rem; \}/);
    expect(sectionsCss).toMatch(/@media \(min-width: 768px\) and \(max-width: 1023px\) \{\s*\.peep \{ left: 3rem; height: 9rem; \}\s*\.creator \{ scale: 0\.8; \}/);
  });
  test("the card keeps its right/bottom bleed and the figure still paints under it", () => {
    const creator = sectionsCss.split("\n.creator {")[1].split("}")[0];
    expect(creator).toContain("right: -1.25rem;");
    expect(creator).toContain("bottom: -1.75rem;");
    expect(sections.indexOf("className={s.peep}")).toBeLessThan(sections.indexOf("<div className={s.creator}"));
  });
});

describe("R1303 footer: four short groups side by side", () => {
  const cols = footer.split("const COLUMNS")[1].split("];")[0];
  const groups = [...cols.matchAll(/title: "([A-Za-z]+)",\s*links: \[([\s\S]*?)\]/g)].map((m) => ({ title: m[1], n: (m[2].match(/\{ href: "/g) ?? []).length }));
  test("Product, Support, Company and Legal, none longer than six links, and every earlier link still present", () => {
    expect(groups.map((g) => g.title)).toEqual(["Product", "Support", "Company", "Legal"]);
    for (const g of groups) expect(g.n).toBeLessThanOrEqual(6);
    expect(Math.max(...groups.map((g) => g.n)) - Math.min(...groups.map((g) => g.n))).toBeLessThanOrEqual(3);
    for (const href of ["/#why-outlly", "/#how", "/#features", "/#platforms", "/#compare", "/#pricing", "/#faq", "/help", "/contact", "/partners", "/privacy", "/terms", "/security", "/status", "/blog", "/changelog"]) {
      expect(cols).toContain(`{ href: "${href}",`);
    }
    expect((cols.match(/\{ href: "/g) ?? []).length).toBe(16);
  });
  test("cookie settings sits under Legal; the groups stay 2x2 on phones, a row on tablets, beside the pitch from 1024px", () => {
    expect(footer).toContain('{col.title === "Legal" && (');
    expect(footer).not.toContain('col.title === "Company"');
    expect(footer).toContain('<div className="grid grid-cols-2 gap-x-6 gap-y-10 md:contents">');
    expect(footer).toContain("md:grid-cols-4 md:gap-6 lg:grid-cols-[2.4fr_repeat(4,minmax(0,1fr))]");
    expect(footer).toContain('<div className="md:col-span-4 lg:col-span-1">');
    expect(footer).toContain('className="footer-link min-h-11 min-w-11 text-[15px]');
  });
});

// R1287 /partners bento: copy, tile clipping, palette, play serif, decorative mockups, guarded idle float.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const tsx = read("components/partners/Bento.tsx");
const css = read("components/partners/bento.module.css");
const flat = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

const TILES = [
  ["Paid collaborations", "Compensation agreed per campaign, written out before you start. Reach, quality, format and scope set the number."],
  ["Complimentary Creator plan", "One to two months of the Creator plan to make content with. Ongoing partners get it extended."],
  ["Track what you earn", "Every referral, signup and payout in one place."],
  ["Your portal", "Briefs, deliverables and feedback, without the email chain."],
  ["Content that fits every platform", "Reels, Shorts, X posts, YouTube: one upload, each destination gets its own cut and caption."],
  ["We remind, you create", "Deadlines and payouts as notifications, so nothing slips."],
] as const;

const PALETTE = [
  "#DCD2F7", "#3B2A6B", "#F5B6CC", "#5B1D38", "#CFE3A8", "#1E3A14", "#F7E6A3", "#5A4300",
  "#F4B183", "#5A2A0B", "#BBD6EA", "#1F3A52", "#B5FF00", "#0B1A00", "#173A24", "#E9FFE0", "#FFF", "#FFFFFF", "#080808",
];

const rule = (sel: string) => {
  const m = css.match(new RegExp(`(^|\\n)\\${sel} \\{([^}]*)\\}`));
  return m ? m[2] : "";
};

describe("R1287 bento copy", () => {
  test("section, eyebrow, heading and intro", () => {
    expect(tsx).toContain('export function PartnersBento()');
    expect(tsx).toContain('<section id="what" aria-labelledby="partners-what" className="scroll-mt-24 pb-10 pt-16 sm:pb-12 sm:pt-24">');
    expect(tsx).toContain('<p className="eyebrow mb-5">What partnering looks like</p>');
    expect(flat(tsx)).toContain("Six things you get, in plain words.");
  });
  test.each(TILES)("tile %s has its exact body", (title, body) => {
    expect(tsx).toContain(`title="${title}"`);
    expect(tsx).toContain(`body="${body}"`);
  });
  test("legal footnote under the grid", () => {
    expect(tsx).toContain(
      '<p className="mt-6 max-w-2xl text-pretty text-[14px] leading-relaxed text-muted-foreground">\n          Every offer is agreed individually after review. Applying does not guarantee payment or a subscription.\n        </p>',
    );
    expect(tsx.indexOf("Every offer is agreed")).toBeGreaterThan(tsx.indexOf("</ul>"));
  });
  test("no em-dash or en-dash anywhere", () => {
    expect(/[\u2013\u2014]/.test(tsx)).toBe(false);
    expect(/[\u2013\u2014]/.test(css)).toBe(false);
  });
});

describe("R1287 bento structure", () => {
  test("server component", () => {
    expect(tsx).not.toContain('"use client"');
  });
  test("every tile clips its mockup", () => {
    expect(rule(".tile")).toContain("overflow: hidden");
    expect(tsx.match(/<Tile\b/g)?.length).toBe(6);
    expect(tsx).toContain("<article className={cx(s.tile, tone)}>");
  });
  test("12-column grid with named areas, tall tile A", () => {
    expect(css).toContain("grid-template-columns: repeat(12, minmax(0, 1fr));");
    expect(css).toContain('"a a a a a b b b b b b b"');
    expect(css).toContain('"a a a a a c c c c d d d"');
    expect(css).toContain('"e e e e e e e e f f f f"');
    expect(css).toContain(".a .tile { min-height: 620px; }");
    expect(css).toContain("gap: 16px;");
  });
  test("play serif on h2 and every h3", () => {
    expect(tsx).toMatch(/<h2 id="partners-what" className="play /);
    expect(tsx).toContain('<h3 className={cx("play", s.title)}>');
  });
  test("each of the six mockup roots is aria-hidden", () => {
    const roots = tsx.match(/<div aria-hidden="true" className=\{cx\(s\.mock, s\.mock[A-F]\)\}>/g) ?? [];
    expect(roots.length).toBe(6);
    for (const k of ["A", "B", "C", "D", "E", "F"]) expect(tsx).toContain(`s.mock${k})`);
  });
  test("notification uses the Outlly rocket at 18px", () => {
    expect(tsx).toContain('import { OutllyLogoIcon } from "@/components/brand/OutllyBrand";');
    expect(tsx).toContain("<OutllyLogoIcon size={18}");
  });
});

describe("R1287 bento palette and motion", () => {
  test("only palette hexes plus #fff and #080808", () => {
    const hexes = [...(tsx + css).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toUpperCase());
    expect(hexes.length).toBeGreaterThan(0);
    for (const h of hexes) expect(PALETTE).toContain(h);
  });
  test("float only under hover:hover with motion allowed, and off for reduced motion", () => {
    expect(css).toContain("@media (hover: hover) and (prefers-reduced-motion: no-preference) {\n  .float { animation: bentoFloat 6s ease-in-out infinite; }");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \.float \{ animation: none; \}/);
    const outside = css.replace(/@media \(hover: hover\)[^{]*\{[\s\S]*?\n\}/, "");
    expect(outside).not.toMatch(/animation:\s*bentoFloat/);
  });
  test("phones shrink the mockups", () => {
    expect(css).toMatch(/@media \(max-width: 767px\) \{\n  \.mock \{ scale: 0\.85; \}/);
  });
  test("no GSAP and no transition-all", () => {
    expect(tsx).not.toMatch(/gsap/i);
    expect(css).not.toContain("transition: all");
  });
});

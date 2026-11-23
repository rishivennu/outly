/** R1310 Creator Hub "Round up" redesign: shared youtubeId, mixed-type headline pieces, carousel a11y, marquee reduced-motion, pink primary. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { youtubeId } from "../lib/workshops/core";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const page = read("app/(marketing)/workshops/page.tsx");
const detail = read("app/(marketing)/workshops/[slug]/page.tsx");
const card = read("components/workshops/WorkshopCard.tsx");
const reg = read("components/workshops/RegisterCard.tsx");
const rail = read("components/workshops/Carousel.tsx");
const css = read("components/workshops/workshops.module.css");

describe("youtubeId", () => {
  test("accepts watch, short, live, embed, shorts and nocookie links; rejects the rest", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ?t=10")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://vimeo.com/12345")).toBeNull();
    expect(youtubeId("https://www.youtube.com/watch?v=<script>")).toBeNull();
    expect(youtubeId("not a url")).toBeNull();
  });
});

describe("mixed-type headline", () => {
  test("one h1 built from chunky, pixel, outline and soft words; the outline word duplicates itself with alt-less generated content", () => {
    expect(page.match(/<h1/g)?.length).toBe(1);
    for (const k of ["s.chunky", "pixelFont.className", "s.outline", "s.soft"]) expect(page).toContain(k);
    expect(page).toMatch(/data-text="workshops"/);
    expect(css).toMatch(/\.outline::before \{[^}]*content: attr\(data-text\) \/ ""/);
    expect(detail).toMatch(/data-text=\{tail\}/);
    expect(detail.match(/<h1/g)?.length).toBe(1);
  });
  test("the pixel face is loaded once from next/font and only where it renders", () => {
    const fonts = read("components/workshops/fonts.ts");
    expect(fonts).toContain('from "next/font/google"');
    expect(fonts).toContain("preload: false");
    expect(read("app/layout.tsx")).not.toContain("Silkscreen");
  });
  test("the giant wordmark is decorative and has a text twin", () => {
    expect(page).toMatch(/<p aria-hidden="true" className="whitespace-nowrap[^>]*>\s*<span className=\{s\.chunky\}>creator/);
    expect(page).toContain('<p className="sr-only">Creator workshops</p>');
  });
});

describe("rail, strips, cards", () => {
  test("carousel is a scroll-snap list with named arrow buttons that disable at the ends", () => {
    expect(rail).toContain('"use client"');
    expect(rail).toContain('aria-label="Previous sessions"');
    expect(rail).toContain('aria-label="Next sessions"');
    expect(rail).toMatch(/disabled=\{at === "start"\}/);
    expect(rail).toMatch(/disabled=\{at === "end"\}/);
    expect(css).toMatch(/\.rail \{[^}]*scroll-snap-type: x mandatory/);
    expect(css).toMatch(/\.rail > li \{[^}]*scroll-snap-align: start/);
    expect(page).toContain('<Carousel label="Upcoming sessions">');
  });
  test("marquee strips stop under reduced motion and carry an sr-only sentence", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.track \{ animation: none; \} \}/);
    expect(page).toMatch(/<p className="sr-only">\{say\}<\/p>/);
    expect(page).toMatch(/<div className=\{s\.track\} aria-hidden="true">/);
  });
  test("cards: whole card is the link, white pill is a span, date label is mono and labelled for AT", () => {
    expect(card).toMatch(/<Link\s+href=\{`\/workshops\/\$\{w\.slug\}`\}/);
    expect(card).not.toMatch(/<button/);
    expect(card).toContain('<span className="sr-only">When: </span>');
    expect(card).toContain("s.whiteBtn");
    expect(card).toMatch(/const TINTS = \[s\.sun, s\.pink, s\.sky, s\.mint\]/);
  });
  test("primary action is the pink pill with dark ink (contrast), on the card and on the page", () => {
    expect(css).toMatch(/\.pinkBtn \{ background: hsl\(var\(--pink\)\); color: hsl\(240 10% 6%\); \}/);
    expect(reg).toContain("const PRIMARY = cn(BTN, s.pinkBtn");
    expect(page).toContain("cn(PILL, s.pinkBtn)");
  });
  test("page wash and band: grid paper on light, dark variant, band flips the ink variable", () => {
    expect(css).toMatch(/\.page \{[^}]*background-size: 28px 28px/);
    expect(css).toMatch(/:global\(\.dark\) \.page \{[^}]*--ws-line: hsl\(0 0% 100% \/ \.045\)/);
    expect(css).toMatch(/\.band \{ --ws-ink: hsl\(40 33% 95%\)/);
    expect(page).toContain("https://i.ytimg.com/vi/");
    expect(page).toContain("unoptimized");
  });
  test("replay embed on the detail page still uses youtube-nocookie through the shared helper", () => {
    expect(detail).toContain('import { LEVEL_LABEL, fmtWhen, youtubeId } from "@/lib/workshops/core"');
    expect(detail).toContain("https://www.youtube-nocookie.com/embed/");
    expect(detail).not.toMatch(/function youtubeId/);
  });
});

describe("admin page switches (R1310)", () => {
  test("pages default on; hiddenAnchors carries the off switches as menu gate tokens the middleware regex accepts", async () => {
    const { LANDING_DEFAULT, PUBLIC_PAGES, hiddenAnchors, pageOn } = await import("../lib/landing");
    expect(PUBLIC_PAGES.map((p) => p.id)).toEqual(["workshops", "resources"]);
    expect(LANDING_DEFAULT.pages).toEqual({ workshops: true, resources: true });
    expect(pageOn(LANDING_DEFAULT, "workshops")).toBe(true);
    expect(pageOn({ pages: {} } as any, "workshops")).toBe(true);
    expect(pageOn({ ...LANDING_DEFAULT, pages: { ...LANDING_DEFAULT.pages, workshops: false } }, "workshops")).toBe(false);
    expect(hiddenAnchors(LANDING_DEFAULT)).toEqual([]);
    const off = hiddenAnchors({ ...LANDING_DEFAULT, pages: { workshops: false, resources: false } });
    expect(off).toEqual(["workshops", "resources"]);
    for (const t of off) expect(t).toMatch(/^[a-z]{1,20}$/);
  });
  test("nav gates, API accepts pages, public pages 404 and leave the sitemap when off, admin shows the switch", () => {
    const nav = read("components/marketing/LiquidNav.tsx");
    expect(nav).toContain('gate: "workshops"');
    expect(nav).toContain('gate: "resources"');
    expect(nav).toMatch(/\(!n\.gate \|\| !hidden\.has\(n\.gate\)\)/);
    expect(read("app/api/admin/landing/route.ts")).toContain("pages: flags(PUBLIC_PAGES.map((p) => p.id))");
    expect(page).toMatch(/if \(!\(await pageEnabled\(\)\)\) notFound\(\);/);
    expect(detail).toMatch(/\(await enabled\(\)\) \? getWorkshop\(slug, await viewer\(\)\) : null/);
    const sm = read("app/sitemap.ts");
    expect(sm).toContain('if (!pageOn(await getConfig("landing"), "workshops")) return [];');
    expect(sm.match(/\$\{BASE\}\/workshops`/g)?.length).toBe(1);
    expect(read("app/admin/(panel)/workshops/page.tsx")).toContain('<PublicPageToggles initial={{ pages: landing.pages }} canEdit={can(admin.role, "site")} />');
    expect(read("app/admin/(panel)/landing/page.tsx")).toContain("<PublicPageToggles");
    const t = read("components/admin/PublicPageToggles.tsx");
    expect(t).toContain('"/api/admin/landing", { method: "PUT", json: { pages: { [id]: v } } }');
    expect(t).toContain("<SwitchRow");
  });
});

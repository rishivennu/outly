// R1282 public /partners page: copy, metadata, the scrubbed hero contract, art layers and the nav, footer and sitemap links.
// R1302 moved the hero to the clasped handshake (CONTACT/SWAP, the clasp wrapper, the meet timeline); the motion and art
// assertions below pin that contract, the copy and page checks are unchanged.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const page = read("app/(marketing)/partners/page.tsx");
const hero = read("components/partners/Hero.tsx");
const art = read("components/partners/HeroArt.tsx");
const css = read("components/partners/hero.module.css");
const sections = read("components/partners/Sections.tsx");
const nav = read("components/marketing/Nav.tsx");
const footer = read("components/marketing/Footer.tsx");
const sitemap = read("app/sitemap.ts");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("R1282 /partners metadata", () => {
  test("title, description, canonical, open graph and robots", () => {
    expect(page).toContain('"Partner With Outlly | Creator & Influencer Partnerships"');
    expect(flat(page)).toContain(
      "Partner with Outlly as a content creator or influencer. Apply for paid collaborations, complimentary subscriptions, and opportunities to grow with Outlly.",
    );
    expect(page).toContain('alternates: { canonical: "/partners" }');
    expect(page).toContain('url: "/partners"');
    expect(page).toContain("robots: { index: true, follow: true }");
    expect(page).toContain("title: { absolute: TITLE }");
  });
  test("the page is a server component", () => {
    expect(page).not.toContain('"use client"');
  });
});

describe("R1282 hero copy", () => {
  const h = flat(hero);
  test("headline is the h1", () => {
    expect(h).toMatch(/<h1 [^>]*>\s*Let&apos;s grow together\.\s*<\/h1>/);
  });
  test("sub-headline and description", () => {
    expect(h).toContain("Create content. Share Outlly. Get rewarded.");
    expect(h).toContain(
      "We partner with creators who love discovering useful tools and sharing them with their audience. Whether you have 1,000 followers or 100,000, we&apos;d love to hear from you.",
    );
  });
  test("CTAs are real links to #apply and #how", () => {
    expect(h).toMatch(/<a href="#apply"[^>]*>\s*Apply for Partnership/);
    expect(h).toMatch(/<a href="#how"[^>]*>\s*How it works/);
  });
  test("icon row has its sr-only label and decorative icons", () => {
    expect(h).toContain('<span className="sr-only">Creators on Instagram, YouTube, TikTok and X</span>');
    for (const i of ["Instagram", "Youtube", "Music2", "Twitter", "Globe"]) expect(h).toContain(`<${i} aria-hidden="true" />`);
  });
  test("no em-dashes or emoji in the page copy", () => {
    for (const s of [hero, sections, page]) {
      expect(s).not.toContain("\u2014");
      expect(s).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("R1282 hero motion contract", () => {
  test("one scrubbed timeline over the section, linear eases", () => {
    expect(hero).toContain('start: "top top", end: "bottom bottom", scrub: 0.6');
    expect(hero).toContain('ease: "none"');
    expect(hero).toContain("useGSAP(");
    expect(hero).toContain("{ scope: root }");
    expect(hero).toContain("gsap.registerPlugin(ScrollTrigger, useGSAP)");
  });
  test("matchMedia splits motion from the reduced-motion end state", () => {
    expect(hero).toContain("gsap.matchMedia()");
    expect(hero).toContain("mm.add(MOTION_OK");
    expect(hero).toContain('"(prefers-reduced-motion: reduce)"');
    expect(hero).toMatch(/mm\.add\(REDUCED[\s\S]*gsap\.set\(left[\s\S]*gsap\.set\(right[\s\S]*gsap\.set\(shake, \{ opacity: 1 \}\)[\s\S]*gsap\.set\(orb, \{ opacity: 0 \}\)/);
  });
  test("tween targets match the brief (R1302: hands meet at CONTACT and cross-fade into the clasp)", () => {
    expect(hero).toContain("const CONTACT = 0.55;");
    expect(hero).toContain("const SWAP = { at: CONTACT - 0.02, duration: 0.06 };");
    expect(hero).toContain("const CLASP = { scale: 0.88, lap: 0.12 };");
    expect(hero).toContain("left: { x: 0, y: 0, xPercent: -14, yPercent: 0, rotation: -5, scale: 1 }");
    expect(hero).toContain("right: { x: 0, y: 0, xPercent: 14, yPercent: 0, rotation: 5, scale: 1 }");
    expect(hero).toContain('rotation: 0, scale: CLASP.scale, duration: CONTACT, ease: "power2.inOut" }, 0)');
    expect(hero).toContain(".fromTo(shake, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: SWAP.duration }, SWAP.at)");
    expect(hero).toContain('{ yPercent: -10, scale: 0.5, rotation: 26, opacity: 0, duration: CONTACT - 0.08, ease: "power1.in" }, 0.08)');
    expect(hero).toContain("{ opacity: 0, y: -48, duration: 0.3 }, 0.2"); // R1303: fully out before SWAP
  });
  test("refresh after fonts settle, no pin (CSS sticky stage instead)", () => {
    expect(hero).toContain("document.fonts?.ready.then(");
    expect(hero).toContain("ScrollTrigger.refresh()");
    expect(hero).not.toMatch(/\bpin:/);
    expect(css).toMatch(/\.stage \{[^}]*position: sticky;[^}]*top: 0;[^}]*height: 100dvh;/);
  });
  test("section height is 160vh on phones and 200vh from md", () => {
    expect(css).toMatch(/\.hero \{[^}]*height: 160vh;/);
    expect(css).toMatch(/@media \(min-width: 768px\) \{\s*\.hero \{ height: 200vh;/);
  });
  test("no layout properties are tweened", () => {
    for (const p of ["width:", "height:", "top:", "left:", "margin"]) expect(hero.split("useGSAP(")[1].split("return (")[0]).not.toContain(` ${p}`);
  });
  test("pointer parallax: fine pointers only, quickTo per plane, listeners removed on cleanup", () => {
    expect(hero).toContain('window.matchMedia("(pointer: fine)")');
    expect((hero.match(/gsap\.quickTo\(/g) ?? []).length).toBe(2);
    expect(hero).toContain('el.addEventListener("pointermove", onMove, { passive: true })');
    expect(hero).toContain('el.removeEventListener("pointermove", onMove)');
    expect(hero.split("mm.add(REDUCED")[1]).not.toContain("pointermove");
  });
  test("will-change only on the moving layers", () => {
    const owners = [...css.matchAll(/\.(\w+) \{[^}]*will-change: transform(?:, opacity)?;/g)].map((m) => m[1]).sort();
    expect(owners).toEqual(["burst", "clasp", "halo", "hand", "orb", "shake"]);
    expect(hero).not.toContain("will-change");
    expect(art).not.toContain("will-change");
  });
  test("idle rotation is CSS and stops for reduced motion", () => {
    expect(css).toContain("animation: heroSpin 28s ease-in-out infinite;");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.stone \{ animation: none; \}/);
  });
});

describe("R1282 hero art", () => {
  test("art is decorative and the layers are separate elements", () => {
    expect(art).toContain('<div className={s.art} aria-hidden="true">');
    for (const k of ["halo", "left", "right", "orb", "clasp", "shake", "burst"]) expect(art).toContain(`data-hero="${k}"`);
    expect(art.match(/alt=""/g)?.length).toBe(4);
  });
  test.each([
    ["hand-robot.svg", 'viewBox="0 0 1104 936"'],
    ["hand-human.svg", 'viewBox="0 0 1000 776"'],
  ])("%s exists, is a halftone extracted from the reference and stays under 120 KB", (f, vb) => {
    const p = `public/partners/${f}`;
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeLessThan(120 * 1024);
    const svg = read(p);
    expect(svg).toContain(vb);
    expect((svg.match(/<circle /g) ?? []).length).toBeGreaterThan(500);
    expect(svg).not.toMatch(/<rect[^>]*fill="#(?:0|f)/i);
  });
  test("the stone is the extracted object, re-coloured, under 200 KB, and the art declares its intrinsic sizes", () => {
    expect(existsSync("public/partners/object.webp")).toBe(true);
    expect(statSync("public/partners/object.webp").size).toBeLessThan(200 * 1024);
    expect(art).toContain('src="/partners/object.webp" alt="" width={480} height={576}');
    expect(art).toContain("width={1104} height={936}");
    expect(art).toContain("width={1000} height={776}");
    expect(css).toContain("aspect-ratio: 1104 / 936;");
    expect(css).toContain("aspect-ratio: 1000 / 776;");
  });
  test("hero is near-black in both themes and the copy holds contrast", () => {
    expect(css).toContain("--hero-bg: #080808;");
    expect(css).toContain("--hero-copy: #e6e6e6;");
    expect(css).toContain("color-scheme: dark;");
    expect(css).toMatch(/\.primary:focus-visible,\s*\.secondary:focus-visible \{\s*outline: 2px solid/);
    expect(css).toMatch(/min-height: 2\.75rem;/);
  });
});

describe("R1282 page sections", () => {
  const s = flat(sections);
  test("tiers and their footnote", () => {
    for (const r of ["1K to 5K followers", "5K to 10K followers", "10K+ followers"]) expect(s).toContain(r);
    expect(s).toContain("Tiers are indicative. We review every application on fit, not size.");
    expect(s).toContain("PARTNER_TIER_LABEL[t.tier]");
  });
  test("options and their footnote (R1287: the bento tiles carry them now)", () => {
    const bento = flat(readFileSync("components/partners/Bento.tsx", "utf8"));
    for (const o of ["Paid collaborations", "Complimentary Creator plan", "Track what you earn", "Your portal"]) expect(bento).toContain(o);
    expect(bento).toContain("Every offer is agreed individually after review. Applying does not guarantee payment or a subscription.");
  });
  test("what we look for closes on follower count", () => {
    for (const c of ["Engagement rate", "Average views", "Audience location and age range", "Past brand collaborations", "Ability to demonstrate Outlly"]) expect(s).toContain(c);
    expect(s).toContain("Follower count alone never decides it.");
  });
  test("four steps under id how, no review time promised", () => {
    expect(s).toContain('<section id="how"');
    const titles = [...sections.matchAll(/n: "(0\d)", title: "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(titles).toEqual(["01 Apply", "02 We review", "03 Get your offer", "04 Create and grow"]);
    expect(sections).not.toMatch(/\b\d+\s*(hours?|days?|weeks?|business days)\b/i);
  });
  test("contact band mails the partners inbox", () => {
    expect(s).toContain('href="mailto:partners@outlly.com"');
    expect(s).toContain("Questions first?");
    expect(s).toContain("Write to partners@outlly.com");
  });
  test("ApplyForm renders inside #apply after the steps", () => {
    // R1289: the form gets the signed-in applicant and the section has the short-form headline.
    expect(page).toContain('import ApplyForm, { type ApplyMe } from "@/components/partners/ApplyForm"');
    const apply = page.indexOf('<section id="apply"');
    expect(apply).toBeGreaterThan(page.indexOf("<PartnerSteps />"));
    expect(page.indexOf("<ApplyForm me={me} ")).toBeGreaterThan(apply);
    expect(page.indexOf("<ApplyForm me={me} ")).toBeLessThan(page.indexOf("</section>", apply));
    expect(page).toContain("Let's get you rewarded.");
    expect(existsSync("components/partners/ApplyForm.tsx")).toBe(true);
  });
  test("house radii on the cards (R1287: the tiles are flat colour, no stroke)", () => {
    expect(sections).not.toContain("border-foreground/[0.08]");
    expect(sections).not.toMatch(/border-white|ring-white/);
    const odd = [...sections.matchAll(/rounded-\[(\d+)px\]/g)].map((m) => Number(m[1])).filter((n) => ![24, 16, 12].includes(n));
    expect(odd).toEqual([]);
  });
});

describe("R1282 nav, footer and sitemap", () => {
  test("nav desktop row and phone drawer link to /partners with aria-current", () => {
    expect(nav).toContain('const PARTNERS = { href: "/partners", label: "Partner With Us", short: "Partners" }');
    expect(nav.match(/href=\{PARTNERS\.href\}/g)?.length).toBe(2);
    expect(nav.match(/aria-current=\{pathname === PARTNERS\.href \? "page" : undefined\}/g)?.length).toBe(2);
    expect(nav).toContain('<span className="hidden xl:inline"><FlipText text={PARTNERS.label} /></span>');
  });
  test("partners link sits after FAQ in the desktop row and has no scrollspy hook", () => {
    const row = nav.slice(nav.indexOf('<nav ref={navRef}'), nav.indexOf("</nav>", nav.indexOf('<nav ref={navRef}')));
    const item = row.slice(row.indexOf("href={PARTNERS.href}") - 80);
    expect(item).not.toContain("data-sec");
    expect(row.indexOf("href={PARTNERS.href}")).toBeGreaterThan(row.indexOf("links.map"));
  });
  test("footer Company group leads with it (R1303 regrouped the footer into four short columns)", () => {
    expect(footer).toContain('title: "Company",\n    links: [\n      { href: "/partners", label: "Partner With Us" },');
  });
  test("sitemap has /partners monthly at 0.7", () => {
    expect(sitemap).toContain('{ url: `${BASE}/partners`, lastModified: now, changeFrequency: "monthly", priority: 0.7 }');
  });
});

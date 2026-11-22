// R1302 /partners: the clasped handshake hero (two halftone hands travel in, meet, and cross-fade into the handshake
// artwork while the burst and a short time-based shake play), brand-gradient tiles in every section, and the
// time-based section motion (mockup entrances, scroll lag, pointer parallax) in Motion.tsx.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const hero = read("components/partners/Hero.tsx");
const art = read("components/partners/HeroArt.tsx");
const heroCss = read("components/partners/hero.module.css");
const motion = read("components/partners/Motion.tsx");
const sections = read("components/partners/Sections.tsx");
const sectionsCss = read("components/partners/sections.module.css");
const bento = read("components/partners/Bento.tsx");
const bentoCss = read("components/partners/bento.module.css");

describe("R1302 handshake artwork", () => {
  test("handshake.svg is a halftone of the reference, declares its box and stays under 300 KB", () => {
    const p = "public/partners/handshake.svg";
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeLessThan(300 * 1024);
    const svg = read(p);
    expect(svg).toContain('viewBox="0 0 1362 894"');
    expect((svg.match(/<circle /g) ?? []).length).toBeGreaterThan(3000);
    expect(svg).not.toMatch(/<rect[^>]*fill="#(?:0|f)/i);
    expect(svg).not.toContain("<image");
  });
  test("the art stacks the clasp wrapper (both hands and the handshake) over the stone, with the burst on top", () => {
    const order = ["halo", "orb", "clasp", "left", "right", "shake", "burst"].map((k) => art.indexOf(`data-hero="${k}"`));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(art).toContain('<img data-hero="shake" className={s.shake} src="/partners/handshake.svg" alt="" width={1362} height={894} decoding="async" />');
    expect(art.split('data-hero="shake"')[1].split("/>")[0]).not.toContain("fetchPriority");
    expect(heroCss).toContain("aspect-ratio: 1362 / 894;");
  });
});

describe("R1302 hero motion contract", () => {
  const motionPart = hero.split("mm.add(MOTION_OK")[1].split("mm.add(REDUCED")[0];
  test("the palms meet at CONTACT and the open hands cross-fade into the clasp over SWAP", () => {
    expect(hero).toContain("const CONTACT = 0.55;");
    expect(hero).toContain("const SWAP = { at: CONTACT - 0.02, duration: 0.06 };");
    expect(motionPart).toContain(".fromTo(left, { opacity: 1 }, { opacity: 0, duration: SWAP.duration }, SWAP.at)");
    expect(motionPart).toContain(".fromTo(right, { opacity: 1 }, { opacity: 0, duration: SWAP.duration }, SWAP.at)");
    expect(motionPart).toContain(".fromTo(shake, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: SWAP.duration }, SWAP.at)");
  });
  test("the meeting point is the CSS --clasp-y fraction of the stage, read at refresh time", () => {
    expect(hero).toContain('getComputedStyle(stage).getPropertyValue("--clasp-y")');
    expect(heroCss).toMatch(/\.stage \{\n  --clasp-y: 0\.76;/);
    expect(heroCss).toContain(".stage { --clasp-y: 0.68; }");
    expect(heroCss).toContain("top: calc(var(--clasp-y) * 100%);");
    expect(heroCss).toContain("transform-origin: 50% calc(var(--clasp-y) * 100%);");
    expect(hero).toContain("invalidateOnRefresh: true");
  });
  test("the shake itself is time-based: a paused timeline fired once by a trigger at CONTACT, rewound on the way back", () => {
    expect(motionPart).toContain("const meet = gsap.timeline({ paused: true, delay: 0.3 })");
    expect(motionPart).toContain("start: () => `top+=${Math.round(CONTACT * (el.offsetHeight - stage.offsetHeight))} top`");
    expect(motionPart).toContain("onEnter: () => void meet.restart(true)");
    expect(motionPart).toContain("onLeaveBack: () => void meet.pause(0)");
    expect(motionPart).toContain(".fromTo(burst, { scale: 0.3, opacity: 0 }, { scale: 1.05, opacity: 0.95, duration: 0.22");
    expect(motionPart).toContain('.to(clasp, { y: 0, rotation: 0, duration: 0.32, ease: "power2.out" }, ">")');
    expect(motionPart).toContain("contact.kill();");
    expect(motionPart).toContain("meet.kill();");
    for (const m of motionPart.matchAll(/duration:\s*(\d*\.\d+)\b/g)) expect(+m[1]).toBeLessThanOrEqual(1);
    expect(hero).not.toMatch(/\bpin:/);
    expect(hero).not.toMatch(/["'](back|elastic|bounce)\./);
  });
  test("pointer parallax covers every plane through quickTo and is skipped on coarse pointers", () => {
    expect(motionPart).toContain('const fine = window.matchMedia("(pointer: fine)").matches;');
    for (const k of ["left", "right", "shake", "burst", "orb", "halo"]) expect(motionPart).toMatch(new RegExp(`\\{ el: ${k}, dx: `));
    expect(motionPart).toContain('x: gsap.quickTo(node, "x", opts), y: gsap.quickTo(node, "y", opts)');
  });
  test("reduced motion lands on the clasp: hands hidden at their meeting pose, handshake shown, stone gone", () => {
    const reduced = hero.split("mm.add(REDUCED")[1];
    expect(reduced).toContain("gsap.set(left, { ...endL(), rotation: 0, scale: CLASP.scale, opacity: 0 });");
    expect(reduced).toContain("gsap.set(right, { ...endR(), rotation: 0, scale: CLASP.scale, opacity: 0 });");
    expect(reduced).toContain("gsap.set(shake, { opacity: 1 });");
    expect(reduced).toContain("gsap.set(orb, { opacity: 0 });");
    expect(reduced).toContain('window.addEventListener("resize", rest)');
    expect(reduced).not.toContain("pointermove");
  });
  test("the hero floor is a deep-green gradient over the near-black and the handshake sits under the copy", () => {
    expect(heroCss).toContain("background: radial-gradient(90% 55% at 50% 100%, rgb(23 58 36 / 0.55), transparent 70%), var(--hero-bg);");
    expect(heroCss).toMatch(/\.shake \{[^}]*left: 50%;[^}]*translate: -50% -50%;[^}]*opacity: 0;/);
    expect(heroCss).toMatch(/\.burst \{[^}]*radial-gradient\(closest-side, rgb\(233 255 224 \/ 0\.75\), rgb\(181 255 0 \/ 0\.5\) 22%/);
  });
});

describe("R1302 section tiles", () => {
  test("both tile systems are the same soft brand gradient with a hairline, in the four tones plus night", () => {
    for (const css of [sectionsCss, bentoCss]) {
      expect(css).toMatch(/radial-gradient\(70% 60% at 100% 0%, var\(--(?:t|tile)-glow\), transparent 70%\)/);
      expect(css).toMatch(/linear-gradient\(150deg, var\(--(?:t|tile)-hi\) 0%, var\(--(?:t|tile)-bg\) 46%, var\(--(?:t|tile)-lo\) 100%\)/);
      expect(css).toMatch(/inset 0 0 0 1px color-mix\(in srgb, var\(--(?:t|tile)-ink\) 10%, transparent\)/);
      for (const t of ["mint", "moss", "lime", "deep"]) expect(css).toMatch(new RegExp(`\\n\\.${t} \\{ --(?:t|tile)-bg: #`));
      for (const t of ["lavender", "blush", "butter", "apricot", "sky"]) expect(css).not.toContain(`.${t}`);
      expect(css).not.toMatch(/backdrop-filter/);
    }
    expect(bentoCss).toMatch(/\n\.night \{ --tile-bg: #080808; --tile-ink: #F5F5F5;/);
  });
  test("tiles lift under a fine pointer only when motion is allowed", () => {
    expect(sectionsCss).toMatch(/@media \(hover: hover\) and \(prefers-reduced-motion: no-preference\) \{[^@]*\.tile:hover \{[^}]*translate: 0 -3px;/);
    expect(bentoCss).toMatch(/@media \(hover: hover\) and \(prefers-reduced-motion: no-preference\) \{[^@]*\.tile:hover \{[^}]*translate: 0 -3px;/);
  });
  test("criteria chips cycle the four tones", () => {
    for (let i = 1; i <= 4; i++) expect(sectionsCss).toContain(`.chip:nth-child(4n + ${i})`);
    expect(sectionsCss).toMatch(/\.chip:nth-child\(4n \+ 1\)[^\n]*#e9ffe0/);
    expect(sectionsCss).toMatch(/\.chip:nth-child\(4n \+ 3\)[^\n]*#b5ff00/);
    expect(sectionsCss).toMatch(/\.chip:nth-child\(4n \+ 4\)[^\n]*#173a24/);
  });
  test("the Shorts card reads on the night tile and the inbox avatar is mint", () => {
    expect(bentoCss).toContain(".pShorts { left: 190px; top: 20px; rotate: 6deg; background: #fff; color: #080808; }");
    expect(bentoCss).toContain(".avatarMint { background: #E9FFE0; color: #173A24; }");
    expect(bento).toContain('tone: "mint" },');
    expect(bento).toContain("s.avatarMint");
    expect(bento).not.toContain("avatarBlush");
  });
});

describe("R1302 section motion (Motion.tsx)", () => {
  test("client component, mounted once per section by the server components, which stay free of GSAP", () => {
    expect(motion.startsWith('"use client";')).toBe(true);
    expect(motion).toContain("export function PartnersMotion({ root }: { root: string })");
    expect(sections).toContain('import { PartnersMotion } from "./Motion";');
    expect(sections).toContain('<PartnersMotion root="who" />');
    expect(bento).toContain('import { PartnersMotion } from "./Motion";');
    expect(bento).toContain('<PartnersMotion root="what" />');
    for (const s of [sections, bento]) expect(s).not.toMatch(/gsap|ScrollTrigger|useGSAP|"use client"/);
  });
  test("time-based only: token ease, matchMedia gate, entrances once at 85%, lag from velocity, never a scrub", () => {
    expect(motion).toContain("import { MOTION_OK, simple } from \"@/lib/motion/prefs\";");
    expect(motion).toContain("const EASE = GSAP_EASE.out;");
    expect(motion).toContain("mm.add(MOTION_OK, () => {");
    expect(motion).toContain('ScrollTrigger.create({ trigger, start: "top 85%", once: true, onEnter: () => void tl.play() })');
    expect(motion).toContain("self.getVelocity()");
    expect(motion).not.toMatch(/scrub:/);
    expect(motion).not.toMatch(/\bpin:/);
    expect(motion).not.toMatch(/["'](back|elastic|bounce)\./);
    for (const m of motion.matchAll(/duration:\s*(\d*\.\d+)\b/g)) expect(+m[1]).toBeLessThanOrEqual(0.7);
    expect(motion).toContain('window.matchMedia("(pointer: fine)").matches && !simple()');
    expect(motion).toContain("clearProps: CLEAR");
  });
  test("every mockup kind in the markup has an entrance, and the pieces it animates exist", () => {
    const kinds = [...(sections + bento).matchAll(/data-anim="(\w+)"/g)].map((m) => m[1]).sort();
    expect(kinds).toEqual(["creator", "fan", "inbox", "offer", "phone", "plan", "wallet"]);
    for (const k of kinds) expect(motion).toContain(`case "${k}":`);
    const pieces = new Set([...(sections + bento).matchAll(/data-p="(\w+)"/g)].map((m) => m[1]));
    for (const p of [...motion.matchAll(/pieces\(root, "(\w+)"\)/g)].map((m) => m[1])) expect(pieces.has(p)).toBe(true);
    expect(sections).toContain('<div className={s.stage} aria-hidden="true" data-anim="creator">');
    expect(sections).toMatch(/<article\n\s+className=\{cn\(s\.tile, s\.tierTile, s\[t\.tone\]\)\}[\s\S]*?data-tile\n\s+data-tilt\n\s+>/);
  });
  test("the idle float stays CSS and the entrance clears its inline transform so the two never fight", () => {
    expect(bentoCss).toContain(".float { animation: bentoFloat 6s ease-in-out infinite; }");
    expect(motion).toContain('const CLEAR = "transform,opacity";');
    expect(motion).toContain("gsap.set(all, { clearProps: CLEAR });");
  });
});

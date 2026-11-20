/**
 * R1285: one Outlly identity. OutllyBrand (icon | compact | full) is the only logo implementation; every brand slot
 * renders it, the rocket art is never stretched, and the accessible name "Outlly" is given exactly once.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COMPACT_BELOW, MARK_EM, OutllyBrand, OutllyLogoIcon, OutllyWordmark, OutlyLogo, OutlyMark } from "@/components/brand/OutllyBrand";

const src = (p: string) => readFileSync(p, "utf8");
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const imgs = (html: string) => [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
const count = (s: string, needle: string) => s.split(needle).length - 1;

/** Width x height of a PNG or WebP (VP8, VP8L, VP8X) from its header. */
function dims(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  if (b.toString("ascii", 1, 4) === "PNG") return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.toString("ascii", 0, 4) === "GIF8") return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (kind === "VP8L") {
    const v = b.readUInt32LE(21);
    return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  throw new Error(`unknown image ${path}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(n)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}
const SOURCES = ["components", "app", "lib"].flatMap((d) => walk(d));

describe("OutllyBrand API", () => {
  test("full: rocket + wordmark, named once, art decorative", () => {
    const html = render(createElement(OutllyBrand));
    expect(count(html, 'aria-label="Outlly"')).toBe(1);
    expect(html).toContain('role="img"');
    expect(html).toContain(">outlly</span>");
    const art = imgs(html);
    expect(art.length).toBe(2); // tone auto: both theme copies, CSS shows one
    for (const i of art) {
      expect(i).toContain('alt=""');
      expect(i).toContain('aria-hidden="true"');
      expect(i).toContain("object-contain");
    }
    expect(art[0]).toContain("dark:hidden");
    expect(art[1]).toContain("hidden dark:block");
  });

  test("full without size follows the text; with size the wordmark is sized from the rocket", () => {
    expect(render(createElement(OutllyBrand))).toContain("text-[1.15em]");
    const html = render(createElement(OutllyBrand, { size: 30 }));
    expect(html).not.toContain("text-[1.15em]");
    expect(html).toContain(`font-size:${30 / MARK_EM}px`);
    expect(html).toContain(`--mk:${MARK_EM}em`);
    expect(MARK_EM).toBe(1.08);
  });

  test("tone pins one copy", () => {
    const dark = imgs(render(createElement(OutllyBrand, { tone: "dark" })));
    expect(dark.length).toBe(1);
    expect(dark[0]).toContain("/brand/rocket/rocket-96.webp");
    const light = imgs(render(createElement(OutllyBrand, { tone: "light", size: 64 })));
    expect(light[0]).toContain("/brand/rocket/rocket-lime-ink-256.webp");
  });

  test("compact = rocket alone in a 44px slot; icon = bare rocket; neither has the wordmark", () => {
    const compact = render(createElement(OutllyBrand, { variant: "compact" }));
    expect(compact).toContain("h-11 min-w-11");
    expect(compact).not.toContain("outlly<");
    expect(compact).toContain('width="26" height="26"');
    const icon = render(createElement(OutllyBrand, { variant: "icon", size: 22 }));
    expect(icon).not.toContain("h-11");
    expect(icon).not.toContain("outlly<");
    expect(icon).toContain('width="22" height="22"');
    expect(count(icon, 'aria-label="Outlly"')).toBe(1);
  });

  test("label={false} hides it from assistive tech", () => {
    const html = render(createElement(OutllyBrand, { label: false }));
    expect(html).not.toContain("aria-label");
    expect(html.startsWith('<span class="inline-flex" aria-hidden="true">')).toBe(true);
  });

  test("href wraps it in one named link, the lockup inside is decorative", () => {
    const html = render(createElement(OutllyBrand, { href: "/" }));
    expect(html.startsWith("<a ")).toBe(true);
    expect(html).toContain('href="/"');
    expect(count(html, 'aria-label="Outlly"')).toBe(1);
    expect(html).not.toContain('role="img"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("focus-visible:outline");
  });

  test("compactBelow hides only the wordmark under the width, with a static class", () => {
    expect(Object.keys(COMPACT_BELOW)).toEqual(["360", "400", "480", "640"]);
    const html = render(createElement(OutllyBrand, { compactBelow: 360 }));
    expect(html).toContain('<span class="font-display font-bold tracking-[-0.045em] max-[360px]:hidden">outlly</span>');
    for (const cls of Object.values(COMPACT_BELOW)) expect(src("components/brand/Logo.tsx")).toContain(`"${cls}"`);
  });

  test("parts and legacy names", () => {
    expect(render(createElement(OutllyWordmark))).toBe('<span class="font-display font-bold tracking-[-0.045em]">outlly</span>');
    expect(imgs(render(createElement(OutllyLogoIcon, { size: 22 }))).length).toBe(2);
    // OutlyLogo is the full lockup; label={false} keeps its old meaning (rocket only)
    expect(render(createElement(OutlyLogo))).toBe(render(createElement(OutllyBrand)));
    expect(render(createElement(OutlyLogo, { label: false, size: 20 }))).toBe(render(createElement(OutlyMark, { size: 20 })));
    expect(render(createElement(OutlyLogo, { compactBelow: 400 }))).toContain("max-[400px]:hidden");
  });
});

describe("every brand slot uses the system", () => {
  test("public site header and footer", () => {
    expect(src("components/marketing/Nav.tsx")).toContain('<OutlyLogo className="text-[17.4px]" compactBelow={360} />');
    expect(src("components/marketing/Footer.tsx")).toContain("<OutlyLogo size={28}");
    expect(src("components/brand/Logo.tsx")).toContain('return <OutllyBrand variant="full" tone={tone} className={className} compactBelow={compactBelow} />;');
  });

  test("sign in / sign up: one lockup per viewport", () => {
    const form = src("components/auth/AuthForm.tsx");
    expect(count(form, '<div className="gs-in mb-4 flex lg:hidden [@media(max-height:800px)]:hidden"><OutllyBrand variant="full" size={30} /></div>')).toBe(1);
    expect(count(form, '<div className="mb-4 flex lg:hidden [@media(max-height:800px)]:hidden"><OutllyBrand variant="full" size={30} /></div>')).toBe(1);
    expect(form).not.toContain("OutlyMark");
    const show = src("components/auth/AuthShowcase.tsx");
    expect(show).toContain('<OutllyBrand variant="full" size={36} tone="dark" label={false} className="as-mark gs-in self-start" />');
    expect(show).toMatch(/className="gs-stage relative isolate hidden [^"]*lg:flex/); // the panel only exists where the form hides its lockup
    expect(show).not.toContain("rotation: -20");
    expect(show).not.toContain("OutlyMark");
  });

  test("studio desktop rail", () => {
    const rail = src("components/shell/PulseRail.tsx");
    expect(rail).toContain("<OutllyLogoIcon size={22} />");
    expect(rail).toContain('<OutllyWordmark className="rail-label rail-word" />');
    expect(rail).not.toContain(">outlly<");
  });

  test("admin desktop sidebar and drawer", () => {
    const shell = src("components/admin/AdminShell.tsx");
    expect(shell).toContain('<OutllyBrand variant={slim ? "icon" : "full"} size={slim ? 26 : undefined} label={false} />');
    expect(shell).toContain('<OutllyBrand variant="full" />');
    expect(shell).toContain('slim ? "w-[72px]" : "w-[248px]"'); // sidebar dimensions unchanged
    expect(shell).not.toContain("<OutlyLogo");
  });

  test("PWA welcome uses the lockup, not a hand-typed name", () => {
    const pw = src("components/shell/PwaWelcome.tsx");
    expect(pw).toContain('<OutllyBrand variant="full" className="pw-brand" />');
    expect(pw).not.toContain("OutlyMark");
  });

  test("no raw rocket art outside components/brand, the emails and the invoice PDF", () => {
    const allowed = new Set(["components/brand/Logo.tsx", "lib/email/index.ts", "lib/billing/invoice-art.ts"]);
    const offenders = SOURCES.filter((f) => !allowed.has(f) && src(f).includes("/brand/rocket/"));
    expect(offenders).toEqual([]);
  });

  test("no hand-typed lockups: the lowercase wordmark text lives only in the brand system", () => {
    const allowed = new Set(["components/brand/Logo.tsx", "app/(marketing)/opengraph-image.tsx"]); // OG image: satori draws plain markup
    const offenders = SOURCES.filter((f) => f.endsWith(".tsx") && !allowed.has(f) && />\s*outlly\s*</.test(src(f)));
    expect(offenders).toEqual([]);
  });

  test("nothing stretches an image", () => {
    const offenders = SOURCES.filter((f) => /object-fill\b|object-fit:\s*fill|objectFit:\s*["']fill/.test(src(f)));
    expect(offenders).toEqual([]);
    expect(src("components/admin/FoundingPanel.tsx")).toContain('width={48} height={48} className="h-12 w-12 shrink-0 object-contain"');
  });
});

describe("assets", () => {
  test("every rocket file is square, so width = height never distorts it", () => {
    const dir = "public/brand/rocket";
    for (const f of readdirSync(dir)) {
      const { w, h } = dims(join(dir, f));
      expect(w, f).toBe(h);
    }
  });

  test("favicon and app icons are the rocket, square, and the old mark is gone", () => {
    expect(existsSync("app/icon.svg")).toBe(false);
    expect(dims("app/icon.png")).toEqual({ w: 96, h: 96 });
    expect(dims("app/apple-icon.png")).toEqual({ w: 180, h: 180 });
    for (const [f, s] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-512-maskable.png", 512]] as const) expect(dims(`public/brand/app/${f}`)).toEqual({ w: s, h: s });
    for (const m of ["app/manifest.ts", "app/admin.webmanifest/route.ts"]) {
      const s = src(m);
      expect(s).toContain('iconUrl("/brand/app/icon-192.png"), sizes: "192x192"');
      expect(s).toContain('iconUrl("/brand/app/icon-512-maskable.png"), sizes: "512x512"');
    }
  });

  test("email wordmark keeps its ratio and its alt text", () => {
    const { w, h } = dims("public/brand/email/retro/wordmark.png");
    const tag = /<img class="wm"[^>]*>/.exec(src("lib/email/index.ts"))?.[0] ?? "";
    expect(tag).toContain('alt="Outlly"');
    expect(tag).toContain("height:auto");
    const aw = Number(/width="(\d+)"/.exec(tag)?.[1]);
    const ah = Number(/height="(\d+)"/.exec(tag)?.[1]);
    expect(Math.abs(aw / ah - w / h) / (w / h)).toBeLessThan(0.01);
    const mark = /<img src="\$\{appUrl\(\)\}\/brand\/rocket\/mark-anim\.gif"[^>]*>/.exec(src("lib/email/index.ts"))?.[0] ?? "";
    expect(mark).toContain('width="26" height="26" alt=""');
    expect(dims("public/brand/rocket/mark-anim.gif")).toEqual({ w: 96, h: 96 });
  });

  test("brand doc exists and is linked", () => {
    expect(src("docs/brand.md")).toContain("OutllyBrand");
    expect(src("README.md")).toContain("docs/brand.md");
  });
});

/**
 * R1259: platform logos sit straight on their parent's background. PlatformOrb paints no orb, no hairline and no ring
 * of its own; every platform renders its official mark; surface picks the reversed X, TikTok and Threads marks.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PLATFORMS } from "@/lib/domain";
import { ORB_FIT, PlatformGlyph, PlatformOrb } from "@/components/shared/PlatformIcon";
import { PlatformLogo } from "@/components/brand/brands";

const wrapperClass = (html: string) => /^<span class="([^"]*)"/.exec(html)?.[1] ?? "";
const srcs = (html: string) => [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);

describe("PlatformOrb", () => {
  for (const p of PLATFORMS) {
    test(`${p}: transparent box, logo inside`, () => {
      for (const props of [{}, { ring: true }, { square: true }]) {
        const html = renderToStaticMarkup(createElement(PlatformOrb, { platform: p, size: 32, ...props }));
        const cls = wrapperClass(html);
        expect(cls).toContain("inline-grid");
        expect(cls).not.toMatch(/\bbg-/);
        expect(cls).not.toMatch(/\bshadow/);
        expect(cls).not.toMatch(/\bring-/);
        expect(html).toContain("width:32px;height:32px");
        expect(html).toContain(`/brand/logos/${p}`);
        expect(html).toContain("object-contain");
      }
    });
  }

  test("fit table keeps open marks at least as large as the tiles", () => {
    expect(ORB_FIT.x).toBeGreaterThanOrEqual(ORB_FIT.instagram);
    expect(ORB_FIT.tiktok).toBeGreaterThanOrEqual(ORB_FIT.instagram);
    for (const p of PLATFORMS) expect(ORB_FIT[p]).toBeLessThanOrEqual(1);
  });

  test("surface reaches the logo", () => {
    expect(srcs(renderToStaticMarkup(createElement(PlatformOrb, { platform: "x", surface: "dark" })))).toEqual(["/brand/logos/x-dark.webp"]);
    expect(srcs(renderToStaticMarkup(createElement(PlatformOrb, { platform: "x", surface: "light" })))).toEqual(["/brand/logos/x.webp"]);
  });
});

describe("PlatformGlyph and PlatformLogo", () => {
  for (const p of PLATFORMS) {
    test(`${p}: renders the mark`, () => {
      const html = renderToStaticMarkup(createElement(PlatformGlyph, { platform: p, className: "h-5 w-5" }));
      expect(html).toMatch(/<img[^>]+src="\/brand\/logos\//);
    });
  }

  test("auto follows the theme, inverse is the opposite", () => {
    const auto = renderToStaticMarkup(createElement(PlatformLogo, { platform: "tiktok" }));
    expect(auto).toMatch(/src="\/brand\/logos\/tiktok\.webp"[^>]*dark:hidden/);
    expect(auto).toMatch(/src="\/brand\/logos\/tiktok-dark\.webp"[^>]*hidden dark:inline-block/);
    const inv = renderToStaticMarkup(createElement(PlatformLogo, { platform: "tiktok", surface: "inverse" }));
    expect(inv).toMatch(/src="\/brand\/logos\/tiktok-dark\.webp"[^>]*dark:hidden/);
    expect(inv).toMatch(/src="\/brand\/logos\/tiktok\.webp"[^>]*hidden dark:inline-block/);
    expect(srcs(renderToStaticMarkup(createElement(PlatformLogo, { platform: "instagram", surface: "inverse" })))).toEqual(["/brand/logos/instagram.webp"]);
  });
});

/** Files that may keep a white plate behind a logo, and why. */
const ALLOW = new Set([
  // AppIcon is the home-screen tile metaphor (marketing comparisons, final CTA): the white tile is the icon itself.
  "components/brand/brands.tsx",
]);

function tsx(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? tsx(p) : p.endsWith(".tsx") ? [p.replace(/\\/g, "/")] : [];
  });
}

describe("no white box behind a platform logo", () => {
  test("no bg-white within 120 chars of a logo", () => {
    const hits: string[] = [];
    for (const f of tsx("components")) {
      if (ALLOW.has(f)) continue;
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/<(PlatformLogo|PlatformGlyph|PlatformOrb)\b/g)) {
        const near = s.slice(Math.max(0, m.index! - 120), m.index! + m[0].length + 120);
        if (/\bbg-white\b/.test(near)) hits.push(`${f}:${s.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test("studio callers use the shared mark, not the app-icon tile", () => {
    for (const f of ["components/shell/SendingPill.tsx", "components/admin/users/CustomerOverview.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toContain("AppIcon");
      expect(s).toContain("<PlatformOrb");
    }
  });

  test("dark-in-both-themes cards ask for the reversed marks", () => {
    const pv = readFileSync("components/create/PublishingView.tsx", "utf8");
    expect(pv).toContain('<PlatformOrb platform={t.platform} size={18} surface="dark" />');
    expect(readFileSync("components/home/SendingNow.tsx", "utf8")).toContain('ring surface="dark"');
    expect(readFileSync("components/marketing/HeroFan.tsx", "utf8")).not.toContain("bg-white/90");
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { FONT_SETS, FONT_SET_IDS, FONTS_DEFAULT, fontCss, normalizeFonts } from "@/lib/fonts";

describe("site fonts (1046)", () => {
  test("seven sets, original by default", () => {
    expect(FONT_SET_IDS).toEqual(["current", "classic", "apple", "gopher", "jakarta", "editorial", "poster"]);
    expect(FONT_SETS.map((f) => f.id)).toEqual([...FONT_SET_IDS]);
    expect(FONTS_DEFAULT.set).toBe("current");
  });

  test("normalize rejects unknown values", () => {
    expect(normalizeFonts({ set: "apple" }).set).toBe("apple");
    expect(normalizeFonts({ set: "comic-sans" }).set).toBe("current");
    expect(normalizeFonts(null).set).toBe("current");
    expect(normalizeFonts({ set: 3 }).set).toBe("current");
  });

  test("original set adds no override", () => {
    expect(fontCss({ set: "current" })).toBe("");
  });

  test("apple uses the SF / New York system stack, no web font", () => {
    const css = fontCss({ set: "apple" });
    expect(css).toContain(":root:root{--font-display:-apple-system");
    expect(css).toContain('"SF Pro Display"');
    expect(css).toContain('"SF Pro Text"');
    expect(css).toContain("ui-serif");
    expect(css).not.toContain("url(");
  });

  test("gopher points every role at the Go fonts", () => {
    const css = fontCss({ set: "gopher" });
    for (const role of ["display", "body", "serif"]) expect(css).toContain(`--font-${role}:var(--font-gopher)`);
  });

  test("jakarta uses Plus Jakarta Sans with a Fraunces accent", () => {
    const css = fontCss({ set: "jakarta" });
    expect(css).toContain("--font-display:var(--font-jakarta)");
    expect(css).toContain("--font-body:var(--font-jakarta)");
    expect(css).toContain("--font-serif:var(--font-fraunces)");
  });

  test("editorial: Acumin Pro, falling back to Archivo, with a bold Times italic accent (1063)", () => {
    const css = fontCss({ set: "editorial" });
    expect(css).toContain('--font-display:"Acumin Pro", var(--font-archivo)');
    expect(css).toContain('--font-serif:"Times New Roman", var(--font-tinos)');
    expect(css).toContain(".accent-serif{font-weight:700");
  });

  test("poster: Rubik Black headlines with a Space Mono accent (1063)", () => {
    const css = fontCss({ set: "poster" });
    expect(css).toContain('--font-display:"Magnode", var(--font-rubik)');
    expect(css).toContain('--font-serif:"Alpha Lyrae", var(--font-spacemono)');
    expect(css).toContain(".display{font-weight:900");
  });

  test("theme stylesheet goes live within 30 s (1063)", () => {
    const route = readFileSync("app/api/pip-theme/route.ts", "utf8");
    expect(route).toContain('"public, max-age=5"');
    expect(route).toContain("s-maxage=5, stale-while-revalidate=5");
    expect(route).not.toContain("max-age=300");
  });

  test("the stylesheet can't be broken out of", () => {
    for (const f of FONT_SETS) {
      for (const v of [f.display, f.body, f.serif, f.look.axes ?? ""]) expect(v).not.toMatch(/[{}<;]/);
      for (const v of [f.look?.tracking, f.accent?.tracking]) if (v != null) expect(String(v)).toMatch(/^-?\d*\.?\d+(em|px)?$/);
    }
  });

  test("layout wires the raw faces and globals maps the roles", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    for (const v of ["--font-manrope", "--font-inter", "--font-bricolage", "--font-dmsans", "--font-instrument", "--font-gopher", "--font-jakarta", "--font-fraunces", "--font-archivo", "--font-tinos", "--font-rubik", "--font-spacemono"]) expect(layout).toContain(v);
    expect(layout).toContain("preload: false");
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain("--font-display: var(--font-manrope);"); // 1062: Manrope + Inter by default
    expect(css).toContain("--font-body: var(--font-inter);");
    expect(css).toContain("--font-serif: var(--font-instrument);");
    for (const f of ["go-regular", "go-italic", "go-medium", "go-medium-italic", "go-bold"]) expect(existsSync(`app/fonts/go/${f}.woff2`)).toBe(true);
    expect(existsSync("app/fonts/go/LICENSE.txt")).toBe(true);
  });

  test("theme route serves the font override", () => {
    const route = readFileSync("app/api/pip-theme/route.ts", "utf8");
    expect(route).toContain("fontCss(fonts)");
  });
});

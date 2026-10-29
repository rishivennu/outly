import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { FONT_SETS, FONT_SET_IDS, FONTS_DEFAULT, fontCss, normalizeFonts } from "@/lib/fonts";

describe("site fonts (1046)", () => {
  test("four sets, original by default", () => {
    expect(FONT_SET_IDS).toEqual(["current", "apple", "gopher", "jakarta"]);
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

  test("the stylesheet can't be broken out of", () => {
    for (const f of FONT_SETS) for (const v of [f.display, f.body, f.serif]) expect(v).not.toMatch(/[{}<;]/);
  });

  test("layout wires the raw faces and globals maps the roles", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    for (const v of ["--font-bricolage", "--font-dmsans", "--font-instrument", "--font-gopher", "--font-jakarta", "--font-fraunces"]) expect(layout).toContain(v);
    expect(layout).toContain("preload: false");
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain("--font-display: var(--font-bricolage);");
    expect(css).toContain("--font-body: var(--font-dmsans);");
    expect(css).toContain("--font-serif: var(--font-instrument);");
    for (const f of ["go-regular", "go-italic", "go-medium", "go-medium-italic", "go-bold"]) expect(existsSync(`app/fonts/go/${f}.woff2`)).toBe(true);
    expect(existsSync("app/fonts/go/LICENSE.txt")).toBe(true);
  });

  test("theme route serves the font override", () => {
    const route = readFileSync("app/api/pip-theme/route.ts", "utf8");
    expect(route).toContain("fontCss(fonts)");
  });
});

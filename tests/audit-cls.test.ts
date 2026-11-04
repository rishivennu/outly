import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// 1130: the "Outlly classic" headline face shifted the hero card fan 41px on 390-412px phones (CLS 0.21 on live)
// because next/font's Arial fallback is sized to Bricolage's default width, not the condensed wdth 96 we set.
const layout = readFileSync("app/layout.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

describe("classic headline fallback keeps the hero still", () => {
  test("Bricolage uses our tuned fallback face instead of next/font's", () => {
    const decl = layout.split("\n").find((l) => l.startsWith("const classicDisplay = Bricolage_Grotesque("))!;
    expect(decl).toContain("adjustFontFallback: false");
    expect(decl).toContain('fallback: ["Outlly Bricolage Fallback"');
    expect(decl).toContain("preload: false");
  });

  test("the tuned face exists and is Arial at the condensed width", () => {
    const face = css.match(/@font-face \{ font-family: "Outlly Bricolage Fallback";[^}]*\}/)?.[0] ?? "";
    expect(face).toContain('src: local("Arial")');
    expect(face).toContain("size-adjust: 97.22%");
    expect(face).toMatch(/ascent-override: 95\.66%; descent-override: 27\.77%; line-gap-override: 0%/);
  });
});

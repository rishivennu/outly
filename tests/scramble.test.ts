/** Text scramble frames (1069): spaces and revealed characters stay real, the rest is random, p=1 is the text. */
import { describe, expect, test } from "bun:test";
import { scrambleFrame } from "@/lib/motion/scramble";

const strip = (html: string) => html.replace(/<span class="scr-x"(?: style="[^"]*")?>(.*?)<\/span>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const randomCount = (html: string) => (html.match(/class="scr-x"/g) ?? []).length;

describe("scrambleFrame", () => {
  test("at the start every non-space character is random", () => {
    const f = scrambleFrame("How it works", 0);
    expect(randomCount(f)).toBe(10);
    expect(strip(f).length).toBe("How it works".length);
    expect(strip(f)[3]).toBe(" ");
  });
  test("reveals left to right", () => {
    const f = scrambleFrame("ABCDEFGHIJ", 0.6, () => 0.999);
    const plain = strip(f);
    expect(plain.startsWith("ABCD")).toBe(true);
    expect(plain.endsWith("?")).toBe(true);
  });
  test("p = 1 is exactly the text", () => {
    expect(scrambleFrame("Pricing", 1)).toBe("Pricing");
  });
  test("escapes markup", () => {
    expect(scrambleFrame("<b>&", 1)).toBe("&lt;b&gt;&amp;");
  });
  test("with widths, each random glyph is pinned to its real letter's px width", () => {
    const f = scrambleFrame("Wi l", 0, () => 0, [14.256, 4.5, 3, 4.1]);
    expect(f).toBe('<span class="scr-x" style="width:14.26px">A</span><span class="scr-x" style="width:4.5px">A</span> <span class="scr-x" style="width:4.1px">A</span>');
    expect(strip(f).length).toBe(4);
  });
  test("revealed letters stay plain text even when widths are given", () => {
    expect(scrambleFrame("Pricing", 1, Math.random, [1, 2, 3, 4, 5, 6, 7])).toBe("Pricing");
  });
});

/** Caption size tool and the Poppins Bold face: the size grid, the stored track, and the font the canvas gets. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPTION_TRACKING, CAPTION_WEIGHT, SIZE_BASE, SIZE_MAX, SIZE_MIN, SIZE_STEP, captionFont, captionTracking, clampSize, saySize, showSize, stepSize } from "../lib/captions/size";
import { readTrack } from "../lib/captions/edit";
import { drawCue, sampleText } from "../lib/client/captions";

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the size grid", () => {
  test("any input lands in 60..160 on the 10% grid; junk is the base size", () => {
    expect([SIZE_MIN, SIZE_MAX, SIZE_STEP, SIZE_BASE]).toEqual([60, 160, 10, 100]);
    expect(clampSize(100)).toBe(100);
    expect(clampSize(123)).toBe(120);
    expect(clampSize(125)).toBe(130);
    expect(clampSize(10)).toBe(60);
    expect(clampSize(999)).toBe(160);
    expect(clampSize("140")).toBe(140);
    for (const junk of [undefined, null, "", "big", NaN, -20, 0, Infinity]) expect(clampSize(junk)).toBe(SIZE_BASE);
  });

  test("stepping moves one notch and stops at the ends", () => {
    expect(stepSize(100, 1)).toBe(110);
    expect(stepSize(100, -1)).toBe(90);
    expect(stepSize(160, 1)).toBe(160);
    expect(stepSize(60, -1)).toBe(60);
    expect(stepSize(Number.NaN, 1)).toBe(110);
  });

  test("shown as a percentage, spoken as words at the base", () => {
    expect(showSize(100)).toBe("100%");
    expect(showSize(73)).toBe("70%");
    expect(saySize(100)).toBe("Normal size");
    expect(saySize(130)).toBe("130 percent");
  });
});

describe("the face", () => {
  test("Poppins Bold with -2% tracking; a loaded family name goes first, system faces last", () => {
    expect(CAPTION_WEIGHT).toBe(700);
    expect(CAPTION_TRACKING).toBe(-0.02);
    expect(captionFont(40)).toBe('700 40px Poppins, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
    expect(captionFont(40, "__Poppins_abc123")).toStartWith("700 40px __Poppins_abc123, Poppins,");
    expect(captionTracking(40)).toBe("-0.80px");
    expect(captionTracking(100)).toBe("-2.00px");
  });

  test("the font is loaded for the characters the track uses, so every Poppins file it needs comes along", () => {
    const s = sampleText([{ start: 0, end: 1, text: "hello" }, { start: 1, end: 2, text: "नमस्ते olé" }]);
    expect(s).toContain("न");
    expect(s).toContain("é");
    expect(s.length).toBeLessThan(16);
    expect(sampleText([])).toBe("");
  });

  test("the preview and the recorder share the Poppins family from next/font", () => {
    const src = read("components/create/caption-font.ts");
    expect(src).toContain("pipFont.style.fontFamily");
    expect(src).toContain("document.fonts.load");
    const burner = read("components/create/CaptionBurner.tsx");
    expect(burner).toContain("store.burn(cues, captionFontFamily)");
    expect(burner).toContain("<CaptionSize");
    const client = read("lib/client/captions.ts");
    expect(client).toContain("await readyFont(opts.font, sampleText(cues))");
    expect(client).toContain("await readyFont(opts.font, sampleText(opts.cues))");
    expect(burner).toContain("readyCaptionFont(sampleText(cues))");
  });
});

describe("drawCue", () => {
  function fakeCtx() {
    const calls: string[] = [];
    const ctx = {
      font: "",
      letterSpacing: "",
      textAlign: "",
      textBaseline: "",
      fillStyle: "",
      strokeStyle: "",
      lineJoin: "",
      lineWidth: 0,
      measureText: (s: string) => ({ width: s.length * 10 }),
      fillText: (s: string) => void calls.push(`fill:${s}`),
      strokeText: (s: string) => void calls.push(`stroke:${s}`),
      beginPath: () => {},
      rect: () => {},
      fill: () => {},
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, raw: ctx, calls };
  }

  test("the size scales the base size, and the font and tracking follow it", () => {
    const base = fakeCtx();
    drawCue(base.ctx, "hello there", 1080, 1920, "clean", "bottom");
    const basePx = Math.round(1080 * 0.058);
    expect(base.raw.font).toBe(captionFont(basePx));
    expect(base.raw.letterSpacing).toBe(captionTracking(basePx));

    const big = fakeCtx();
    drawCue(big.ctx, "hello there", 1080, 1920, "clean", "bottom", { size: 150, font: "__Poppins_x" });
    const bigPx = Math.round(1080 * 0.058 * 1.5);
    expect(big.raw.font).toBe(captionFont(bigPx, "__Poppins_x"));
    expect(big.raw.letterSpacing).toBe(captionTracking(bigPx));
    expect(bigPx).toBeGreaterThan(basePx);

    const small = fakeCtx();
    drawCue(small.ctx, "hello there", 1080, 1920, "pop", "top", { size: 60 });
    expect(small.raw.font).toBe(captionFont(Math.round(1080 * 0.072 * 0.6)));
    expect(small.calls.filter((c) => c.startsWith("fill:")).join(" ")).toContain("HELLO THERE");
  });

  test("a junk size draws at the base size", () => {
    const a = fakeCtx();
    drawCue(a.ctx, "x", 720, 1280, "box", "middle", { size: Number.NaN });
    expect(a.raw.font).toBe(captionFont(Math.round(720 * 0.058)));
  });
});

describe("the stored track", () => {
  const cues = [{ start: 0, end: 1, text: "a" }];
  test("keeps the size when it is not the base, on the grid, and drops it when it is", () => {
    expect(readTrack({ cues, size: 130 })!.size).toBe(130);
    expect(readTrack({ cues, size: 128 })!.size).toBe(130);
    expect(readTrack({ cues, size: 100 })!.size).toBeUndefined();
    expect(readTrack({ cues })!.size).toBeUndefined();
    expect(readTrack({ cues, size: "huge" })!.size).toBeUndefined();
    expect(readTrack({ cues, size: 1000 })!.size).toBe(160);
  });
});

import { describe, expect, test } from "bun:test";
import {
  cleanWords, cuesFromWords, DEFAULT_SUBTITLE_RULES as R, findText, highlightPrompt, joinWords, mergeRanges,
  mergeSubtitleRules, parseHighlights, rangesLength, shiftCues, wordsFromCues, wordsFromFunasr, type Word,
} from "@/lib/captions/subtitle-engine";

const W = (spec: string, gapAt: number[] = []): Word[] => {
  let t = 0;
  return spec.split(" ").map((w, i) => {
    if (gapAt.includes(i)) t += 0.8;
    const x = { w, s: Math.round(t * 100) / 100, e: Math.round((t + 0.3) * 100) / 100 };
    t += 0.35;
    return x;
  });
};

describe("subtitle engine (FunClip-style)", () => {
  test("rules: defaults, clamps, bad url rejected, unknown keys dropped", () => {
    expect(mergeSubtitleRules(null)).toEqual(R);
    const m = mergeSubtitleRules({ provider: "funasr", workerUrl: "javascript:alert(1)", maxWords: 99, pause: -3, highlights: { minSec: 50, maxSec: 10 }, junk: 1 });
    expect(m.provider).toBe("funasr");
    expect(m.workerUrl).toBe("");
    expect(m.maxWords).toBe(16);
    expect(m.pause).toBe(0.15);
    expect(m.highlights.maxSec).toBeGreaterThan(m.highlights.minSec);
    expect((m as any).junk).toBeUndefined();
    expect(mergeSubtitleRules({ workerUrl: "https://x.hf.space/asr" }).workerUrl).toBe("https://x.hf.space/asr");
  });

  test("joinWords: spaces for latin, none inside CJK or before punctuation", () => {
    expect(joinWords([{ w: "Hello" }, { w: "," }, { w: "you" }])).toBe("Hello, you");
    expect(joinWords([{ w: "你" }, { w: "好" }, { w: "world" }])).toBe("你好 world");
  });

  test("cleanWords: offset, sort, punctuation rides on the word before, no overlaps", () => {
    const w = cleanWords([{ w: "b", s: 1, e: 1.5 }, { w: "a", s: 0, e: 1.2 }, { w: ".", s: 1.5, e: 1.6 }, { w: "", s: 2, e: 3 }], 10);
    expect(w.map((x) => x.w)).toEqual(["a", "b."]);
    expect(w[0].s).toBe(10);
    expect(w[0].e).toBeLessThanOrEqual(w[1].s);
  });

  test("cuesFromWords: breaks after sentences, at pauses and at the word cap", () => {
    const cues = cuesFromWords(W("I quit my job. Then I baked bread every single morning for six long months", [7]));
    expect(cues[0].text).toBe("I quit my job.");
    expect(cues[1].text).toBe("Then I baked");
    expect(cues.every((c) => c.text.split(" ").length <= R.maxWords && c.text.length <= R.maxChars)).toBe(true);
    for (let i = 0; i < cues.length - 1; i++) expect(cues[i].end).toBeLessThanOrEqual(cues[i + 1].start);
  });

  test("cuesFromWords: a speaker change starts a new line; short lines get min time", () => {
    const ws: Word[] = [{ w: "Hi", s: 0, e: 0.2, spk: 0 }, { w: "Hey", s: 0.25, e: 0.4, spk: 1 }];
    const c = cuesFromWords(ws);
    expect(c.map((x) => x.text)).toEqual(["Hi", "Hey"]);
    expect(c[1].end - c[1].start).toBeGreaterThanOrEqual(R.minCue - 0.01);
  });

  test("findText: every occurrence, case and punctuation blind, # for several, pads, reports misses", () => {
    const ws = W("The best part. Honestly the BEST part, was the bread");
    const r = findText(ws, "best part # bread # pizza");
    expect(r.ranges.length).toBe(3);
    expect(r.missing).toEqual(["pizza"]);
    expect(r.ranges[0].start).toBeCloseTo(Math.max(0, ws[1].s - R.clipPad.before), 2);
    expect(findText(ws, "the best part honestly").ranges.length).toBe(1);
  });

  test("findText: CJK phrases match by character", () => {
    const ws: Word[] = [{ w: "今天", s: 0, e: 0.6 }, { w: "天气", s: 0.6, e: 1.2 }, { w: "很好。", s: 1.2, e: 1.8 }];
    const r = findText(ws, "天天气");
    expect(r.ranges.length).toBe(1);
  });

  test("mergeRanges, rangesLength and shiftCues retime captions onto the cut", () => {
    expect(mergeRanges([{ start: 5, end: 8 }, { start: 0, end: 2 }, { start: 1.5, end: 3 }])).toEqual([{ start: 0, end: 3 }, { start: 5, end: 8 }]);
    expect(rangesLength([{ start: 0, end: 2 }, { start: 5, end: 6 }])).toBe(3);
    const cues = [{ start: 0, end: 1, text: "a" }, { start: 5, end: 6, text: "b" }, { start: 9, end: 10, text: "c" }];
    expect(shiftCues(cues, [{ start: 4.5, end: 6.5 }, { start: 0, end: 1 }])).toEqual([{ start: 0, end: 1, text: "a" }, { start: 1.5, end: 2.5, text: "b" }]);
  });

  test("wordsFromFunasr: AutoModel timestamps in ms, sentence_info with speakers, and passthrough shapes", () => {
    const en = wordsFromFunasr([{ text: "hello world, this is outlly.", timestamp: [[0, 300], [300, 700], [800, 1000], [1000, 1100], [1100, 1600]] }], 60);
    expect(en.map((w) => w.w)).toEqual(["hello", "world,", "this", "is", "outlly."]);
    expect(en[0].s).toBe(60);
    const zh = wordsFromFunasr([{ text: "", sentence_info: [{ text: "你好。", timestamp: [[0, 200], [200, 400]], spk: 1 }] }]);
    expect(zh.map((w) => w.w)).toEqual(["你", "好。"]);
    expect(zh[0].spk).toBe(1);
    expect(wordsFromFunasr({ words: [{ w: "x", s: 1, e: 2 }] })).toHaveLength(1);
    expect(wordsFromFunasr({ cues: [{ start: 0, end: 2, text: "two words" }] })).toHaveLength(2);
    expect(wordsFromFunasr("nonsense")).toEqual([]);
  });

  test("wordsFromCues splits a line by character share", () => {
    const w = wordsFromCues([{ start: 0, end: 2, text: "ab abcdef" }]);
    expect(w[0].e).toBeCloseTo(0.5, 2);
    expect(w[1].e).toBe(2);
  });

  test("highlights: prompt carries the SRT; parse snaps, enforces length, drops overlap and caps count", () => {
    const cues = Array.from({ length: 20 }, (_, i) => ({ start: i * 3, end: i * 3 + 2.8, text: `line ${i}` }));
    expect(highlightPrompt(cues).prompt).toContain("00:00:03,000 --> 00:00:05,800");
    const h = parseHighlights({ clips: [{ start: 3.1, end: 14.2, title: "Good", why: "w" }, { start: 6, end: 20, title: "Overlap" }, { start: 30, end: 31 }, { start: 33, end: 200 }, { start: "x", end: 4 }] }, cues, 60);
    expect(h[0]).toMatchObject({ start: 3, end: 14.8, title: "Good" });
    expect(h.find((x) => x.title === "Overlap")).toBeUndefined();
    expect(h.every((x) => x.end - x.start <= R.highlights.maxSec + 0.01 && x.end - x.start >= R.highlights.minSec - 0.6)).toBe(true);
    expect(h.length).toBeLessThanOrEqual(R.highlights.count);
  });
});

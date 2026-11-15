/**
 * Phase 3 caption timing (A3/A6): Gemini word times are checked per chunk (seconds vs ms, clip vs video clock,
 * garbage refused), chunks overlap and are stitched without doubles, lines are built from word times, and a
 * 20 minute video stays aligned from start to end. Fixtures are real-shaped English, Telugu and Tamil answers.
 */
import { describe, expect, test } from "bun:test";
import { cleanWords, DEFAULT_SUBTITLE_RULES, type Word } from "../lib/captions/subtitle-engine";
import { buildCues, checkChunkWords, CHUNK_OVERLAP, CUE_TAIL, followTrack, planChunks, settleCues, spliceSpan, stitchWords, syncWords } from "../lib/captions/timing";
import { blockingIssues, cueIssues, readTrack, retimeCue } from "../lib/captions/edit";
import { languageName, normalizeLang } from "../lib/captions/languages";
import { cueAt, type Cue } from "../lib/captions/cues";

const EN = [
  { w: "Hi", s: 0.42, e: 0.71 },
  { w: "everyone,", s: 0.74, e: 1.2 },
  { w: "today", s: 1.31, e: 1.66 },
  { w: "we", s: 1.7, e: 1.82 },
  { w: "bake", s: 1.86, e: 2.15 },
  { w: "bread.", s: 2.2, e: 2.61 },
];
const TE = [
  { w: "నమస్కారం", s: 0.3, e: 0.98 },
  { w: "అందరికీ,", s: 1.02, e: 1.61 },
  { w: "ఈ", s: 1.9, e: 2.0 },
  { w: "రోజు", s: 2.04, e: 2.4 },
  { w: "మనం", s: 2.45, e: 2.77 },
  { w: "బిర్యానీ", s: 2.8, e: 3.41 },
  { w: "చేద్దాం.", s: 3.45, e: 4.02 },
];
const TA = [
  { w: "வணக்கம்", s: 0.25, e: 0.9 },
  { w: "நண்பர்களே,", s: 0.95, e: 1.7 },
  { w: "இன்று", s: 2.1, e: 2.42 },
  { w: "நாம்", s: 2.46, e: 2.7 },
  { w: "சாம்பார்", s: 2.75, e: 3.3 },
  { w: "செய்யலாம்.", s: 3.34, e: 4.1 },
];

describe("p3 chunk word checks", () => {
  test("correct second timings pass through untouched, in English, Telugu and Tamil", () => {
    for (const fx of [EN, TE, TA]) {
      const t = checkChunkWords(fx, 62.5);
      expect(t.ok).toBe(true);
      if (!t.ok) continue;
      expect(t.unit).toBe("s");
      expect(t.words).toEqual(fx);
    }
  });
  test("Unicode words keep their script and punctuation on the way to the video timeline", () => {
    const t = checkChunkWords(TE, 62.5, 120);
    if (!t.ok) throw new Error("refused");
    const w = cleanWords(t.words, 120, 182.5);
    expect(w.map((x) => x.w).join(" ")).toBe("నమస్కారం అందరికీ, ఈ రోజు మనం బిర్యానీ చేద్దాం.");
    expect(w[0].s).toBe(120.3);
    expect(w[w.length - 1].e).toBe(124.02);
  });
  test("milliseconds are found and turned into seconds", () => {
    const ms = TA.map((x) => ({ ...x, s: x.s * 1000, e: x.e * 1000 }));
    const t = checkChunkWords(ms, 62.5);
    expect(t.ok && t.unit).toBe("ms");
    if (t.ok) expect(t.words.map((x) => x.s)).toEqual(TA.map((x) => x.s));
  });
  test("times counted from the start of the video are moved onto the chunk clock", () => {
    const abs = EN.map((x) => ({ ...x, s: x.s + 180, e: x.e + 180 }));
    const t = checkChunkWords(abs, 62.5, 180);
    expect(t.ok && t.shifted).toBe(true);
    if (t.ok) expect(t.words[0].s).toBeCloseTo(0.42, 5);
  });
  test("garbage timings are refused, not stretched", () => {
    const same = Array.from({ length: 12 }, (_, i) => ({ w: `w${i}`, s: 0, e: 0 }));
    expect(checkChunkWords(same, 60).ok).toBe(false);
    const back = Array.from({ length: 12 }, (_, i) => ({ w: `w${i}`, s: i % 2 ? 40 - i : i, e: (i % 2 ? 40 - i : i) + 0.3 }));
    expect(checkChunkWords(back, 60).ok).toBe(false);
    const past = Array.from({ length: 10 }, (_, i) => ({ w: `w${i}`, s: 30 + i * 8, e: 30.4 + i * 8 }));
    expect(checkChunkWords(past, 60).ok).toBe(false);
  });
  test("a missing end runs to the next word at most, and a word holding a pause is cut to a natural length", () => {
    const t = checkChunkWords([{ w: "one", s: 1 }, { w: "two", s: 1.1, e: 9 }, { w: "three", s: 9.5, e: 9.9 }], 60);
    if (!t.ok) throw new Error("refused");
    expect(t.words[0].e).toBe(1.1);
    expect(t.words[1].e).toBeCloseTo(3.6, 5);
  });
  test("silence is a valid, empty answer", () => {
    expect(checkChunkWords([], 60)).toEqual({ ok: true, words: [], unit: "s", shifted: false, dropped: 0 });
  });
});

describe("p3 chunk plan and seams", () => {
  test("chunks overlap and own the timeline up to the middle of each overlap", () => {
    const p = planChunks(185);
    expect(p.map((c) => c.offset)).toEqual([0, 60, 120, 180]);
    expect(p[0]).toMatchObject({ from: 0, to: 61.25, duration: 62.5 });
    expect(p[3]).toMatchObject({ from: 181.25, to: Infinity, duration: 5 });
    expect(planChunks(61).length).toBe(1);
    expect(planChunks(0)).toEqual([]);
  });
  test("a word heard by two chunks is kept once; a word said twice on purpose stays twice", () => {
    const a: Word[] = [{ w: "the", s: 60.2, e: 60.4 }, { w: "the", s: 60.45, e: 60.6 }, { w: "biryani", s: 61.0, e: 61.6 }];
    const b: Word[] = [{ w: "the", s: 60.21, e: 60.41 }, { w: "the", s: 60.46, e: 60.6 }, { w: "Biryani,", s: 61.1, e: 61.7 }, { w: "now", s: 62.0, e: 62.3 }];
    const out = stitchWords([{ from: 0, to: 61.25, words: a }, { from: 61.25, to: Infinity, words: b }]);
    // the seam (61.25) gives "biryani" to the second chunk, which heard it whole
    expect(out.map((w) => w.w)).toEqual(["the", "the", "Biryani,", "now"]);
    for (let i = 1; i < out.length; i++) expect(out[i].s).toBeGreaterThanOrEqual(out[i - 1].e);
  });
});

describe("p3 lines from word times", () => {
  const ws = cleanWords([...EN, { w: "Then", s: 30.0, e: 30.3 }, { w: "we", s: 30.35, e: 30.5 }, { w: "eat.", s: 30.55, e: 30.9 }, { w: "Bye.", s: 59.5, e: 59.8 }]);
  const cues = buildCues(ws, DEFAULT_SUBTITLE_RULES, 60);
  test("start: the first line starts on the first word", () => {
    expect(cues[0].start).toBe(0.42);
  });
  test("middle: a line starts on its own first word, not on a guess", () => {
    const mid = cues.find((c) => c.text.startsWith("Then"))!;
    expect(mid.start).toBe(30);
    expect(mid.end).toBeCloseTo(30.9 + CUE_TAIL, 5);
  });
  test("end: the last line never runs past the video", () => {
    expect(cues[cues.length - 1].end).toBeLessThanOrEqual(60);
  });
  test("a line's tail stops at the next line's start; nothing overlaps", () => {
    const s = settleCues([{ start: 0, end: 1, text: "a" }, { start: 1.1, end: 2, text: "b" }]);
    expect(s[0].end).toBe(1.1);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end);
  });
});

describe("p3 long video drift", () => {
  test("20 minutes across 20 chunks stays aligned with the speech", () => {
    const total = 1200;
    const truth: Word[] = [];
    for (let t = 0.2, i = 0; t < total - 0.5; t += 0.43, i++) truth.push({ w: `w${i}${i % 9 === 8 ? "." : ""}`, s: Math.round(t * 100) / 100, e: Math.round((t + 0.3) * 100) / 100 });
    const plan = planChunks(total);
    expect(plan.length).toBe(20);
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.06;
    const parts = plan.map((c) => {
      // what the model answers for this chunk: words it heard fully, on the chunk's own clock, a little off
      const heard = truth.filter((w) => w.s >= c.offset && w.e <= c.offset + c.duration).map((w) => ({ w: w.w, s: w.s - c.offset + noise(), e: w.e - c.offset + noise() }));
      const t = checkChunkWords(heard, c.duration, c.offset);
      if (!t.ok) throw new Error(t.reason);
      return { from: c.from, to: c.to, words: cleanWords(t.words, c.offset, c.offset + c.duration) };
    });
    const out = stitchWords(parts, CHUNK_OVERLAP);
    expect(out.length).toBe(truth.length);
    let worst = 0;
    out.forEach((w, i) => {
      expect(w.w).toBe(truth[i].w);
      worst = Math.max(worst, Math.abs(w.s - truth[i].s));
    });
    expect(worst).toBeLessThan(0.05);
    const cues = buildCues(out, DEFAULT_SUBTITLE_RULES, total);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end);
    // the line on screen at minute 19 holds the word spoken then
    const at = truth.find((w) => w.s > 1140)!;
    expect(cueAt(cues, at.s + 0.1)?.text).toContain(at.w.replace(".", ""));
  });
});

describe("p3 editing keeps one timeline", () => {
  const orig: Cue[] = [{ start: 0.3, end: 1.9, text: "నమస్కారం అందరికీ," }, { start: 1.9, end: 4.27, text: "ఈ రోజు మనం బిర్యానీ చేద్దాం." }];
  const en: Cue[] = [{ start: 0.3, end: 1.9, text: "Hello everyone," }, { start: 1.9, end: 4.27, text: "today we're making biryani." }];
  test("a manual retime on one track moves the other track's line too, words kept", () => {
    const r = retimeCue(en, 1, "start", 2.1, 10);
    if (!r.ok) throw new Error(r.error);
    const o = followTrack(en, r.cues, orig);
    expect(o[1]).toEqual({ start: 2.1, end: 4.27, text: orig[1].text });
    expect(cueIssues(r.cues, 10, o)).toEqual([]);
  });
  test("delete and add follow by time", () => {
    const after = [en[1]];
    expect(followTrack(en, after, orig)).toEqual([orig[1]]);
    const added = [...en, { start: 5, end: 6, text: "New caption" }];
    expect(followTrack(en, added, orig)[2]).toEqual({ start: 5, end: 6, text: "New caption" });
  });
  test("a translated line with no original line is an issue; nothing is changed", () => {
    const bad = [en[0], { ...en[1], start: 2.5 }];
    const m = cueIssues(bad, 10, orig).map((i) => i.message);
    expect(m).toContain("Translated line 2 has no matching original line. Translate again or delete it.");
    expect(bad[1].start).toBe(2.5);
  });
  test("long and unreadable times are flagged; long display warns but does not block", () => {
    const issues = cueIssues([{ start: 0, end: 9, text: "hi" }, { start: 9, end: Number.NaN, text: "x" }], 20);
    expect(issues.find((i) => i.index === 0)?.level).toBe("warn");
    expect(blockingIssues(issues).map((i) => i.index)).toEqual([1]);
  });
  test("edited lines get fresh rough words, untouched lines keep real times", () => {
    const ws = cleanWords(EN);
    const cues = buildCues(ws);
    const edited = cues.map((c, i) => (i === 0 ? { ...c, text: "Hello there" } : c));
    const out = syncWords(ws, edited);
    expect(out.slice(0, 2).map((w) => w.w)).toEqual(["Hello", "there"]);
    expect(out.find((w) => w.w === "eat.")).toEqual(ws.find((w) => w.w === "eat."));
  });
  test("a retried part replaces only its own lines", () => {
    const old = [{ start: 1, end: 2, text: "keep" }, { start: 70, end: 71, text: "old" }];
    const fresh = [{ start: 1, end: 2, text: "not this" }, { start: 70.2, end: 71.5, text: "new" }];
    expect(spliceSpan(old, fresh, 61.25, 121.25).map((c) => c.text)).toEqual(["keep", "new"]);
  });
  test("a stored track keeps both languages while their times match", () => {
    const t = readTrack({ cues: en, original: orig, translated: en, view: "english", lang: "te", style: "pop", pos: "bottom" }, 10)!;
    expect(t.view).toBe("english");
    expect(t.cues).toEqual(en);
    expect(t.original).toEqual(orig);
    const off = readTrack({ cues: orig, original: orig, translated: [en[0]], view: "english" }, 10)!;
    expect(off.translated).toBeUndefined();
    expect(off.cues).toEqual(orig);
  });
  test("languages read from model answers", () => {
    expect(normalizeLang("Telugu")).toBe("te");
    expect(normalizeLang(" TA ")).toBe("ta");
    expect(normalizeLang("te_IN")).toBe("te-IN");
    expect(normalizeLang("not a lang!")).toBe("");
    expect(languageName("ta-IN")).toBe("Tamil");
  });
});

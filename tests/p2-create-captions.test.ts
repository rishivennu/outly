import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cueAt, type Cue } from "../lib/captions/cues";
import { cueBounds, cueIssues, MIN_EDIT_CUE, nudgeCue, parseTimeInput, readTrack, restoreCue, retimeCue, swapText } from "../lib/captions/edit";
import { transcriptionConfigured } from "../lib/captions/availability";

const cues = (): Cue[] => [
  { start: 0, end: 1, text: "one" },
  { start: 1.5, end: 3, text: "two" },
  { start: 3, end: 4, text: "three" },
];
const sortedNoOverlap = (cs: Cue[]) => cs.every((c, i) => c.end > c.start && (i === 0 || c.start >= cs[i - 1].end - 1e-9));

describe("p2 caption retiming", () => {
  test("bounds stop at the neighbours and the clip", () => {
    expect(cueBounds(cues(), 1, 10)).toEqual({ startMin: 1, startMax: 2.8, endMin: 1.7, endMax: 3 });
    expect(cueBounds(cues(), 2, 10).endMax).toBe(10);
    expect(cueBounds(cues(), 0, 0).startMin).toBe(0);
    expect(cueBounds(cues(), 2, 0).endMax).toBe(Infinity);
  });
  test("a typed time inside the range is taken as is", () => {
    const r = retimeCue(cues(), 1, "start", 1.25, 10);
    expect(r.ok && r.value).toBe(1.25);
    expect(r.ok && r.clamped).toBe(false);
  });
  test("out of range is clamped, never overlapping", () => {
    const early = retimeCue(cues(), 1, "start", 0.2, 10);
    expect(early.ok && early.value).toBe(1);
    expect(early.ok && early.clamped).toBe(true);
    const late = retimeCue(cues(), 1, "end", 9, 10);
    expect(late.ok && late.value).toBe(3);
    const short = retimeCue(cues(), 1, "end", 1.55, 10);
    expect(short.ok && short.value).toBe(1.5 + MIN_EDIT_CUE);
    for (const r of [early, late, short]) expect(r.ok && sortedNoOverlap(r.cues)).toBe(true);
  });
  test("past the end of the clip is clamped to it", () => {
    const r = retimeCue(cues(), 2, "end", 50, 5);
    expect(r.ok && r.value).toBe(5);
  });
  test("bad input is an error, nothing changes", () => {
    expect(retimeCue(cues(), 1, "start", NaN, 10).ok).toBe(false);
    expect(retimeCue(cues(), 1, "start", -1, 10).ok).toBe(false);
    expect(retimeCue(cues(), 9, "start", 1, 10).ok).toBe(false);
  });
  test("nudges move 0.1 s and stop at the edge", () => {
    let cs = cues();
    const r = nudgeCue(cs, 1, "start", -0.1, 10);
    expect(r.ok && r.cues[1].start).toBe(1.4);
    for (let k = 0; k < 20; k++) {
      const n = nudgeCue(cs, 1, "start", -0.1, 10);
      if (n.ok) cs = n.cues;
    }
    expect(cs[1].start).toBe(1);
    expect(sortedNoOverlap(cs)).toBe(true);
    const up = nudgeCue(cues(), 0, "end", 0.1, 10);
    expect(up.ok && up.cues[0].end).toBe(1.1);
  });
  test("the preview still finds the retimed line", () => {
    const r = retimeCue(cues(), 1, "start", 1.2, 10);
    expect(r.ok && cueAt(r.cues, 1.3)?.text).toBe("two");
  });
  test("typed times read seconds and m:ss", () => {
    expect(parseTimeInput("2.5")).toBe(2.5);
    expect(parseTimeInput("2,5")).toBe(2.5);
    expect(parseTimeInput("2.5s")).toBe(2.5);
    expect(parseTimeInput("1:02.5")).toBe(62.5);
    expect(parseTimeInput("abc")).toBeNaN();
    expect(parseTimeInput("")).toBeNaN();
  });
});

describe("p2 caption reorder, delete and undo", () => {
  test("swap keeps the timing slots", () => {
    const s = swapText(cues(), 0, 1)!;
    expect(s.map((c) => c.text)).toEqual(["two", "one", "three"]);
    expect(s.map((c) => c.start)).toEqual([0, 1.5, 3]);
    expect(swapText(cues(), 0, -1)).toBeNull();
    expect(swapText(cues(), 2, 1)).toBeNull();
  });
  test("undo puts a line back in order", () => {
    const all = cues();
    const gone = all.filter((_, i) => i !== 1);
    const r = restoreCue(gone, all[1])!;
    expect(r.index).toBe(1);
    expect(r.cues).toEqual(all);
  });
  test("undo trims to the free part, or refuses when no room is left", () => {
    const all = cues();
    const after = [all[0], { start: 1.5, end: 2.2, text: "new" }, all[2]];
    const r = restoreCue(after, all[1])!;
    expect(r.cues[2]).toEqual({ start: 2.2, end: 3, text: "two" });
    expect(sortedNoOverlap(r.cues)).toBe(true);
    expect(restoreCue([all[0], { start: 1.5, end: 3, text: "x" }, all[2]], all[1])).toBeNull();
  });
});

describe("p2 caption validation and stored tracks", () => {
  test("issues name the line", () => {
    expect(cueIssues(cues(), 10)).toEqual([]);
    const bad = [{ start: 0, end: 1, text: " " }, { start: 0.5, end: 2, text: "x" }, { start: 2, end: 12, text: "y" }];
    const m = cueIssues(bad, 10).map((i) => i.message);
    expect(m).toContain("Line 1 has no words. Type them or delete the line.");
    expect(m).toContain("Line 2 overlaps line 1.");
    expect(m).toContain("Line 3 runs past the end of the video.");
  });
  test("readTrack drops junk and fixes overlaps", () => {
    const t = readTrack({ cues: [{ start: 2, end: 3, text: "b" }, { start: 0, end: 2.5, text: "a" }, { start: "x", end: 1 }, null], style: "box", pos: "top" }, 10)!;
    expect(t.cues).toEqual([{ start: 0, end: 2.5, text: "a" }, { start: 2.5, end: 3, text: "b" }]);
    expect(t.style).toBe("box");
    expect(t.pos).toBe("top");
    expect(readTrack({ cues: [], style: "neon", pos: "side" })).toEqual({ v: 1, cues: [], style: "pop", pos: "bottom" });
    expect(readTrack(null)).toBeNull();
    expect(readTrack({ cues: "no" })).toBeNull();
  });
});

describe("p2 transcription availability", () => {
  test("only a real engine counts", () => {
    expect(transcriptionConfigured({ geminiKey: "", provider: "gemini", workerUrl: "", funasrUrl: "" })).toBe(false);
    expect(transcriptionConfigured({ geminiKey: "k", provider: "gemini", workerUrl: "", funasrUrl: "" })).toBe(true);
    expect(transcriptionConfigured({ geminiKey: "", provider: "funasr", workerUrl: "", funasrUrl: "" })).toBe(false);
    expect(transcriptionConfigured({ geminiKey: "", provider: "funasr", workerUrl: "https://w", funasrUrl: "" })).toBe(true);
    expect(transcriptionConfigured({ geminiKey: "", provider: "gemini", workerUrl: "https://w", funasrUrl: "" })).toBe(false);
  });
});

describe("p2 caption editor wiring", () => {
  const b = readFileSync(new URL("../components/create/CaptionBurner.tsx", import.meta.url), "utf8");
  const ts = readFileSync(new URL("../components/create/captions/TimeStepper.tsx", import.meta.url), "utf8");
  test("timing is editable on phones: no row control hidden below sm", () => {
    expect(b).not.toContain("hidden h-11 w-11");
    expect(b).toContain("aria-label={`Edit timing of caption ${i + 1}`}");
    expect(b).toContain('onCommit={(v) => retime(i, "start", v)}');
    expect(b).toContain('onNudge={(d) => nudge(i, "end", d)}');
    expect(ts).toContain('inputMode="decimal"');
    expect(ts).toContain("0.1 seconds earlier");
    expect(ts).toContain("0.1 seconds later");
  });
  test("no fake transcript: without an engine only the manual path shows", () => {
    expect(b).toContain("{aiReady !== false && (");
    // Phase 4: the run moved to the workspace caption store; it still flips to typing-only on NO_AI.
    const store = readFileSync(new URL("../components/create/captions/run-store.ts", import.meta.url), "utf8");
    expect(store).toContain('e.code === "NO_AI"');
    expect(store).toContain("aiReady: false");
    expect(b).toContain("AI transcription is not set up on this workspace.");
  });
  test("deletes can be undone and replacing lines asks first", () => {
    expect(b).toContain('label: "Undo"');
    expect(b).toContain("restoreCue(cuesRef.current, cue)");
    expect(b).toContain('title="Replace your caption lines?"');
  });
  test("a line can be added before any exist", () => {
    expect(b).toContain("{cues.length === 0 && (");
    expect(b.match(/onClick=\{add\}/g)?.length).toBe(2);
  });
  test("burn and .srt are validated", () => {
    expect(b).toContain("if (!cues.length || blocked()) return;");
    expect(b).toContain("if (blocked()) return;");
  });
  test("no em or en dashes in new copy", () => {
    for (const s of [b, ts]) expect(/[\u2013\u2014]/.test(s)).toBe(false);
  });
});

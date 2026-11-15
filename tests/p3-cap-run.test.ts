/**
 * Phase 3 (A1/A2): the chunk runner (first chunk alone, then a few at a time, retries, a failed part reported
 * without losing the rest, plan stops end the run, cancel) and the pure half of caption translation.
 */
import { describe, expect, test } from "bun:test";
import { ChunkFailure, runChunks } from "../lib/captions/run";
import { applyTranslation, batchIds, readAnswer, translatePrompt } from "../lib/captions/translate-core";
import type { Cue } from "../lib/captions/cues";

describe("p3 chunk runner", () => {
  test("first chunk alone, then at most three at once; every result kept by index", async () => {
    let live = 0;
    let peak = 0;
    const seen: number[] = [];
    const out = await runChunks([0, 1, 2, 3, 4, 5, 6], async (i) => {
      seen.push(i);
      if (i === 0) expect(live).toBe(0);
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, i === 0 ? 5 : 10));
      live--;
      return `chunk ${i}`;
    });
    expect(seen[0]).toBe(0);
    expect(peak).toBeLessThanOrEqual(3);
    expect([...out.results.keys()].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(out.results.get(4)).toBe("chunk 4");
    expect(out.failed).toEqual([]);
  });
  test("a passing failure is retried; one that keeps failing is reported and the others still count", async () => {
    const tries = new Map<number, number>();
    const done: number[] = [];
    const out = await runChunks(
      [0, 1, 2],
      async (i) => {
        tries.set(i, (tries.get(i) ?? 0) + 1);
        if (i === 1 && tries.get(1)! < 2) throw new ChunkFailure("busy", 503, "AI_FAILED");
        if (i === 2) throw new ChunkFailure("timings", 502, "BAD_TIMING");
        return i;
      },
      { backoffMs: 1, onDone: (_, n) => done.push(n) },
    );
    expect(tries.get(1)).toBe(2);
    expect(tries.get(2)).toBe(3);
    expect([...out.results.keys()].sort()).toEqual([0, 1]);
    expect(out.failed.map((f) => [f.index, f.error.code])).toEqual([[2, "BAD_TIMING"]]);
    expect(done).toEqual([1, 2, 3]);
  });
  test("a plan or quota stop ends the run at once and is not retried", async () => {
    let calls = 0;
    const out = await runChunks([0, 1, 2, 3], async () => {
      calls++;
      throw new ChunkFailure("limit", 402, "PLAN_LIMIT");
    }, { backoffMs: 1 });
    expect(calls).toBe(1);
    expect(out.fatal?.code).toBe("PLAN_LIMIT");
    const quota = await runChunks([0], async () => { throw new ChunkFailure("q", 429, "AI_QUOTA"); });
    expect(quota.fatal?.code).toBe("AI_QUOTA");
  });
  test("a rate limit 429 waits and tries again", async () => {
    let n = 0;
    const out = await runChunks([0], async () => {
      if (n++ === 0) throw new ChunkFailure("slow", 429, "RATE_LIMITED", { retryAfter: 0 });
      return "ok";
    }, { backoffMs: 1 });
    expect(out.results.get(0)).toBe("ok");
  });
  test("Stop cancels the run", async () => {
    const ctrl = new AbortController();
    const p = runChunks([0, 1], (_, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new DOMException("x", "AbortError")))), { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});

const te: Cue[] = [
  { start: 0.3, end: 1.9, text: "నమస్కారం అందరికీ," },
  { start: 1.9, end: 4.27, text: "ఈ రోజు మనం బిర్యానీ చేద్దాం." },
  { start: 4.5, end: 6, text: "చాలా సింపుల్ అండి." },
];

describe("p3 translation core", () => {
  test("batches carry neighbouring lines as context only", () => {
    const b = batchIds(100, undefined, 40, 3);
    expect(b.map((x) => x.ids.length)).toEqual([40, 40, 20]);
    expect(b[1].before).toEqual([37, 38, 39]);
    expect(b[1].after).toEqual([80, 81, 82]);
    expect(batchIds(10, [4, 4, 99, -1])).toEqual([{ ids: [4], before: [1, 2, 3], after: [5, 6, 7] }]);
  });
  test("the prompt names the language, asks for natural English and lists ids", () => {
    const p = translatePrompt(te, batchIds(3)[0], "te");
    expect(p).toContain("from Telugu into natural English");
    expect(p).toContain("1: ఈ రోజు మనం బిర్యానీ చేద్దాం.");
  });
  test("one answer per asked id: unknown ids, repeats, blanks and untranslated Telugu are dropped", () => {
    const raw = { lines: [{ id: 0, text: "Hello everyone," }, { id: 0, text: "dup" }, { id: 7, text: "made up" }, { id: 1, text: "  " }, { id: 2, text: "చాలా సింపుల్ అండి." }] };
    const m = readAnswer(raw, te, [0, 1, 2], "te");
    expect([...m]).toEqual([[0, "Hello everyone,"]]);
  });
  test("English keeps the original timing line for line; missing lines are listed, never invented", () => {
    const m = new Map([[0, "Hello everyone,"], [1, "today we're making biryani."]]);
    const out = applyTranslation(te, m);
    expect(out.cues.length).toBe(te.length);
    out.cues.forEach((c, i) => expect([c.start, c.end]).toEqual([te[i].start, te[i].end]));
    expect(out.cues[1].text).toBe("today we're making biryani.");
    expect(out.untranslated).toEqual([2]);
    expect(out.cues[2].text).toBe(te[2].text);
  });
});

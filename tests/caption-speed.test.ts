/**
 * Caption speed round: one chunk races a second try when the first is slow, the first good answer wins, and a
 * failed try moves to another model at once.
 */
import { describe, expect, test } from "bun:test";
import { hedged, hedgeAfterMs, type TryResult } from "../lib/captions/hedge";

const later = <T,>(ms: number, v: T, signal: AbortSignal) =>
  new Promise<T>((res, rej) => {
    const t = setTimeout(() => res(v), ms);
    signal.addEventListener("abort", () => (clearTimeout(t), rej(new DOMException("Cancelled", "AbortError"))), { once: true });
  });

describe("caption speed: hedged tries", () => {
  test("a fast first answer is the only try", async () => {
    const asked: string[] = [];
    const r = await hedged({ primary: "lite", fallbacks: ["flash"], hedgeMs: 50, budgetMs: 5_000, minLeftMs: () => 10, attempt: async (m, s) => (asked.push(m), later(5, { ok: true, value: m } as TryResult<string>, s)) });
    expect(r).toMatchObject({ ok: true, value: "lite", tries: 1 });
    expect(asked).toEqual(["lite"]);
  });
  test("a straggler gets a second try of the same model after hedgeMs; the first good answer wins, the slow one is aborted", async () => {
    let aborted = false;
    let n = 0;
    const r = await hedged({
      primary: "lite", fallbacks: ["flash"],
      hedgeMs: 20,
      budgetMs: 5_000,
      minLeftMs: () => 10,
      attempt: async (_m, s) => {
        if (++n === 1) {
          s.addEventListener("abort", () => (aborted = true));
          return later(1_000, { ok: true, value: "slow" } as TryResult<string>, s);
        }
        return later(10, { ok: true, value: "hedge" } as TryResult<string>, s);
      },
    });
    expect(r).toMatchObject({ ok: true, value: "hedge", model: "lite", tries: 2 });
    expect(aborted).toBe(true);
  });
  test("a failed try starts the next model at once, without waiting for hedgeMs", async () => {
    const t0 = Date.now();
    const r = await hedged({ primary: "lite", fallbacks: ["flash"], hedgeMs: 2_000, budgetMs: 5_000, minLeftMs: () => 10, attempt: async (m, s) => (m === "lite" ? { ok: false, reason: "lite 503", status: 503 } : later(5, { ok: true, value: m } as TryResult<string>, s)) });
    expect(r).toMatchObject({ ok: true, value: "flash", tries: 2 });
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
  test("every try failing reports the last reason; BAD_TIMING only when every failure was garbage timing; at most maxTries", async () => {
    let n = 0;
    const mixed = await hedged({ primary: "lite", fallbacks: ["flash"], hedgeMs: 2_000, budgetMs: 5_000, minLeftMs: () => 10, maxTries: 3, attempt: async () => (++n === 1 ? { ok: false, reason: "times jump back", badTiming: true } : { ok: false, reason: `boom ${n}` }) });
    expect(mixed).toMatchObject({ ok: false, reason: "boom 3", badTiming: false, rateLimited: false, tries: 3 });
    expect(n).toBe(3);
    const bad = await hedged({ primary: "lite", fallbacks: ["flash"], hedgeMs: 2_000, budgetMs: 5_000, minLeftMs: () => 10, attempt: async () => ({ ok: false, reason: "bunched", badTiming: true }) });
    expect(bad).toMatchObject({ ok: false, badTiming: true, tries: 3 });
  });
  test("a 429 ends the race at once, so the browser backs off instead of three refused tries", async () => {
    let n = 0;
    const r = await hedged({ primary: "lite", fallbacks: ["flash"], hedgeMs: 2_000, budgetMs: 5_000, minLeftMs: () => 10, attempt: async () => (n++, { ok: false, reason: "lite 429", status: 429 }) });
    expect(r).toMatchObject({ ok: false, rateLimited: true, tries: 1 });
    expect(n).toBe(1);
  });
  test("a fallback too slow for the time left gives way to the primary", async () => {
    const asked: string[] = [];
    let clock = 0;
    const r = await hedged({
      primary: "lite",
      fallbacks: ["flash"],
      hedgeMs: 60_000,
      budgetMs: 40_000,
      now: () => clock,
      minLeftMs: (m) => (m === "flash" ? 30_000 : 8_000),
      attempt: async (m) => {
        asked.push(m);
        if (asked.length === 1) {
          clock = 20_000;
          return { ok: false, reason: "lite 503", status: 503 };
        }
        return { ok: true, value: m };
      },
    });
    expect(asked).toEqual(["lite", "lite"]);
    expect(r).toMatchObject({ ok: true, value: "lite" });
  });
  test("a try that never settles still ends inside the budget", async () => {
    const r = await hedged({ primary: "lite", hedgeMs: 10_000, budgetMs: 40, minLeftMs: () => 1, attempt: () => new Promise<TryResult<number>>(() => {}) });
    expect(r).toMatchObject({ ok: false, reason: "timed out", badTiming: false });
  });
  test("a hedge goes only to a slow primary, never on top of a fallback started for a failure", async () => {
    const asked: string[] = [];
    const r = await hedged({
      primary: "lite",
      fallbacks: ["flash"],
      hedgeMs: 20,
      budgetMs: 5_000,
      minLeftMs: () => 10,
      attempt: async (m, s) => {
        asked.push(m);
        return m === "lite" ? { ok: false, reason: "lite 500", status: 500 } : later(80, { ok: true, value: m } as TryResult<string>, s);
      },
    });
    expect(r).toMatchObject({ ok: true, value: "flash" });
    expect(asked).toEqual(["lite", "flash"]);
  });
  test("no try starts with too little budget left, and a cancel ends it as cancelled", async () => {
    const none = await hedged({ primary: "lite", hedgeMs: 10, budgetMs: 5, minLeftMs: () => 1_000, attempt: async () => ({ ok: true, value: 1 }) });
    expect(none).toMatchObject({ ok: false, tries: 0 });
    const c = new AbortController();
    const p = hedged({ primary: "lite", hedgeMs: 1_000, budgetMs: 5_000, minLeftMs: () => 10, signal: c.signal, attempt: (_m, s) => later(2_000, { ok: true, value: 1 } as TryResult<number>, s) });
    setTimeout(() => c.abort(), 10);
    expect(await p).toMatchObject({ ok: false, reason: "cancelled" });
  });
  test("each try gets the time left as its timeout, and the hedge point grows with the audio", async () => {
    const got: number[] = [];
    await hedged({ primary: "lite", hedgeMs: 1_000, budgetMs: 40_000, minLeftMs: () => 10, attempt: async (_m, _s, t) => (got.push(t), { ok: true, value: 1 }) });
    expect(got[0]).toBeGreaterThan(39_000);
    expect(got[0]).toBeLessThanOrEqual(40_000);
    expect(hedgeAfterMs(5)).toBe(9_000);
    expect(hedgeAfterMs(30)).toBe(15_000);
    expect(hedgeAfterMs(60)).toBe(24_000);
    expect(hedgeAfterMs(600)).toBe(24_000);
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BENCH_MS, SLOW_BENCH_MS, cleanJson, deltaText, freshStat, isHardFailure, keyOf, partialArray, partialString, rank, recordFail, recordOk, sseEvents, type ModelId, type ModelStat } from "@/lib/ai/llm-core";
import { env } from "@/lib/env";
import { llmText, modelStats } from "@/lib/ai/llm";
import { generateHooks, generatePlatformCopy, type HookPart, type PlatformCopy } from "@/lib/ai/creative";

const lite: ModelId = { provider: "gemini", model: "gemini-flash-lite-latest" };
const lite35: ModelId = { provider: "gemini", model: "gemini-3.5-flash-lite" };
const kimi: ModelId = { provider: "kimi", model: "kimi-k2.6" };

describe("1053 model router: ranking and health", () => {
  test("fastest first, from the benchmark priors", () => {
    expect(rank([kimi, lite35, lite], new Map(), 0).map((m) => m.model)).toEqual(["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "kimi-k2.6"]);
  });
  test("measured speed beats the prior: a faster Kimi goes first", () => {
    const stats = new Map<string, ModelStat>([[keyOf(kimi), { ...freshStat(kimi), ewmaMs: 600, samples: 4 }]]);
    expect(rank([lite, kimi], stats, 0)[0]).toEqual(kimi);
  });
  test("an out-of-credit model is benched for ten minutes, then comes back", () => {
    const s = recordFail(freshStat(kimi), 1_000, isHardFailure(429, "account suspended due to insufficient balance"));
    expect(s.benchedUntil).toBe(1_000 + BENCH_MS);
    const stats = new Map([[keyOf(kimi), { ...s, ewmaMs: 10 }]]);
    expect(rank([kimi, lite], stats, 2_000)[0]).toEqual(lite); // benched, even though "faster"
    expect(rank([kimi, lite], stats, 1_000 + BENCH_MS + 1)[0]).toEqual(kimi);
  });
  test("one blip does not bench; two in a row bench briefly; a good answer clears it", () => {
    const one = recordFail(freshStat(lite), 0, false);
    expect(one.benchedUntil).toBe(0);
    const two = recordFail(one, 5, false);
    expect(two.benchedUntil).toBe(5 + SLOW_BENCH_MS);
    const ok = recordOk(two, 900);
    expect(ok.fails).toBe(0);
    expect(ok.benchedUntil).toBe(0);
  });
  test("recordOk moves the average toward the new time", () => {
    const s = recordOk(freshStat(lite), 700);
    expect(s.ewmaMs).toBe(1_200);
    expect(s.samples).toBe(1);
  });
  test("hard failures: bad key, gone model, no credit. A plain rate limit is a blip", () => {
    expect(isHardFailure(401)).toBe(true);
    expect(isHardFailure(404)).toBe(true);
    expect(isHardFailure(429, "Your account is suspended")).toBe(true);
    expect(isHardFailure(429, "Too many requests, slow down")).toBe(false);
    expect(isHardFailure(503)).toBe(false);
  });
});

describe("1053 model router: reading streams", () => {
  test("SSE split keeps the unfinished tail and drops [DONE]", () => {
    const { events, rest } = sseEvents('data: {"a":1}\n\ndata: [DONE]\n\ndata: {"b"');
    expect(events).toEqual(['{"a":1}']);
    expect(rest).toBe('data: {"b"');
  });
  test("CRLF separators work too", () => {
    expect(sseEvents('data: {"a":1}\r\n\r\n').events).toEqual(['{"a":1}']);
  });
  test("Gemini text skips thought parts; Kimi reads the delta", () => {
    expect(deltaText("gemini", JSON.stringify({ candidates: [{ content: { parts: [{ text: "plan", thought: true }, { text: "Hi" }] } }] }))).toBe("Hi");
    expect(deltaText("kimi", JSON.stringify({ choices: [{ delta: { content: "yo" } }] }))).toBe("yo");
    expect(deltaText("kimi", "not json")).toBe("");
  });
  test("partialArray returns only finished items, and braces or quotes inside strings never confuse it", () => {
    const half = '{"hooks":[{"angle":"A","text":"curly } brace \\" quote {"},{"angle":"B","text":"second"},{"angle":"C","te';
    expect(partialArray<{ text: string }>(half, "hooks").map((h) => h.text)).toEqual(['curly } brace " quote {', "second"]);
    expect(partialArray('{"other":[]}', "hooks")).toEqual([]);
  });
  test("a bare array (the model dropped the wrapper) streams too", () => {
    expect(partialArray<{ p: string }>('[{"p":"x"},{"p":"y"', "items")).toEqual([{ p: "x" }]);
  });
  test("partialString waits for the closing quote", () => {
    expect(partialString('{"understood":"Half wri', "understood")).toBeNull();
    expect(partialString('{"understood":"Done \\"here\\"","x', "understood")).toBe('Done "here"');
  });
  test("cleanJson strips fences and chatter", () => {
    expect(cleanJson('Sure!\n```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

/* ------------------------------------------------------------------ */
/* The race itself, against a fake network                              */
/* ------------------------------------------------------------------ */

type Plan = { delay?: number; status?: number; body?: string; chunks?: string[]; gap?: number };
const realFetch = globalThis.fetch;
const saved = { g: env.GEMINI_API_KEY, k: env.KIMI_API_KEY };
let calls: string[] = [];

function sse(chunks: string[], provider: "gemini" | "kimi", gap: number, signal?: AbortSignal | null) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(c) {
      for (const t of chunks) {
        await Bun.sleep(gap);
        if (signal?.aborted) return c.error(new DOMException("aborted", "AbortError"));
        const data = provider === "gemini" ? { candidates: [{ content: { parts: [{ text: t }] } }] } : { choices: [{ delta: { content: t } }] };
        c.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      }
      c.close();
    },
  });
}

function fake(plans: Record<string, Plan>) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const name = u.includes("moonshot") ? `kimi:${body.model}` : `gemini:${/models\/([^:]+)/.exec(u)?.[1]}`;
    calls.push(name);
    const p = plans[name] ?? { status: 500, body: "no plan" };
    await new Promise<void>((res, rej) => {
      const t = setTimeout(res, p.delay ?? 0);
      init?.signal?.addEventListener("abort", () => (clearTimeout(t), rej(new DOMException("aborted", "AbortError"))));
    });
    if (p.status && p.status !== 200) return new Response(p.body ?? "", { status: p.status });
    return new Response(sse(p.chunks ?? [], name.startsWith("kimi") ? "kimi" : "gemini", p.gap ?? 5, init?.signal), { status: 200 });
  }) as typeof fetch;
}

describe("1053 model router: the race", () => {
  beforeEach(() => {
    calls = [];
    (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "test-key";
    (env as { KIMI_API_KEY: string }).KIMI_API_KEY = "";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = saved.g;
    (env as { KIMI_API_KEY: string }).KIMI_API_KEY = saved.k;
  });

  test("a failing first model hands over at once, not after a timeout", async () => {
    fake({ "gemini:m1": { status: 503 }, "gemini:m2": { chunks: ['{"ok":', "true}"] } });
    const t0 = Date.now();
    const r = await llmText("s", "p-failover", { models: ["m1", "m2"], timeoutMs: 5_000 });
    expect(r).toEqual({ text: '{"ok":true}', model: "m2" });
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  test("a silent first model is raced after the hedge delay, and the writer wins", async () => {
    fake({ "gemini:slowA": { delay: 4_500, chunks: ['{"who":"A"}'] }, "gemini:fastB": { chunks: ['{"who":"B"}'] } });
    const t0 = Date.now();
    const r = await llmText("s", "p-hedge", { models: ["slowA", "fastB"], timeoutMs: 6_000 });
    expect(r?.model).toBe("fastB");
    expect(Date.now() - t0).toBeLessThan(4_000); // 2.5 s hedge + a few ms, never the 4.5 s of A
  });

  test("Kimi takes over when Gemini is down, and an out-of-credit Kimi sits out next time", async () => {
    (env as { KIMI_API_KEY: string }).KIMI_API_KEY = "k";
    fake({ "gemini:gdown": { status: 500 }, "kimi:kimi-k2.6": { chunks: ['{"from":"kimi"}'] } });
    expect((await llmText("s", "p-kimi", { models: ["gdown"], timeoutMs: 5_000 }))?.model).toBe("kimi-k2.6");
    // Kimi just won, so it is now measured fastest and goes first. Then its credit runs out.
    fake({ "gemini:gup": { chunks: ['{"a":1}'] }, "kimi:kimi-k2.6": { status: 429, body: "account suspended due to insufficient balance" } });
    calls = [];
    expect((await llmText("s", "p-kimi2", { models: ["gup"], timeoutMs: 5_000 }))?.model).toBe("gup");
    expect(calls).toEqual(["kimi:kimi-k2.6", "gemini:gup"]);
    expect((modelStats()["kimi:kimi-k2.6"] as ModelStat).benchedUntil).toBeGreaterThan(Date.now() + BENCH_MS - 5_000);
    // Next ask: the benched Kimi is not tried first any more.
    calls = [];
    await llmText("s", "p-kimi3", { models: ["gup"], timeoutMs: 5_000 });
    expect(calls).toEqual(["gemini:gup"]);
  });

  test("onText streams the growing text, and an identical ask within the cache window costs no call", async () => {
    fake({ "gemini:c1": { chunks: ['{"x":', '"y"}'] } });
    const seen: string[] = [];
    const a = await llmText("s", "p-cache", { models: ["c1"], cacheKey: "u1", onText: (t) => seen.push(t) });
    expect(seen.at(-1)).toBe('{"x":"y"}');
    expect(seen.length).toBeGreaterThanOrEqual(2);
    calls = [];
    const b = await llmText("s", "p-cache", { models: ["c1"], cacheKey: "u1" });
    expect(b?.text).toBe(a?.text);
    expect(calls).toEqual([]);
    const c = await llmText("s", "p-cache", { models: ["c1"], cacheKey: "u2" }); // another user: no sharing
    expect(c?.text).toBe(a?.text);
    expect(calls).toEqual(["gemini:c1"]);
  });

  test("nothing answers in time: null, so callers fall back to the offline writer", async () => {
    fake({ "gemini:hang": { delay: 3_000, chunks: ["{}"] } });
    expect(await llmText("s", "p-hang", { models: ["hang"], timeoutMs: 300 })).toBeNull();
  });

  test("the caller leaving cancels every model", async () => {
    fake({ "gemini:long": { delay: 2_000, chunks: ["{}"] } });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    const t0 = Date.now();
    expect(await llmText("s", "p-abort", { models: ["long"], signal: ctrl.signal })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
  });

  test("hooks stream in order: understood, original, then each hook as it finishes", async () => {
    const json = JSON.stringify({ understood: "You opened a bakery.", original: "My bakery", hooks: [{ angle: "The twist", text: "Hook one" }, { angle: "The number", text: "Hook two" }, { angle: "The ask", text: "Hook three" }] });
    const chunks = json.match(/.{1,12}/g)!;
    fake({ "gemini:gemini-flash-lite-latest": { chunks, gap: 2 } });
    const parts: HookPart[] = [];
    const r = await generateHooks("I opened a bakery in my garage", "default", [], { models: ["gemini-flash-lite-latest"], onPart: (p) => parts.push(p) });
    expect(parts.map((p) => p.t)).toEqual(["understood", "original", "hook", "hook", "hook"]);
    expect(r.source).toBe("gemini");
    expect(r.hooks.map((h) => h.text)).toEqual(["Hook one", "Hook two", "Hook three"]);
  });

  test("platform copy streams one item per place, shaped like the final answer", async () => {
    const json = JSON.stringify({ items: [{ platform: "x", caption: "Short and sharp", hashtags: "" }, { platform: "instagram", caption: "Hook up front", hashtags: ["bake", "#bread"] }] });
    fake({ "gemini:gemini-flash-lite-latest": { chunks: json.match(/.{1,15}/g)!, gap: 2 } });
    const got: PlatformCopy[] = [];
    const final = await generatePlatformCopy("bakery", "Hook one", ["instagram", "x"], { models: ["gemini-flash-lite-latest"], onItem: (c) => got.push(c) });
    expect(got.map((c) => c.platform)).toEqual(["x", "instagram"]);
    for (const c of got) expect(final.find((f) => f.platform === c.platform)).toEqual(c);
  });

  test("platform copy sent as a bare array is used, not thrown away for the offline copy", async () => {
    fake({ "gemini:gemini-flash-lite-latest": { chunks: [JSON.stringify([{ platform: "x", caption: "From the model", hashtags: "" }])] } });
    const final = await generatePlatformCopy("bakery", "Hook one", ["x"], { models: ["gemini-flash-lite-latest"] });
    expect(final[0].caption).toContain("From the model");
  });
});

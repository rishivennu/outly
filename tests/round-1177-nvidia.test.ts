import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deltaText, freshStat, keyOf, rank, type ModelId, type ModelStat } from "@/lib/ai/llm-core";
import { env } from "@/lib/env";
import { llmText, nvidiaRequest } from "@/lib/ai/llm";
import { blogJson, blogModelLabel, blogReady, blogWebJson } from "@/lib/blog/llm";

/** R1177: NVIDIA NIM is the default provider; Gemini and Kimi stand behind it. */

type Env = { GEMINI_API_KEY: string; KIMI_API_KEY: string; NVIDIA_API_KEY: string; NVIDIA_MODEL: string };
const e = env as unknown as Env;
const saved = { ...e };
const realFetch = globalThis.fetch;
type Seen = { url: string; body: any };
let seen: Seen[] = [];

type Reply = { status?: number; events?: unknown[]; json?: unknown; throws?: boolean };
function fake(route: (url: string, body: any) => Reply) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ url: u, body });
    const r = route(u, body);
    if (r.throws) throw new Error("network down");
    if (r.status && r.status !== 200) return new Response("busy", { status: r.status });
    if (r.json !== undefined) return new Response(JSON.stringify(r.json), { status: 200, headers: { "content-type": "application/json" } });
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ev of r.events ?? []) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
}
const oai = (...parts: string[]) => parts.map((content) => ({ choices: [{ delta: { content } }] }));
const gem = (text: string) => [{ candidates: [{ content: { parts: [{ text }] } }] }];
const isNim = (u: string) => u.startsWith("https://integrate.api.nvidia.com/");

beforeEach(() => {
  seen = [];
  e.GEMINI_API_KEY = "g-test";
  e.KIMI_API_KEY = "";
  e.NVIDIA_API_KEY = "nv-test";
  e.NVIDIA_MODEL = saved.NVIDIA_MODEL;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(e, saved);
});

describe("R1177 NVIDIA first", () => {
  test("with NVIDIA and Gemini keys the first model asked is NVIDIA_MODEL", async () => {
    fake((u) => (isNim(u) ? { events: oai('{"ok":1}') } : { events: gem('{"ok":2}') }));
    const r = await llmText("s", "p-1177-first", { timeoutMs: 3_000 });
    expect(seen[0].url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(seen[0].body.model).toBe(env.NVIDIA_MODEL);
    expect(r).toEqual({ text: '{"ok":1}', model: env.NVIDIA_MODEL });
  });

  test("with images the vision model is asked and the user turn carries an image_url part", async () => {
    fake((u) => (isNim(u) ? { events: oai('{"seen":true}') } : { status: 500 }));
    const r = await llmText("s", "p-1177-vision", { timeoutMs: 3_000, images: [{ mime: "image/jpeg", data: "QUJD" }] });
    expect(r?.model).toBe(env.NVIDIA_VISION_MODEL);
    expect(seen[0].body.model).toBe(env.NVIDIA_VISION_MODEL);
    const user = seen[0].body.messages[1].content;
    expect(user[0]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });
    expect(user.at(-1)).toEqual({ type: "text", text: "p-1177-vision" });
  });

  test("NIM answers 503 on both models: Gemini answers and its model is the result", async () => {
    fake((u) => (isNim(u) ? { status: 503 } : { events: gem('{"from":"gemini"}') }));
    const r = await llmText("s", "p-1177-fallback", { models: ["g-1177"], timeoutMs: 3_000 });
    expect(r).toEqual({ text: '{"from":"gemini"}', model: "g-1177" });
    expect(seen.filter((x) => isNim(x.url)).map((x) => x.body.model)).toEqual([env.NVIDIA_MODEL, env.NVIDIA_FAST_MODEL]);
  });

  test("a reasoning_content delta never reaches the text, only content does", async () => {
    fake(() => ({ events: [{ choices: [{ delta: { reasoning_content: "let me think" } }] }, ...oai('{"a":', "1}")] }));
    const r = await llmText("s", "p-1177-reason", { providers: ["nvidia"], timeoutMs: 3_000 });
    expect(r?.text).toBe('{"a":1}');
    expect(deltaText("nvidia", JSON.stringify({ choices: [{ delta: { reasoning_content: "x" } }] }))).toBe("");
  });
});

describe("R1177 nvidiaRequest", () => {
  const base = { model: "nvidia/nemotron-3-ultra-550b-a55b", stream: true, messages: [] };
  test("defaults: max_tokens, temperature, thinking off, JSON, no OpenRouter reasoning field", () => {
    const r = nvidiaRequest("k", base, {});
    const b = r.body as Record<string, any>;
    expect(r.url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(r.headers.authorization).toBe("Bearer k");
    expect(b.max_tokens).toBe(4096);
    expect(b.temperature).toBe(0.6);
    expect(b.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(b.response_format).toEqual({ type: "json_object" });
    expect("reasoning" in b).toBe(false);
  });
  test("reasoning:true turns thinking on; json:false drops response_format; caller values win", () => {
    const b = nvidiaRequest("k", base, { reasoning: true, json: false, maxTokens: 900, temperature: 0.2 }).body as Record<string, any>;
    expect(b.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(b.response_format).toBeUndefined();
    expect(b.max_tokens).toBe(900);
    expect(b.temperature).toBe(0.2);
  });
  test("deepseek ids use `thinking`; other vendors get no template kwargs", () => {
    expect((nvidiaRequest("k", { model: "deepseek-ai/deepseek-v4.1-flash" }, {}).body as any).chat_template_kwargs).toEqual({ thinking: false });
    expect((nvidiaRequest("k", { model: "mistralai/mistral-large-4" }, {}).body as any).chat_template_kwargs).toBeUndefined();
  });
});

describe("R1177 rank with prefer", () => {
  const ultra: ModelId = { provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b" };
  const lite: ModelId = { provider: "gemini", model: "gemini-flash-lite-latest" };
  const kimi: ModelId = { provider: "kimi", model: "kimi-k2.6" };
  test("an unbenched slower NVIDIA model stays first", () => {
    const stats = new Map<string, ModelStat>([[keyOf(ultra), { ...freshStat(ultra), ewmaMs: 9_000, samples: 3 }]]);
    expect(rank([lite, kimi, ultra], stats, 0, "nvidia")).toEqual([ultra, lite, kimi]);
  });
  test("preferred models keep their listed order: the main model first, the faster one as its hedge", () => {
    const fast: ModelId = { provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b" };
    expect(rank([ultra, fast, lite], new Map(), 0, "nvidia")).toEqual([ultra, fast, lite]);
    expect(rank([ultra, fast, lite], new Map(), 0)).toEqual([fast, lite, ultra]);
  });
  test("a benched NVIDIA model drops behind a healthy Gemini one", () => {
    const stats = new Map<string, ModelStat>([[keyOf(ultra), { ...freshStat(ultra), benchedUntil: 10_000 }]]);
    expect(rank([ultra, lite], stats, 5_000, "nvidia")).toEqual([lite, ultra]);
  });
  test("without prefer the speed order holds", () => {
    expect(rank([kimi, lite, ultra], new Map(), 0)).toEqual([lite, ultra, kimi]);
  });
});

describe("R1177 blog on NVIDIA", () => {
  // round-1175-blog.test.ts replaces lib/blog/llm for the whole run (bun mock.module); this flag asks its fake to
  // hand every call to the real module while these tests run.
  const g = globalThis as { __blogLlmReal?: boolean };
  beforeEach(() => void (g.__blogLlmReal = true));
  afterEach(() => void (g.__blogLlmReal = false));
  test("ready with only an NVIDIA key, and blogJson goes to NIM", async () => {
    e.GEMINI_API_KEY = "g-test";
    expect(blogReady()).toBe(true);
    fake((u) => (isNim(u) ? { events: oai('{"title":"T"}') } : { events: gem('{"title":"G"}') }));
    const r = await blogJson<{ title: string }>("s", "p-1177-blog");
    expect(r.data.title).toBe("T");
    expect(seen.every((x) => isNim(x.url))).toBe(true);
  });
  test("blogWebJson without OpenRouter writes on NIM with webUsed false", async () => {
    fake((u) => (isNim(u) ? { events: oai('{"facts":[]}') } : { status: 500 }));
    const r = await blogWebJson<{ facts: unknown[] }>("s", "p-1177-web-plain");
    expect(r).toEqual({ data: { facts: [] }, citations: [], webUsed: false });
    expect(isNim(seen[0].url)).toBe(true);
  });
  test("blogWebJson with an OpenRouter key whose call fails falls back to NIM", async () => {
    e.KIMI_API_KEY = "sk-or-test";
    fake((u) => (u.includes("openrouter.ai") && seen.length === 1 ? { throws: true } : isNim(u) ? { events: oai('{"facts":["x"]}') } : { status: 500 }));
    const warn = console.warn;
    console.warn = () => {};
    try {
      const r = await blogWebJson<{ facts: string[] }>("s", "p-1177-web-fail");
      expect(r).toEqual({ data: { facts: ["x"] }, citations: [], webUsed: false });
    } finally {
      console.warn = warn;
    }
    expect(seen[0].url).toContain("openrouter.ai");
    expect(isNim(seen[1].url)).toBe(true);
  });
  test("blogWebJson with OpenRouter answering 502 falls back too", async () => {
    e.KIMI_API_KEY = "sk-or-test";
    fake((u) => (u.includes("openrouter.ai") && !seen.slice(0, -1).length ? { status: 502 } : isNim(u) ? { events: oai('{"ok":true}') } : { status: 500 }));
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect((await blogWebJson<{ ok: boolean }>("s", "p-1177-web-502")).webUsed).toBe(false);
    } finally {
      console.warn = warn;
    }
  });
  test("no key at all: the error names both keys", async () => {
    e.NVIDIA_API_KEY = "";
    expect(blogReady()).toBe(false);
    await expect(blogJson("s", "p")).rejects.toThrow("No AI key is set for the blog (NVIDIA_API_KEY or KIMI_API_KEY).");
  });
  test("model label: default NIM id, a swapped id, and Kimi only", () => {
    expect(blogModelLabel()).toBe("Nemotron 3 Ultra (NVIDIA)");
    e.NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
    expect(blogModelLabel()).toBe("Nemotron 3.5 Lightning (NVIDIA)");
    e.NVIDIA_API_KEY = "";
    e.KIMI_API_KEY = "sk-or-test";
    expect(blogModelLabel()).toBe("Kimi K2.6");
  });
});

describe("R1177 house style", () => {
  const files = ["lib/ai/llm.ts", "lib/ai/llm-core.ts", "lib/blog/llm.ts", "components/admin/blog/BlogSettingsForm.tsx", "components/admin/blog/GenerateDesk.tsx", "components/admin/blog/TodayBlogCard.tsx", "app/admin/(panel)/blog/settings/page.tsx", "tests/round-1177-nvidia.test.ts"];
  test("no em dash, en dash or emoji in the files this round touched", () => {
    const bad = new RegExp("[\\u2013\\u2014]|\\p{Extended_Pictographic}", "u");
    for (const f of files) expect([f, bad.test(readFileSync(join(import.meta.dir, "..", f), "utf8"))]).toEqual([f, false]);
  });
});

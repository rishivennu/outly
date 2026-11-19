/**
 * 1174: the auto caption (Pip watching the video) failed silently all day. Two causes, two fixes:
 * - The Gemini project is on the free tier and 3.6-flash ran out of its daily requests; every image call skipped
 *   Kimi, so nothing else could look at the frames. Kimi K2.6 reads images, so it now takes them as OpenAI content
 *   parts and answers when Gemini is throttled or down.
 * - The workspace turned every failure into a blank. A busy AI is now said out loud, with "Watch it again".
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { env } from "../lib/env";
import { isOpenRouterKey, kimiRequest, kimiUser, llmText, resetModelStats } from "../lib/ai/llm";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("1174 Kimi reads images", () => {
  test("kimiUser: plain text without pictures; pictures as data URLs first and the prompt last with them", () => {
    expect(kimiUser("look")).toBe("look");
    expect(kimiUser("look", [{ mime: "image/jpeg", data: "QUJD" }, { mime: "image/png", data: "REVG" }])).toEqual([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
      { type: "image_url", image_url: { url: "data:image/png;base64,REVG" } },
      { type: "text", text: "look" },
    ]);
  });

  const realFetch = globalThis.fetch;
  const saved = { g: env.GEMINI_API_KEY, k: env.KIMI_API_KEY };
  let sent: { url: string; body: any }[] = [];
  afterEach(() => {
    globalThis.fetch = realFetch;
    (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = saved.g;
    (env as { KIMI_API_KEY: string }).KIMI_API_KEY = saved.k;
  });

  test("Gemini out of free-tier quota: Kimi gets the same frames and its story is used", async () => {
    (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "g";
    (env as { KIMI_API_KEY: string }).KIMI_API_KEY = "k";
    // Earlier files bench Gemini with their own mocked 429s (the stats live for the whole process): start clean.
    resetModelStats();
    sent = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (!u.includes("generativelanguage") && !u.includes("moonshot")) return realFetch(url, init);
      sent.push({ url: u, body: JSON.parse(String(init?.body ?? "{}")) });
      if (u.includes("generativelanguage")) return new Response(JSON.stringify({ error: { code: 429, message: "Generate content requests per day limit exceeded on Free Tier", status: "RESOURCE_EXHAUSTED" } }), { status: 429 });
      const data = { choices: [{ delta: { content: '{"story":"from kimi"}' } }] };
      return new Response(`data: ${JSON.stringify(data)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const r = await llmText("sys", "look", { images: [{ mime: "image/jpeg", data: "QUJD" }], json: true, timeoutMs: 8000, cacheKey: "t1174" });
    expect(r).toEqual({ text: '{"story":"from kimi"}', model: "kimi-k2.6" });
    const k = sent.find((s) => s.url.includes("moonshot"))!;
    expect(k).toBeDefined();
    expect(k.body.messages[1].content).toEqual([{ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } }, { type: "text", text: "look" }]);
    expect(sent.some((s) => s.url.includes("generativelanguage"))).toBe(true);
  });
});

describe("1174 Kimi through OpenRouter", () => {
  const realFetch = globalThis.fetch;
  const saved = { g: env.GEMINI_API_KEY, k: env.KIMI_API_KEY };
  afterEach(() => {
    globalThis.fetch = realFetch;
    (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = saved.g;
    (env as { KIMI_API_KEY: string }).KIMI_API_KEY = saved.k;
  });
  test("a Moonshot key goes to Moonshot untouched", () => {
    expect(isOpenRouterKey("sk-S0abc")).toBe(false);
    const r = kimiRequest("sk-S0abc", { model: "kimi-k2.6", stream: true }, {});
    expect(r.url).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect(r.headers).toEqual({ authorization: "Bearer sk-S0abc" });
    expect(r.body).toEqual({ model: "kimi-k2.6", stream: true });
  });
  test("an sk-or key goes to openrouter.ai as moonshotai/kimi-k2.6, bounded, reasoning off unless asked", () => {
    expect(isOpenRouterKey("sk-or-v1-x")).toBe(true);
    const r = kimiRequest("sk-or-v1-x", { model: "kimi-k2.6", stream: true, messages: [] }, {});
    expect(r.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(r.headers.authorization).toBe("Bearer sk-or-v1-x");
    expect(r.headers["HTTP-Referer"]).toBe("https://outlly.com");
    expect(r.body).toEqual({ model: "moonshotai/kimi-k2.6", stream: true, messages: [], max_tokens: 4096, reasoning: { enabled: false } });
    const long = kimiRequest("sk-or-v1-x", { model: "kimi-k2.6" }, { maxTokens: 12_000, reasoning: true });
    expect(long.body).toMatchObject({ max_tokens: 12_000, reasoning: { enabled: true } });
  });
  test("llmText with an sk-or key streams from OpenRouter and the answer is used", async () => {
    (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "";
    (env as { KIMI_API_KEY: string }).KIMI_API_KEY = "sk-or-v1-test";
    const seen: { url: string; body: any; headers: Record<string, string> }[] = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
      const data = { choices: [{ delta: { content: '{"ok":true}' } }] };
      return new Response(`: OPENROUTER PROCESSING\n\ndata: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const r = await llmText("sys", "hi", { json: true, timeoutMs: 5000, cacheKey: "t1174or" });
    expect(r).toEqual({ text: '{"ok":true}', model: "kimi-k2.6" });
    expect(seen[0].url).toContain("openrouter.ai");
    expect(seen[0].body.model).toBe("moonshotai/kimi-k2.6");
    expect(seen[0].headers.authorization).toBe("Bearer sk-or-v1-test");
  });
});

describe("1174 a busy AI is said, not hidden", () => {
  test("the workspace marks a busy or failed watch and offers to watch again", () => {
    expect(src("components/create/types.ts")).toContain('| { kind: "failed"; why?: string }');
    const w = src("components/create/CreateWorkspace.tsx");
    expect(w).toContain('if (r.skipped === "busy" || (!r.skipped && !story)) return setWatch({ kind: "failed" });');
    expect(w).toContain("if (r.skipped || !story) return setWatch(NO_WATCH);"); // a plan or quota stop stays quiet
    expect(w).toContain('if (!ctrl.signal.aborted) setWatch({ kind: "failed", ...(e instanceof ApiError && e.status !== 503 ? { why: e.message } : {}) });');
    // R1209 A3: the retry is the page's own Try again (Generate caption), so the assistant has no second one.
    expect(w).toContain("onGenerate={analyze}");
    expect(w).not.toContain("onRewatch={rewatch}");
    const a = src("components/create/Assistant.tsx");
    expect(a).not.toContain("Watch it again");
    expect(a).not.toContain("onRewatch");
    expect(src("components/create/StoryComposer.tsx")).toContain('{failed ? "Try again" : "Generate caption"}');
  });
  test("the route says in the log what was asked when no model answered", () => {
    expect(src("app/api/ai/video-caption/route.ts")).toContain("[video-caption] no model watched the video:");
  });
});

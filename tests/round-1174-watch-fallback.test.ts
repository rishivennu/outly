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
import { kimiUser, llmText } from "../lib/ai/llm";

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

describe("1174 a busy AI is said, not hidden", () => {
  test("the workspace marks a busy or failed watch and offers to watch again", () => {
    expect(src("components/create/types.ts")).toContain('| { kind: "failed" }');
    const w = src("components/create/CreateWorkspace.tsx");
    expect(w).toContain('if (r.skipped === "busy" || (!r.skipped && !story)) return setWatch({ kind: "failed" });');
    expect(w).toContain("if (r.skipped || !story) return setWatch(NO_WATCH);"); // a plan or quota stop stays quiet
    expect(w).toContain('if (!ctrl.signal.aborted) setWatch({ kind: "failed" });');
    expect(w).toContain("if (watchUrl.current) void watchVideo(watchUrl.current);");
    expect(w).toContain("onRewatch={rewatch}");
    const a = src("components/create/Assistant.tsx");
    expect(a).toContain('p.watch?.kind === "failed"');
    expect(a).toContain("Watch it again");
    expect(a).toContain("p.onRewatch?.()");
    // the story ideas still show under the failed note, so typing stays the easy way out
    expect(a).toContain('p.watch.kind === "idle" || p.watch.kind === "failed"');
  });
  test("the route says in the log what was asked when no model answered", () => {
    expect(src("app/api/ai/video-caption/route.ts")).toContain("[video-caption] no model watched the video:");
  });
});

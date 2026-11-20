/**
 * 1160: the Outlly assistant watches a video (frames the browser read from the file, plus the transcript when
 * captions were already read) and writes the "what's this video about" story the caption writers start from. The
 * creator uses it, edits it first, or types their own; nothing lands in the box without a tap.
 * Also 11-16: the phone tab bar shows on /create again, with the post actions bar sitting above it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import { env } from "../lib/env";
import { narrates, TRANSCRIPT_MAX, videoPrompt } from "../lib/ai/video-caption";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("1160 prompt", () => {
  test("says how many frames, the length, and carries the transcript when there is one", () => {
    const p = videoPrompt(4, "Day one of the shop.\nWe sold out by noon.", 42.4);
    expect(p).toContain("These are 4 frames from one video");
    expect(p).toContain("It is 42 seconds long.");
    expect(p).toContain("We sold out by noon.");
    expect(p).toContain('{"seen": string, "point": string, "caption": string}'); // R1180: look, understand, then write
  });
  test("one frame, no transcript: says so and goes by the frames", () => {
    const p = videoPrompt(1, null);
    expect(p).toContain("These are 1 frame from one video");
    expect(p).toContain("There is no transcript");
    expect(p).not.toContain("seconds long");
  });
  test("a very long transcript is cut, never dropped", () => {
    const p = videoPrompt(3, "x".repeat(TRANSCRIPT_MAX * 3), 10);
    expect(p.length).toBeLessThan(TRANSCRIPT_MAX + 1200);
    expect(p).toContain("x".repeat(100));
  });
});

describe("R1180 a caption, not a frame report", () => {
  test("the 11-17 NVIDIA answer is caught as narration; real captions are not", () => {
    expect(narrates("A South Park style scene shows a board meeting with a sign that says HQ BOARD MEETING. Characters stand behind boxes labeled TYLER INC and PRIYA INC while captions say transitioned its like fired and investors are furious. A phone screen shows captions on the video being transcribed. The final scene shows one character raising a hand with the caption Post it First decision as CEO.")).toBe(true);
    expect(narrates("In this video we see me at the market. The next scene is the stall.")).toBe(true);
    for (const ok of [
      "Two hours of drama, four seconds of content\n\nWhen your farewell speech becomes a clip\n\nSend this to someone who overthinks every post",
      "Even aliens need help posting content\n\nStop juggling platforms and start creating.\n\nTag a creator who posts everywhere",
      "I open the shop at 5 AM and show what the first hour really looks like.",
    ])
      expect(narrates(ok)).toBe(false);
  });
});

/* ---------------- Gemini watches the frames ---------------- */

const realFetch = globalThis.fetch;
const saved = { g: env.GEMINI_API_KEY, k: env.KIMI_API_KEY };
let sent: { url: string; body: any }[] = [];
let answer: string | null = null;

function gem(text: string) {
  const data = { candidates: [{ content: { parts: [{ text }] } }] };
  return new Response(`data: ${JSON.stringify(data)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}
function stub() {
  sent = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.includes("generativelanguage") && !u.includes("moonshot")) return realFetch(url, init);
    sent.push({ url: u, body: JSON.parse(String(init?.body ?? "{}")) });
    if (u.includes("moonshot") || answer === null) return new Response("nope", { status: 500 });
    return gem(answer);
  }) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
  (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = saved.g;
  (env as { KIMI_API_KEY: string }).KIMI_API_KEY = saved.k;
});
function keys(kimi = "") {
  (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "test-key";
  (env as { KIMI_API_KEY: string }).KIMI_API_KEY = kimi;
}

describe("1160 frames reach Gemini", () => {
  test("every frame goes in as inline_data in order, the prompt last (Kimi, when ranked first, gets the same frames: 1174)", async () => {
    const { generateVideoStory } = await import("../lib/ai/video-caption");
    keys("kimi-key");
    answer = JSON.stringify({ seen: "A talking head at a bakery counter before sunrise.", point: "The first hour is the hardest.", caption: "I open the shop at 5 AM and show what the first hour really looks like." });
    stub();
    const out = await generateVideoStory([{ mime: "image/jpeg", data: "QQ==" }, { mime: "image/jpeg", data: "Qg==" }, { mime: "image/jpeg", data: "Qw==" }], "First hour at the shop.", { timeoutMs: 5000, duration: 31 });
    expect(out).toEqual({ story: "I open the shop at 5 AM and show what the first hour really looks like.", seen: "A talking head at a bakery counter before sunrise." });
    const parts = sent.find((s) => s.url.includes("generativelanguage"))!.body.contents[0].parts;
    expect(parts.slice(0, 3)).toEqual([{ inline_data: { mime_type: "image/jpeg", data: "QQ==" } }, { inline_data: { mime_type: "image/jpeg", data: "Qg==" } }, { inline_data: { mime_type: "image/jpeg", data: "Qw==" } }]);
    expect(parts.at(-1).text).toContain("These are 3 frames");
    expect(parts.at(-1).text).toContain("First hour at the shop.");
  });

  test("hashtags are stripped from the story; an empty or missing answer is null, not a made-up story", async () => {
    const { generateVideoStory } = await import("../lib/ai/video-caption");
    keys();
    answer = JSON.stringify({ story: "Sunday at the night market #food \nThe menu says it all" });
    stub();
    expect(await generateVideoStory([{ mime: "image/jpeg", data: "QQ==" }], null, { timeoutMs: 5000 })).toEqual({ story: "Sunday at the night market\nThe menu says it all" });
    answer = JSON.stringify({ story: "   " });
    stub();
    expect(await generateVideoStory([{ mime: "image/jpeg", data: "QQ==" }], null, { timeoutMs: 5000 })).toBeNull();
    answer = null;
    stub();
    expect(await generateVideoStory([{ mime: "image/jpeg", data: "QQ==" }], null, { timeoutMs: 3000 })).toBeNull();
  });

  test("R1180: a frame report is asked for again once, and the real caption wins", async () => {
    const { generateVideoStory } = await import("../lib/ai/video-caption");
    keys();
    const report = JSON.stringify({ seen: "Kids at a snow fort.", caption: "A scene shows a board meeting. The final scene shows a raised hand." });
    const real = JSON.stringify({ seen: "Kids at a snow fort.", caption: "Two hours of drama, four seconds of content\n\nSend this to someone who overthinks every post" });
    let calls = 0;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (!String(url).includes("generativelanguage")) return realFetch(url, init);
      calls++;
      const body = JSON.parse(String(init?.body ?? "{}"));
      const again = body.contents[0].parts.at(-1).text.includes("described the frames instead");
      return gem(again ? real : report);
    }) as typeof fetch;
    const out = await generateVideoStory([{ mime: "image/jpeg", data: "QQ==" }], null, { timeoutMs: 5000 });
    expect(calls).toBe(2);
    expect(out).toEqual({ story: "Two hours of drama, four seconds of content\n\nSend this to someone who overthinks every post", seen: "Kids at a snow fort." });
  });
});

/* ---------------- the route, against the test database ---------------- */

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));
const g = globalThis as unknown as { __fmtUser?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__fmtUser !== undefined ? g.__fmtUser : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let aiRoute: typeof import("../app/api/ai/video-caption/route");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  aiRoute = await import("../app/api/ai/video-caption/route");
}, 60_000);
afterAll(() => {
  delete g.__fmtUser;
});

let n = 0;
async function who() {
  n++;
  const user = await db.user.create({ data: { name: "VC", email: `vc${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  g.__fmtUser = { ...user, role: "owner", joinedAt: user.createdAt, scope: null };
  return user;
}
const headers = () => ({ origin: "http://localhost", host: "localhost", "content-type": "application/json" });
const ask = (body: object) => aiRoute.POST(new NextRequest("http://localhost/api/ai/video-caption", { method: "POST", body: JSON.stringify(body), headers: headers() }), { params: {} } as never);
const frame = (c: string) => Buffer.alloc(300, c).toString("base64");

describe("1160 route", () => {
  test("frames and the transcript go to the model; the story comes back", async () => {
    await who();
    keys();
    answer = JSON.stringify({ story: "Three days in Hampi on a ₹2,000 budget, and where the money really went." });
    stub();
    const r = await ask({ frames: [frame("a"), frame("b")], transcript: "Three days, two thousand rupees.", duration: 58.2, auto: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ story: "Three days in Hampi on a ₹2,000 budget, and where the money really went." });
    const parts = sent[0].body.contents[0].parts;
    expect(parts).toHaveLength(3);
    expect(parts[0].inline_data.mime_type).toBe("image/jpeg");
    expect(parts[2].text).toContain("Three days, two thousand rupees.");
    expect(parts[2].text).toContain("It is 58 seconds long.");
  });

  test("bad frames are refused before any model is asked", async () => {
    await who();
    keys();
    stub();
    expect((await ask({ frames: ["data:image/jpeg;base64,QQ=="] })).status).toBe(400);
    expect((await ask({ frames: [] })).status).toBe(400);
    expect((await ask({ frames: Array.from({ length: 7 }, () => frame("a")) })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test("no model in time: 503 AI_BUSY when asked, a quiet skip when automatic", async () => {
    await who();
    keys();
    answer = null;
    stub();
    const r = await ask({ frames: [frame("a")] });
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("AI_BUSY");
    expect(await (await ask({ frames: [frame("a")], auto: true })).json()).toEqual({ skipped: "busy" });
  });
});

/* ---------------- the workspace wiring, read from the source ---------------- */

describe("1160 workspace", () => {
  test("Pip watches as soon as a video is added, stops on cancel, a new story or a sent one, and never fills the box by itself", () => {
    const w = src("components/create/CreateWorkspace.tsx");
    // R1209 A1: once per video, and only while the story is still to be told.
    expect(w).toContain("const look = o?.watch ?? (!same && submittedRef.current === null && !metaRef.current.original);");
    expect(w).toContain("if (look) void watchVideo(url);");
    expect(w).toContain("const { frames, duration } = await readFrames(url, 4, ctrl.signal);");
    expect(w).toContain('api<{ story?: string; seen?: string; skipped?: string }>("/api/ai/video-caption"');
    expect(w).toContain("transcript: heard, auto: !manual");
    expect(w.indexOf("stopWatching();")).toBeGreaterThan(0);
    // R1209 A1/A3: Pip's caption lands on the page through takeGenerated (never over words the creator edited), so
    // the assistant has no "Use this" or "Edit it first" of its own; it only says it is watching.
    expect(w).toContain("watched.current(story, r.seen);");
    expect(w).toContain("const r = takeGenerated(metaRef.current, story, text, seenText);");
    const a = src("components/create/Assistant.tsx");
    expect(a).not.toContain("Use this");
    expect(a).not.toContain("Edit it first");
    expect(a).toContain('p.watch?.kind === "watching"');
    expect(a).toContain("Watching your video…");
  });
  test("frames are read in the browser at 512px, spread across the video, as base64 JPEGs", () => {
    const f = src("components/create/frame.ts");
    expect(f).toContain("export async function readFrames(url: string, count = 4, signal?: AbortSignal)");
    expect(f).toContain("512 / Math.max(v.videoWidth, v.videoHeight, 1)");
    expect(f).toContain('c.toDataURL("image/jpeg", 0.7).split(",")[1]');
  });
  test("the phone tab bar shows on /create and the post actions bar sits above it", async () => {
    const { hidesTabBar } = await import("../lib/client/tab-bar");
    expect(hidesTabBar("/create")).toBe(false);
    expect(src("components/create/ActionBar.tsx")).toContain("bottom-[var(--sa-float)]");
  });
});

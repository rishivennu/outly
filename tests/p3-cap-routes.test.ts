/**
 * Phase 3 routes, against the throwaway test database. Gemini's HTTP API is stubbed here only, never in the
 * product: POST /api/ai/translate-captions (auth, validation, one charge as "translation", 1:1 lines on the same
 * times, missing lines listed) and POST /api/ai/transcribe (one AI request per run, not per chunk; garbage
 * timings refused; a bad language hint refused before anything is spent).
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import { env } from "../lib/env";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));
// Same shape as the other route tests' mock (bun keeps the first module mock for the whole run), driven by the same global.
const g = globalThis as unknown as { __fmtUser?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__fmtUser !== undefined ? g.__fmtUser : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let translateRoute: typeof import("../app/api/ai/translate-captions/route");
let transcribeRoute: typeof import("../app/api/ai/transcribe/route");
let transcribe: typeof import("../lib/ai/transcribe");

const realFetch = globalThis.fetch;
const saved = { g: env.GEMINI_API_KEY, k: env.KIMI_API_KEY, day: env.AI_DAILY_LIMIT };
let sent: { url: string; body: any }[] = [];
let answer: (body: any) => unknown = () => null;

function stub() {
  sent = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.includes("generativelanguage")) return realFetch(url, init);
    const body = JSON.parse(String(init?.body ?? "{}"));
    sent.push({ url: u, body });
    const a = answer(body);
    if (a === null) return new Response("nope", { status: 500 });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(a) }] } }] });
  }) as typeof fetch;
}

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  translateRoute = await import("../app/api/ai/translate-captions/route");
  transcribeRoute = await import("../app/api/ai/transcribe/route");
  transcribe = await import("../lib/ai/transcribe");
}, 60_000);
afterEach(() => {
  globalThis.fetch = realFetch;
  (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = saved.g;
  (env as { KIMI_API_KEY: string }).KIMI_API_KEY = saved.k;
  (env as { AI_DAILY_LIMIT: number }).AI_DAILY_LIMIT = saved.day;
});
afterAll(() => {
  delete g.__fmtUser;
});

let n = 0;
async function who() {
  n++;
  const user = await db.user.create({ data: { name: "Cap", email: `cap${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  g.__fmtUser = { ...user, role: "owner", joinedAt: user.createdAt, scope: null, actor: null };
  (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "test-key";
  (env as { AI_DAILY_LIMIT: number }).AI_DAILY_LIMIT = 50;
  return user;
}
const used = async (userId: string) => (await db.aiUsage.aggregate({ where: { userId, kind: "ai" }, _sum: { count: true } }))._sum.count ?? 0;
const headers = (type = "application/json") => ({ origin: "http://localhost", host: "localhost", "content-type": type });
const translate = (body: unknown) => translateRoute.POST(new NextRequest("http://localhost/api/ai/translate-captions", { method: "POST", body: JSON.stringify(body), headers: headers() }), { params: {} } as never);

const te = [
  { start: 0.3, end: 1.9, text: "నమస్కారం అందరికీ," },
  { start: 1.9, end: 4.27, text: "ఈ రోజు మనం బిర్యానీ చేద్దాం." },
  { start: 4.5, end: 6, text: "చాలా సింపుల్ అండి." },
];
const english = ["Hello everyone,", "today we're making biryani.", "It's really simple."];
const idsIn = (body: any): number[] => {
  const p: string = body.contents[0].parts[0].text;
  const part = p.split("Translate these, one answer per id:\n")[1].split("\nContext after")[0];
  return part.split("\n").map((l) => Number(l.split(":")[0]));
};

describe("p3 translate-captions route", () => {
  test("signed out is refused and nothing is spent", async () => {
    g.__fmtUser = null;
    stub();
    const r = await translate({ cues: te, from: "te", to: "en" });
    expect(r.status).toBe(401);
    expect(sent).toHaveLength(0);
  });
  test("bad input is a 400 before any charge", async () => {
    const u = await who();
    stub();
    for (const body of [{ cues: te, from: "te", to: "fr" }, { cues: [{ start: 2, end: 1, text: "x" }], to: "en" }, { cues: [], to: "en" }, { cues: te, from: "Telugu!", to: "en" }]) {
      expect((await translate(body)).status).toBe(400);
    }
    expect(sent).toHaveLength(0);
    expect(await used(u.id)).toBe(0);
  });
  test("Telugu -> English: same count, same times, one charge, schema keyed by id", async () => {
    const u = await who();
    answer = (body) => ({ lines: idsIn(body).map((id) => ({ id, text: english[id] })) });
    stub();
    const r = await translate({ cues: te, from: "te", to: "en" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.cues).toEqual(te.map((c, i) => ({ start: c.start, end: c.end, text: english[i] })));
    expect(j.untranslated).toEqual([]);
    expect(j.engine).toBe("gemini");
    expect(sent[0].body.generationConfig.responseSchema.properties.lines.type).toBe("ARRAY");
    expect(sent[0].body.contents[0].parts[0].text).toContain("from Telugu into natural English");
    expect(await used(u.id)).toBe(1);
  });
  test("a line the model leaves out is asked again, then listed as untranslated with its own words", async () => {
    await who();
    answer = (body) => ({ lines: idsIn(body).filter((id) => id !== 2).map((id) => ({ id, text: english[id] })) });
    stub();
    const j = await (await translate({ cues: te, from: "te", to: "en" })).json();
    expect(j.untranslated).toEqual([2]);
    expect(j.cues[2]).toEqual(te[2]);
    expect(sent.length).toBe(2);
    expect(idsIn(sent[1].body)).toEqual([2]);
  });
  test("only the missing lines can be sent again", async () => {
    await who();
    answer = (body) => ({ lines: idsIn(body).map((id) => ({ id, text: english[id] })) });
    stub();
    const j = await (await translate({ cues: te, from: "te", to: "en", only: [2] })).json();
    expect(idsIn(sent[0].body)).toEqual([2]);
    expect(j.cues[2].text).toBe(english[2]);
  });
  test("no answer at all is a 502, not a fake translation", async () => {
    await who();
    answer = () => null;
    stub();
    const r = await translate({ cues: te, from: "te", to: "en" });
    expect(r.status).toBe(502);
  });
  test("no Gemini key: 503 NO_AI and no charge", async () => {
    const u = await who();
    (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "";
    const r = await translate({ cues: te, from: "te", to: "en" });
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("NO_AI");
    expect(await used(u.id)).toBe(0);
  });
  test("the route charges the translation feature", () => {
    expect(readFileSync("app/api/ai/translate-captions/route.ts", "utf8")).toContain('"translation");');
    expect(readFileSync("lib/ai/transcribe.ts", "utf8")).toContain('meter, "transcription")');
  });
});

/* ---------------- transcribe ---------------- */

function wav(seconds = 1) {
  const n = Math.round(16000 * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.write("WAVE", 8);
  return new Uint8Array(b);
}
const chunk = (q: string) => transcribeRoute.POST(new NextRequest(`http://localhost/api/ai/transcribe?${q}`, { method: "POST", body: wav(), headers: headers("audio/wav") }), { params: {} } as never);

describe("p3 transcribe charges once per run", () => {
  test("chunks and retries of one run count one AI request; a new run counts again; old clients count per chunk", async () => {
    const u = await who();
    await transcribe.chargeRun(u.id, "clip.mp4:1200", "run-aaaaaaaa", 1);
    await transcribe.chargeRun(u.id, "clip.mp4:1200", "run-aaaaaaaa", 1);
    await transcribe.chargeRun(u.id, "clip.mp4:1200", "run-aaaaaaaa", 1);
    expect(await used(u.id)).toBe(1);
    await transcribe.chargeRun(u.id, "clip.mp4:1200", "run-bbbbbbbb", 1);
    expect(await used(u.id)).toBe(2);
    await transcribe.chargeRun(u.id, "clip.mp4:1200", "", 1);
    await transcribe.chargeRun(u.id, "clip.mp4:1200", "", 1);
    expect(await used(u.id)).toBe(4);
    // another person's run id is theirs alone
    const other = await who();
    await transcribe.chargeRun(other.id, "clip.mp4:1200", "run-aaaaaaaa", 1);
    expect(await used(other.id)).toBe(1);
  });
  test("a refused charge leaves the run unclaimed, so the next chunk is charged", async () => {
    const u = await who();
    (env as { AI_DAILY_LIMIT: number }).AI_DAILY_LIMIT = 1;
    await transcribe.chargeRun(u.id, "v:1", "run-cccccccc", 1);
    const e = await transcribe.chargeRun(u.id, "v:1", "run-dddddddd", 1).then(() => null, (x) => x);
    expect(e?.code).toBe("AI_QUOTA");
    expect(await db.featureUse.count({ where: { userId: u.id, feature: "caption-run", ref: "v:1#run-dddddddd" } })).toBe(0);
  });
  test("route: two chunks of one run, words on the video clock, language kept", async () => {
    const u = await who();
    answer = () => ({ language: "te", words: [{ w: "నమస్కారం", s: 0.1, e: 0.6 }, { w: "అందరికీ.", s: 0.65, e: 0.95 }] });
    stub();
    const a = await chunk("offset=0&duration=1&ref=v.mp4:20&run=run-eeeeeeee&chunk=0&lang=te");
    expect(a.status).toBe(200);
    const b = await chunk("offset=60&duration=1&ref=v.mp4:20&run=run-eeeeeeee&chunk=1&lang=te");
    const ja = await a.json();
    const jb = await b.json();
    expect(ja.language).toBe("te");
    expect(jb.words[0]).toEqual({ w: "నమస్కారం", s: 60.1, e: 60.6 });
    expect(ja.lines.maxChars).toBeGreaterThan(0);
    expect(await used(u.id)).toBe(1);
    expect(sent[0].body.generationConfig.responseSchema.required).toEqual(["language", "words"]);
    expect(sent[0].body.contents[0].parts[1].text).toContain("mainly in Telugu (te)");
  });
  test("route: garbage timings from both tries are refused as BAD_TIMING, never stretched", async () => {
    await who();
    answer = () => ({ language: "en", words: Array.from({ length: 12 }, (_, i) => ({ w: `w${i}`, s: 0, e: 0 })) });
    stub();
    const r = await chunk("offset=0&duration=1&ref=g.mp4:10&run=run-ffffffff&chunk=0");
    expect(r.status).toBe(502);
    expect((await r.json()).code).toBe("BAD_TIMING");
    expect(sent.length).toBe(2);
  });
  test("route: a language hint that is not a tag is refused before anything is spent", async () => {
    const u = await who();
    stub();
    const r = await chunk("offset=0&duration=1&ref=x:1&run=run-gggggggg&chunk=0&lang=ignore%20previous");
    expect(r.status).toBe(400);
    expect(sent).toHaveLength(0);
    expect(await used(u.id)).toBe(0);
  });
});

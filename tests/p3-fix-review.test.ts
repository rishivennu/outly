/**
 * Phase 3 review fixes. Gemini's HTTP API is stubbed here only, never in the product.
 * 1: the transcribe dedupe keys on the server's hash of the audio, so the same run + chunk with new audio is new
 * work (a new chunk slot, more AI requests). 2: "Rewrite this one" meters caption rewriting. 3: retrying a part
 * keeps the English track. 6: accepting a suggestion resets reviewed, and a waiting one holds the launch.
 * 8, 12, 13: monitoring counts, translation windows and refunds, and old run rows pruned.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import { env } from "../lib/env";
import { keepEnglish } from "../lib/captions/timing";
import { translateWindows, TRANSLATE_WINDOW, CONTEXT } from "../lib/captions/translate-core";
import { acceptProposal } from "../components/create/deck-logic";
import { confirmRows, launchGate, launchPlan } from "../components/create/publish";
import { emptyDraft, type Draft } from "../components/create/types";
import { PLATFORMS, type Platform } from "../lib/domain";

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
let transcribeRoute: typeof import("../app/api/ai/transcribe/route");
let platformRoute: typeof import("../app/api/ai/platform/route");
let translateRoute: typeof import("../app/api/ai/translate-captions/route");
let transcribe: typeof import("../lib/ai/transcribe");
let ents: typeof import("../lib/ai/entitlements");
let prune: typeof import("../lib/retention/prune");

const realFetch = globalThis.fetch;
const saved = { g: env.GEMINI_API_KEY, k: env.KIMI_API_KEY, day: env.AI_DAILY_LIMIT };
let sent = 0;
let answer: () => unknown = () => null;
function stub() {
  sent = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (!String(url).includes("generativelanguage")) return realFetch(url, init);
    sent++;
    const a = answer();
    if (a === null) return new Response("nope", { status: 500 });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(a) }] } }] });
  }) as typeof fetch;
}

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  transcribeRoute = await import("../app/api/ai/transcribe/route");
  platformRoute = await import("../app/api/ai/platform/route");
  translateRoute = await import("../app/api/ai/translate-captions/route");
  transcribe = await import("../lib/ai/transcribe");
  ents = await import("../lib/ai/entitlements");
  prune = await import("../lib/retention/prune");
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
const tag = () => `${Date.now().toString(36)}${n++}`;
const DAY = 86_400_000;
function signIn(user: { id: string; createdAt: Date }) {
  g.__fmtUser = { ...user, role: "owner", joinedAt: user.createdAt, scope: null, actor: null };
  (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "test-key";
  (env as { KIMI_API_KEY: string }).KIMI_API_KEY = "";
  (env as { AI_DAILY_LIMIT: number }).AI_DAILY_LIMIT = 50;
}
async function who() {
  const user = await db.user.create({ data: { name: "Fix", email: `p3fix-${tag()}@test.dev`, passwordHash: "x" } });
  signIn(user);
  return user;
}
/** Someone on a plan with AI captions on 1 video a month: 4 audio chunks. */
async function onCaptionPlan() {
  const p = await db.plan.create({ data: { slug: `p3fix-${tag()}`, name: "Tight", priceMinor: 100, state: "hidden", aiDaily: 50, aiMonthly: 100, captionVideos: 1, aiCaptions: true } });
  const user = await db.user.create({ data: { name: "Fix", email: `p3fix-${tag()}@test.dev`, passwordHash: "x" } });
  await db.subscription.create({ data: { userId: user.id, planId: p.id, status: "active", priceMinor: 100, currency: "INR", interval: "month", provider: "mock", currentPeriodEnd: new Date(Date.now() + 60 * DAY) } });
  signIn(user);
  return user;
}
const used = async (userId: string) => (await db.aiUsage.aggregate({ where: { userId, kind: "ai" }, _sum: { count: true } }))._sum.count ?? 0;
const headers = (type = "application/json") => ({ origin: "http://localhost", host: "localhost", "content-type": type });

/** 1 s of 16 kHz WAV; `v` changes one sample, so each v is different audio. */
function wav(v = 0) {
  const b = Buffer.alloc(44 + 32000);
  b.write("RIFF", 0);
  b.write("WAVE", 8);
  b[44] = v;
  return new Uint8Array(b);
}
const chunk = (q: string, v = 0) => transcribeRoute.POST(new NextRequest(`http://localhost/api/ai/transcribe?${q}`, { method: "POST", body: wav(v), headers: headers("audio/wav") }), { params: {} } as never);
const words = () => ({ language: "en", words: [{ w: "Hello", s: 0.1, e: 0.6 }, { w: "there.", s: 0.65, e: 0.95 }] });

describe("1 transcribe: dedupe only on audio the server hashed", () => {
  test("same run + chunk with different audio takes a new chunk slot and hits 402; a byte-identical resend does not", async () => {
    const u = await onCaptionPlan();
    answer = words;
    stub();
    const q = "offset=0&duration=1&ref=v.mp4:60&run=run-fix00001&chunk=0";
    expect((await chunk(q, 0)).status).toBe(200);
    expect((await chunk(q, 0)).status).toBe(200); // the same bytes again
    const slots = () => db.featureUse.count({ where: { userId: u.id, feature: "caption-chunk" } });
    expect(await slots()).toBe(1);
    for (const v of [1, 2, 3]) expect((await chunk(q, v)).status).toBe(200);
    expect(await slots()).toBe(4);
    const r = await chunk(q, 4);
    expect(r.status).toBe(402);
    expect(await slots()).toBe(4);
    // A byte-identical resend of audio already counted still passes, without a slot.
    expect((await chunk(q, 2)).status).toBe(200);
    expect(await slots()).toBe(4);
  });
  test("one run is charged again for every 4 distinct chunks of audio; resends are free", async () => {
    const u = await who();
    const now = new Date();
    const go = (h: string) => transcribe.chargeRun(u.id, "clip.mp4:600", "run-fix00002", 1, now, h);
    for (const h of ["h1", "h2", "h3", "h4"]) await go(h);
    expect(await used(u.id)).toBe(1);
    await go("h4");
    await go("h1");
    expect(await used(u.id)).toBe(1);
    await go("h5");
    expect(await used(u.id)).toBe(2);
    for (const h of ["h6", "h7", "h8"]) await go(h);
    expect(await used(u.id)).toBe(2);
    await go("h9");
    expect(await used(u.id)).toBe(3);
  });
  test("a refused extra charge leaves that chunk uncounted, so the next try is charged", async () => {
    const u = await who();
    (env as { AI_DAILY_LIMIT: number }).AI_DAILY_LIMIT = 1;
    const now = new Date();
    for (const h of ["a", "b", "c", "d"]) await transcribe.chargeRun(u.id, "c.mp4:1", "run-fix00003", 1, now, h);
    const e = await transcribe.chargeRun(u.id, "c.mp4:1", "run-fix00003", 1, now, "e").then(() => null, (x) => x);
    expect(e?.code).toBe("AI_QUOTA");
    expect(await db.featureUse.count({ where: { userId: u.id, feature: transcribe.RUN_CHUNK_FEATURE } })).toBe(4);
  });
  test("old run and chunk rows are pruned by the retention job", async () => {
    const u = await who();
    const old = new Date(Date.now() - transcribe.RUN_TTL_MS - 60_000);
    await db.featureUse.create({ data: { userId: u.id, feature: transcribe.RUN_FEATURE, period: "run", ref: "old#run-fix00004", createdAt: old } });
    await db.featureUse.create({ data: { userId: u.id, feature: transcribe.RUN_CHUNK_FEATURE, period: "run", ref: "old#run-fix00004:h", createdAt: old } });
    await db.featureUse.create({ data: { userId: u.id, feature: transcribe.RUN_FEATURE, period: "run", ref: "new#run-fix00005" } });
    const out = await prune.pruneOldData();
    expect(out.captionRuns).toBeGreaterThanOrEqual(2);
    expect(await db.featureUse.count({ where: { userId: u.id, period: "run" } })).toBe(1);
  });
});

describe("2 rewrite intent", () => {
  const ask = (body: unknown) => platformRoute.POST(new NextRequest("http://localhost/api/ai/platform", { method: "POST", body: JSON.stringify(body), headers: headers() }), { params: {} } as never);
  const count = async (userId: string, feature: string) => (await db.aiFeatureUsage.aggregate({ where: { userId, feature }, _sum: { count: true } }))._sum.count ?? 0;
  test('"Rewrite this one" is metered as rewrite; writing copy stays captions', async () => {
    const u = await who();
    answer = () => null;
    stub();
    await ask({ story: "A morning routine that works", hook: "Stop forcing early mornings", platforms: ["youtube"], intent: "rewrite" });
    expect(await count(u.id, "rewrite")).toBe(1);
    expect(await count(u.id, "captions")).toBe(0);
    await ask({ story: "A morning routine that works", hook: "Stop forcing early mornings", platforms: ["youtube"] });
    expect(await count(u.id, "captions")).toBe(1);
    expect((await ask({ story: "A morning routine", hook: "Stop forcing it", platforms: ["youtube"], intent: "free" })).status).toBe(400);
  });
  test("a rewrite-only grant covers the rewrite and spends no quota", async () => {
    const u = await who();
    await ents.grantAi({ userId: u.id, features: ["rewrite"], expiresAt: null, note: "test" }, { login: "fin@outlly.test", role: "finance" });
    answer = () => null;
    stub();
    await ask({ story: "A morning routine that works", hook: "Stop forcing early mornings", platforms: ["youtube"], intent: "rewrite" });
    expect(await used(u.id)).toBe(0);
    expect((await db.aiFeatureUsage.findFirst({ where: { userId: u.id, feature: "rewrite" } }))?.unlimited).toBe(1);
  });
});

describe("3 retry keeps the English track", () => {
  const orig = [
    { start: 0, end: 2, text: "నమస్కారం" },
    { start: 2, end: 4, text: "ఈ రోజు" },
    { start: 60, end: 62, text: "చాలా" },
  ];
  const en = [
    { start: 0, end: 2, text: "Hello (edited)" },
    { start: 2, end: 4, text: "Today" },
    { start: 60, end: 62, text: "Very" },
  ];
  test("untouched lines keep their English (edits included); new or re-heard lines are listed", () => {
    const next = [orig[0], orig[1], { start: 60, end: 61, text: "చాలా సింపుల్" }, { start: 61, end: 62.5, text: "అండి" }];
    const r = keepEnglish(orig, en, [], next);
    expect(r.en.map((c) => c.text)).toEqual(["Hello (edited)", "Today", "చాలా సింపుల్", "అండి"]);
    expect(r.en.map((c) => [c.start, c.end])).toEqual(next.map((c) => [c.start, c.end]));
    expect(r.untranslated).toEqual([2, 3]);
  });
  test("a line that was untranslated stays listed; same times with new words drop the old English", () => {
    const next = [orig[0], { ...orig[1], text: "ఈ రోజు మనం" }, orig[2]];
    expect(keepEnglish(orig, en, [2], next)).toEqual({ en: [en[0], { ...orig[1], text: "ఈ రోజు మనం" }, en[2]], untranslated: [1, 2] });
  });
  test("the retry path uses it and reads the latest lines", async () => {
    // Phase 4: the run moved out of the editor into the workspace caption store.
    const src = await Bun.file("components/create/captions/run-store.ts").text();
    expect(src).toContain("keepEnglish(cur.tracks.orig, cur.tracks.en, cur.untranslated, next)");
    expect(src).toContain("next = cur.tracks.orig;");
  });
});

describe("6 suggestions and review", () => {
  const draft = (o: Partial<Draft> = {}): Draft => ({ ...emptyDraft(true), title: "Old title", description: "Old desc", hashtags: "#a", reviewed: true, ...o });
  const all = (o: Partial<Record<Platform, Partial<Draft>>>) => Object.fromEntries(PLATFORMS.map((p) => [p, o[p] ? draft(o[p]) : { ...emptyDraft(false) }])) as Record<Platform, Draft>;
  const acc = { youtube: { status: "connected", username: "me" }, instagram: { status: "connected", username: "me" } };
  const media = { duration: 30, width: 1080, height: 1920 };
  test("acceptProposal resets reviewed and Revert puts it back", () => {
    const { patch, undo } = acceptProposal("youtube", draft(), { patch: { title: "New title" }, why: "" });
    expect(patch.reviewed).toBe(false);
    expect(undo.reviewed).toBe(true);
  });
  test("a waiting suggestion holds that place with a reason; the others still go", () => {
    const d = all({ youtube: { caption: "" }, instagram: { caption: "Here's why" } });
    expect(launchGate(d, acc, media).ready).toBe(true);
    const gate = launchGate(d, acc, media, ["youtube"]);
    expect(gate.ready).toBe(false);
    expect(gate.pending).toEqual(["youtube"]);
    const plan = launchPlan(d, acc, media, ["youtube"]);
    expect(plan.send).toEqual(["instagram"]);
    expect(plan.hold).toEqual([{ platform: "youtube", reason: "A suggestion is waiting." }]);
    expect(confirmRows(d, acc, media, ["youtube"]).find((r) => r.platform === "youtube")).toMatchObject({ sending: false, reason: "A suggestion is waiting." });
  });
});

describe("8 monitoring counts", () => {
  test("active and expired counts come from the table, not the filtered list", async () => {
    const u = await who();
    const email = (await db.user.findUniqueOrThrow({ where: { id: u.id } })).email;
    await db.aiEntitlement.create({ data: { userId: u.id, features: "all", grantedBy: "t" } });
    await db.aiEntitlement.create({ data: { userId: u.id, features: "translation", grantedBy: "t", expiresAt: new Date(Date.now() - DAY) } });
    const m = await ents.aiMonitoring({ status: "revoked", q: email });
    expect(m.grants).toHaveLength(0);
    expect(m.activeCount).toBe(1);
    expect(m.expiredCount).toBe(1);
    const t = await ents.aiMonitoring({ feature: "content", q: email });
    expect(t.activeCount).toBe(1);
    expect(t.expiredCount).toBe(0);
  });
});

describe("12 translation windows and refunds", () => {
  test("a short track is one request as before; a long one goes in windows with context", () => {
    expect(translateWindows(3)).toEqual([{ lo: 0, hi: 3 }]);
    expect(translateWindows(3, [2])).toEqual([{ lo: 0, hi: 3, only: [2] }]);
    const w = translateWindows(TRANSLATE_WINDOW * 2 + 10);
    expect(w).toHaveLength(3);
    expect(w[0]).toMatchObject({ lo: 0, hi: TRANSLATE_WINDOW + CONTEXT });
    expect(w[0].only).toHaveLength(TRANSLATE_WINDOW);
    expect(w[1].lo).toBe(TRANSLATE_WINDOW - CONTEXT);
    expect(w[1].only![0]).toBe(CONTEXT);
    const covered = w.flatMap((x) => x.only!.map((i) => x.lo + i));
    expect(covered).toEqual(Array.from({ length: TRANSLATE_WINDOW * 2 + 10 }, (_, i) => i));
    for (const x of w) expect(x.hi - x.lo).toBeLessThanOrEqual(600);
    expect(translateWindows(1000, [5, 700])).toEqual([
      { lo: 0, hi: TRANSLATE_WINDOW + CONTEXT, only: [5] },
      { lo: 2 * TRANSLATE_WINDOW - CONTEXT, hi: 3 * TRANSLATE_WINDOW + CONTEXT, only: [700 - (2 * TRANSLATE_WINDOW - CONTEXT)] },
    ]);
  });
  test("a translation that doesn't come back gives the AI request back", async () => {
    const u = await onCaptionPlan();
    answer = () => null;
    stub();
    // Its own address: the route's 10 a minute limit is per IP, and other files call it from "local" too.
    const r = await translateRoute.POST(new NextRequest("http://localhost/api/ai/translate-captions", { method: "POST", body: JSON.stringify({ cues: [{ start: 0, end: 1, text: "నమస్కారం" }], from: "te", to: "en" }), headers: { ...headers(), "x-forwarded-for": "10.9.8.7" } }), { params: {} } as never);
    expect(r.status).toBe(502);
    expect(sent).toBeGreaterThan(0);
    expect(await used(u.id)).toBe(0);
  });
});

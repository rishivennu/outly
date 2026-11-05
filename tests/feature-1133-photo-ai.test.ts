/**
 * 1133: the Outlly assistant writes a photo post's caption, hashtags and per-photo descriptions from the photos
 * themselves (Gemini reads the images), and a creator with two Instagram accounts picks which one a post goes to.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import { env } from "../lib/env";
import { photoPrompt, tidyTags } from "../lib/ai/photo-caption";

function jpeg(width: number, height: number, pad = 0) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.concat([Buffer.from([0xff, 0xd8, ...app0, ...sof]), Buffer.alloc(pad, 0), Buffer.from([0xff, 0xd9])]);
}

describe("1133 helpers", () => {
  test("hashtags come back tidy: one #, no repeats, no punctuation, at most ten", () => {
    expect(tidyTags("#food, ##Food travel #street-food #café")).toBe("#food #travel #streetfood #café");
    expect(tidyTags(Array.from({ length: 14 }, (_, i) => `t${i}`).join(" ")).split(" ")).toHaveLength(10);
    expect(tidyTags("")).toBe("");
  });
  test("the prompt asks for one description per photo and says how many", () => {
    expect(photoPrompt(3, "carousel")).toContain("carousel of 3 photos");
    expect(photoPrompt(3, "carousel")).toContain("exactly 3 items");
    expect(photoPrompt(1, "photo")).toContain("exactly 1 item,");
  });
});

/* ---------------- Gemini sees the photos ---------------- */

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

describe("1133 images reach Gemini", () => {
  test("images go in as inline_data before the prompt, and Kimi (text only) sits out", async () => {
    const { llmText } = await import("../lib/ai/llm");
    keys("kimi-key");
    answer = '{"ok":1}';
    stub();
    const r = await llmText("sys", "look", { images: [{ mime: "image/jpeg", data: "QUJD" }], json: true, timeoutMs: 5000 });
    expect(r?.text).toBe('{"ok":1}');
    expect(sent.every((s) => s.url.includes("generativelanguage"))).toBe(true);
    const parts = sent[0].body.contents[0].parts;
    expect(parts[0]).toEqual({ inline_data: { mime_type: "image/jpeg", data: "QUJD" } });
    expect(parts.at(-1)).toEqual({ text: "look" });
  });

  test("the answer is cleaned: no hashtags in the caption, tidy tags, one description per photo", async () => {
    const { generatePhotoCopy } = await import("../lib/ai/photo-caption");
    keys();
    answer = JSON.stringify({ caption: "Sunday at the night market #food\nThe menu says it all", hashtags: "#food, streetfood #food", alts: ["A stall with a menu that says Pani Puri 40"] });
    stub();
    const out = await generatePhotoCopy([{ mime: "image/jpeg", data: "QQ==" }, { mime: "image/jpeg", data: "Qg==" }], "carousel", { timeoutMs: 5000 });
    expect(out).toEqual({ caption: "Sunday at the night market\nThe menu says it all", hashtags: "#food #streetfood", alts: ["A stall with a menu that says Pani Puri 40", ""] });
  });

  test("no answer is null, not a made-up caption", async () => {
    const { generatePhotoCopy } = await import("../lib/ai/photo-caption");
    keys();
    answer = null;
    stub();
    expect(await generatePhotoCopy([{ mime: "image/jpeg", data: "QQ==" }], "photo", { timeoutMs: 3000 })).toBeNull();
  });
});

/* ---------------- the route and the account pick, against the test database ---------------- */

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));
// Same shape as the 1131 file's mock (bun keeps the first module mock for the whole run), driven by the same global.
const g = globalThis as unknown as { __fmtUser?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__fmtUser !== undefined ? g.__fmtUser : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let encrypt: typeof import("../lib/crypto").encrypt;
let imageRoute: typeof import("../app/api/media/image/route");
let aiRoute: typeof import("../app/api/ai/photo-caption/route");
let postsRoute: typeof import("../app/api/posts/route");
let profiles: typeof import("../lib/profiles");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  ({ encrypt } = await import("../lib/crypto"));
  imageRoute = await import("../app/api/media/image/route");
  aiRoute = await import("../app/api/ai/photo-caption/route");
  postsRoute = await import("../app/api/posts/route");
  profiles = await import("../lib/profiles");
}, 60_000);
afterAll(() => {
  delete g.__fmtUser;
});

let n = 0;
async function who(igAccounts = 1) {
  n++;
  const user = await db.user.create({ data: { name: "PA", email: `pa${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  g.__fmtUser = { ...user, role: "owner", joinedAt: user.createdAt, scope: null };
  const igs = [];
  for (let i = 0; i < igAccounts; i++)
    igs.push(await db.socialAccount.create({ data: { userId: user.id, platform: "instagram", platformUserId: `pa-${n}-${i}`, username: `acct${i}`, accessToken: encrypt("tok"), status: "connected" } }));
  return { user, igs };
}
const headers = (type = "application/json") => ({ origin: "http://localhost", host: "localhost", "content-type": type });
const photo = async () =>
  (await (await imageRoute.POST(new NextRequest("http://localhost/api/media/image?name=a.jpg", { method: "POST", body: new Uint8Array(jpeg(1080, 1350, 50)), headers: headers("image/jpeg") }), { params: {} } as never)).json()).media;
const ask = (body: object) => aiRoute.POST(new NextRequest("http://localhost/api/ai/photo-caption", { method: "POST", body: JSON.stringify(body), headers: headers() }), { params: {} } as never);
const save = (body: object) => postsRoute.POST(new NextRequest("http://localhost/api/posts", { method: "POST", body: JSON.stringify(body), headers: headers() }), { params: {} } as never);

describe("1133 photo-caption route", () => {
  test("reads the creator's own photos and maps a description to each one", async () => {
    await who();
    const a = await photo();
    const b = await photo();
    keys();
    answer = JSON.stringify({ caption: "Two views of one street", hashtags: "#city #walk", alts: ["A street at dawn", "The same street at night"] });
    stub();
    const r = await ask({ mediaIds: [a.id, b.id], format: "carousel" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ caption: "Two views of one street", hashtags: "#city #walk", slides: [{ mediaId: a.id, altText: "A street at dawn" }, { mediaId: b.id, altText: "The same street at night" }] });
    expect(sent[0].body.contents[0].parts.filter((p: any) => p.inline_data)).toHaveLength(2);
  });

  test("someone else's photo is never read", async () => {
    await who();
    const theirs = await photo();
    await who();
    keys();
    answer = JSON.stringify({ caption: "x", hashtags: "", alts: ["x"] });
    stub();
    const r = await ask({ mediaIds: [theirs.id], format: "photo" });
    expect(r.status).toBe(400);
    expect(sent).toHaveLength(0);
    const quiet = await ask({ mediaIds: [theirs.id], format: "photo", auto: true });
    expect(await quiet.json()).toEqual({ skipped: "no_photos" });
  });

  test("when no model answers: a clear 503 when asked, a quiet skip when automatic", async () => {
    await who();
    const a = await photo();
    keys();
    answer = null;
    stub();
    const r = await ask({ mediaIds: [a.id], format: "photo" });
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("AI_BUSY");
    expect(await (await ask({ mediaIds: [a.id], format: "photo", auto: true })).json()).toEqual({ skipped: "busy" });
  });
});

describe("1133 picking the Instagram account", () => {
  test("every Instagram account in scope is offered; a member sees only theirs", async () => {
    const { user, igs } = await who(2);
    const all = await profiles.platformAccounts({ id: user.id, scope: null }, "instagram");
    expect(all.map((a) => a.id)).toEqual(igs.map((a) => a.id));
    const mine = await profiles.platformAccounts({ id: user.id, scope: [igs[1].id] }, "instagram");
    expect(mine.map((a) => a.id)).toEqual([igs[1].id]);
  });

  test("the post is pinned to the account picked, and can be moved to the other one", async () => {
    const { igs } = await who(2);
    const a = await photo();
    const r = await save({ mediaId: a.id, title: "P", format: "photo", items: [{ mediaId: a.id }], targets: [{ platform: "instagram", accountId: igs[1].id, caption: "hi" }] });
    expect(r.status).toBeLessThan(300);
    const { post } = await r.json();
    const t1 = await db.postTarget.findFirst({ where: { postId: post.id, platform: "instagram" } });
    expect(t1?.socialAccountId).toBe(igs[1].id);
    const again = await save({ postId: post.id, mediaId: a.id, title: "P", format: "photo", items: [{ mediaId: a.id }], targets: [{ platform: "instagram", accountId: igs[0].id, caption: "hi" }] });
    expect(again.status).toBeLessThan(300);
    const t2 = await db.postTarget.findFirst({ where: { postId: post.id, platform: "instagram" } });
    expect(t2?.socialAccountId).toBe(igs[0].id);
  });
});

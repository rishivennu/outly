/**
 * R1241: Content Studio prefill. The pure mapping (lib/intelligence/prefill-core.ts), GET /api/recommendations/[id]
 * (owner only, prefill shape), and POST /api/posts with a recommendationId: exactly one outcome link, a retry adds
 * none, and a foreign or malformed id never fails the save.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import type { Prefill } from "../lib/intelligence/planner-core";
import { acceptsOnOpen, editorEmpty, prefillToDraft, STORY_MAX, storyOf } from "../lib/intelligence/prefill-core";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));
const g = globalThis as unknown as { __r1241User?: unknown; __queueBackend?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__r1241User !== undefined ? g.__r1241User : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let encrypt: typeof import("../lib/crypto").encrypt;
let posts: typeof import("../app/api/posts/route");
let one: typeof import("../app/api/recommendations/[id]/route");
let previousBackend: unknown;

beforeAll(async () => {
  previousBackend = g.__queueBackend;
  g.__queueBackend = { add: async () => undefined };
  ({ db } = await import("../lib/db"));
  ({ encrypt } = await import("../lib/crypto"));
  posts = await import("../app/api/posts/route");
  one = await import("../app/api/recommendations/[id]/route");
}, 60_000);
afterAll(() => {
  delete g.__r1241User;
  g.__queueBackend = previousBackend;
});

const pre = (over: Partial<Prefill> = {}): Prefill => ({ platform: "instagram", format: "video", topic: "Recipes", title: "Post more recipe reels", concept: "Your recipe reels get twice the saves.", basedOn: ["p1", "p2"], ...over });

describe("R1241 prefill-core", () => {
  test("a supported pair is kept: platform switched on, format kept, first source post for lineage", () => {
    const d = prefillToDraft(pre(), { recommendationId: "rec1" });
    expect(d).toMatchObject({ platforms: ["instagram"], format: "video", topic: "Recipes", title: "Post more recipe reels", note: null, adaptedFromPostId: "p1", recommendationId: "rec1" });
    expect(d.story).toBe("Post more recipe reels.\n\nYour recipe reels get twice the saves.");
    // A composer that makes carousels keeps an Instagram carousel too.
    expect(prefillToDraft(pre({ format: "carousel" }), { recommendationId: "r", makes: ["video", "carousel"] }).format).toBe("carousel");
  });

  test("an unsupported pair drops the format with a note and keeps the platform", () => {
    const d = prefillToDraft(pre({ platform: "youtube", format: "carousel" }), { recommendationId: "r" });
    expect(d.format).toBeNull();
    expect(d.platforms).toEqual(["youtube"]);
    expect(d.note).toContain("YouTube can't take a carousel");
    // Supported on Instagram, but this editor only makes videos: said, never silently changed.
    const slide = prefillToDraft(pre({ format: "carousel" }), { recommendationId: "r" });
    expect(slide.format).toBeNull();
    expect(slide.note).toContain("makes videos");
  });

  test("unknown platform or format and empty basedOn add nothing", () => {
    const d = prefillToDraft(pre({ platform: "myspace", format: "reel", basedOn: [], topic: null }), { recommendationId: "r" });
    expect(d.platforms).toEqual([]);
    expect(d.format).toBeNull();
    expect(d.topic).toBeNull();
    expect("adaptedFromPostId" in d).toBe(false);
    expect(prefillToDraft(pre({ platform: null, format: null }), { recommendationId: "r" }).note).toBeNull();
    // A source id the save would refuse is never sent.
    expect(prefillToDraft(pre({ basedOn: ["bad id!", "ok2"] }), { recommendationId: "r" }).adaptedFromPostId).toBe("ok2");
  });

  test("the text is never empty, has no em dashes and fits the story cap", () => {
    expect(prefillToDraft(pre({ title: "", concept: "" }), { recommendationId: "r" }).story.trim().length).toBeGreaterThan(0);
    expect(storyOf("Hooks \u2014 fast", "Open on the result \u2013 then explain.")).not.toMatch(/[\u2014\u2013]/);
    expect(storyOf("Recipes", "Recipes win on saves.")).toBe("Recipes win on saves.");
    expect(storyOf("T", "x".repeat(5000)).length).toBe(STORY_MAX);
  });

  test("editorEmpty and acceptsOnOpen", () => {
    expect(editorEmpty({ story: "  ", hook: null, captions: ["", " "] })).toBe(true);
    expect(editorEmpty({ story: "mine", hook: null, captions: [] })).toBe(false);
    expect(editorEmpty({ story: "", hook: "a hook", captions: [] })).toBe(false);
    expect(editorEmpty({ story: "", hook: null, captions: ["typed"] })).toBe(false);
    expect(acceptsOnOpen("open")).toBe(true);
    expect(acceptsOnOpen("saved")).toBe(true);
    for (const s of ["accepted", "edited", "done", "rejected", "expired", "nope"]) expect(acceptsOnOpen(s)).toBe(false);
  });
});

let n = 0;
async function creator() {
  n++;
  const user = await db.user.create({ data: { name: "R", email: `r1241-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `r1241/${n}-${Date.now()}.mp4`, mimeType: "video/mp4", size: 1000, duration: 10, width: 1080, height: 1920, status: "ready" } });
  await db.socialAccount.create({ data: { userId: user.id, platform: "instagram", platformUserId: `mock-ig-r1241-${n}-${Date.now()}`, username: "me", accessToken: encrypt("tok"), status: "connected" } });
  return { user, media, as: () => void (g.__r1241User = { ...user, role: "owner", joinedAt: user.createdAt, actor: null, scope: null }) };
}
async function recFor(ownerId: string, status = "open") {
  const today = new Date().toISOString().slice(0, 10);
  return db.recommendation.create({
    data: {
      ownerId,
      scopeKey: "",
      dedupeKey: `r1241-${++n}`,
      title: "Post more recipe reels",
      concept: "Your recipe reels get twice the saves.",
      why: "Recipe reels beat your other videos on saves.",
      evidence: JSON.stringify({ postIds: ["evA"] }),
      postsAnalyzed: 12,
      periodFrom: today,
      periodTo: today,
      confidence: "medium",
      format: "video",
      platform: "instagram",
      nextAction: JSON.stringify({ kind: "create", label: "Draft it", prefill: { platform: "instagram", format: "video", topic: "Recipes", basedOn: ["p1"] } }),
      status,
    },
  });
}
const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" } });
async function create(body: Record<string, unknown>): Promise<{ status: number; id: string }> {
  const r = await posts.POST(req("POST", "/api/posts", { title: "Draft", story: "One idea. More words.", targets: [{ platform: "instagram", caption: "hi" }], ...body }), { params: { id: "" } });
  const j = (await r.json()) as { post?: { id: string } };
  return { status: r.status, id: j.post?.id ?? "" };
}
const links = (recommendationId: string) => db.recommendationEvent.findMany({ where: { recommendationId, type: "outcome_link" } });

describe("R1241 GET /api/recommendations/[id]", () => {
  test("the owner gets the recommendation and its prefill, in any status", async () => {
    const c = await creator();
    for (const status of ["open", "accepted", "done"]) {
      const r = await recFor(c.user.id, status);
      c.as();
      const res = await one.GET(req("GET", `/api/recommendations/${r.id}`), { params: { id: r.id } });
      expect(res.status).toBe(200);
      const j = (await res.json()) as { recommendation: { id: string; status: string; title: string }; prefill: Prefill };
      expect(j.recommendation).toMatchObject({ id: r.id, status, title: "Post more recipe reels" });
      expect(j.prefill).toEqual({ platform: "instagram", format: "video", topic: "Recipes", title: "Post more recipe reels", concept: "Your recipe reels get twice the saves.", basedOn: ["p1"] });
    }
  });

  test("another workspace gets a 404 and nothing else", async () => {
    const owner = await creator();
    const r = await recFor(owner.user.id);
    const other = await creator();
    other.as();
    const res = await one.GET(req("GET", `/api/recommendations/${r.id}`), { params: { id: r.id } });
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("recipe");
  });
});

describe("R1241 POST /api/posts with a recommendationId", () => {
  test("a new draft writes exactly one outcome link and the recommendation points at its item", async () => {
    const c = await creator();
    const r = await recFor(c.user.id, "accepted");
    c.as();
    const p = await create({ mediaId: c.media.id, recommendationId: r.id, clientKey: "r1241_twin" });
    expect(p.status).toBe(200);
    const l = await links(r.id);
    expect(l).toHaveLength(1);
    expect(JSON.parse(l[0].data ?? "{}")).toEqual({ postId: p.id });
    const v = await db.contentVariation.findUnique({ where: { postId: p.id } });
    expect((await db.recommendation.findUnique({ where: { id: r.id } }))?.contentItemId).toBe(v!.itemId);
    // The same create sent twice (a sync retry) saves into the twin and links nothing more.
    const again = await create({ mediaId: c.media.id, recommendationId: r.id, clientKey: "r1241_twin" });
    expect(again.id).toBe(p.id);
    expect(await links(r.id)).toHaveLength(1);
    // An update carrying it again changes nothing either.
    await create({ postId: p.id, mediaId: c.media.id, recommendationId: r.id });
    expect(await links(r.id)).toHaveLength(1);
  });

  test("with a source post it joins that item as adapted and still links", async () => {
    const c = await creator();
    c.as();
    const src = await create({ mediaId: c.media.id });
    const r = await recFor(c.user.id, "accepted");
    const p = await create({ mediaId: c.media.id, adaptedFromPostId: src.id, recommendationId: r.id });
    expect(p.status).toBe(200);
    const [sv, cv] = [await db.contentVariation.findUnique({ where: { postId: src.id } }), await db.contentVariation.findUnique({ where: { postId: p.id } })];
    expect(cv?.kind).toBe("adapted");
    expect(cv?.itemId).toBe(sv!.itemId);
    expect(await links(r.id)).toHaveLength(1);
  });

  test("a recommendation from another workspace is ignored silently: the post saves, nothing is linked", async () => {
    const owner = await creator();
    const foreign = await recFor(owner.user.id, "accepted");
    const c = await creator();
    c.as();
    const p = await create({ mediaId: c.media.id, recommendationId: foreign.id });
    expect(p.status).toBe(200);
    expect(await db.post.count({ where: { id: p.id, userId: c.user.id } })).toBe(1);
    expect(await links(foreign.id)).toHaveLength(0);
    expect((await db.recommendation.findUnique({ where: { id: foreign.id } }))?.contentItemId).toBeNull();
  });

  test("a malformed or unknown id never fails the save", async () => {
    const c = await creator();
    c.as();
    expect((await create({ mediaId: c.media.id, recommendationId: "not a cuid!" })).status).toBe(200);
    expect((await create({ mediaId: c.media.id, recommendationId: "doesnotexist123" })).status).toBe(200);
    expect((await create({ mediaId: c.media.id, recommendationId: null })).status).toBe(200);
  });
});

describe("R1241 composer wiring", () => {
  const src = readFileSync("components/create/CreateWorkspace.tsx", "utf8");
  const page = readFileSync("app/(studio)/create/page.tsx", "utf8");

  test("the page hands ?rec to the existing composer, only for a new post", () => {
    expect(page).toContain("recId={post || searchParams.post || searchParams.local ? null");
  });

  test("prefill only fills an empty editor, else offers the choice, and strips ?rec", () => {
    expect(src).toContain("if (emptyRef.current) applyRec(d);");
    expect(src).toContain("else setRecOffer(d);");
    expect(src).toContain("Use recommendation");
    expect(src).toContain("Keep my draft");
    expect(src).toContain("Started from a recommendation:");
    expect(src).toContain('href="/intelligence"');
    expect(src).toContain("api<{ recommendation: { id: string; status: string }; prefill: Prefill }>(`/api/recommendations/${encodeURIComponent(recId)}`)");
    expect(src).toContain('window.history.replaceState(null, "", "/create");\r\n      if (!alive) return;');
    expect(src).toContain("acceptsOnOpen(r.recommendation.status)");
  });

  test("both the background sync and the explicit save send the ids, only before the post exists", () => {
    expect(src.match(/\.\.\.recFields\(\)/g)).toHaveLength(2);
    expect(src).toContain("const recFields = () => (postIdRef.current || !recOrigin.current ? {} : recOrigin.current);");
  });

  test("the choice and the dismiss are 44 px with focus rings", () => {
    const block = src.slice(src.indexOf("{recOffer && ("), src.indexOf("{fromRec && (") + 2400);
    expect(block.match(/min-h-11|h-11 w-11/g)?.length).toBeGreaterThanOrEqual(4);
    expect(block).toContain("focus-visible:ring-2");
    expect(block).not.toContain("transition-all");
    expect(block).not.toMatch(/\u2014/);
  });
});

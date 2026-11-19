/**
 * R1234: lineage on create. A new draft from POST /api/posts gets a ContentItem with an original variation, an
 * adaptedFromPostId files it under the source's item, a clientKey retry adds nothing, Duplicate links the copy to the
 * source's item, every bulk-booked post gets an item, and the guarded helper never throws.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

const g = globalThis as unknown as { __r1234User?: unknown; __queueBackend?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__r1234User !== undefined ? g.__r1234User : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let encrypt: typeof import("../lib/crypto").encrypt;
let posts: typeof import("../app/api/posts/route");
let bulk: typeof import("../app/api/posts/bulk/route");
let duplicatePost: typeof import("../lib/posts/duplicate").duplicatePost;
let lineageAfterCreate: typeof import("../lib/intelligence/lineage").lineageAfterCreate;
let previousBackend: unknown;

beforeAll(async () => {
  previousBackend = g.__queueBackend;
  g.__queueBackend = { add: async () => undefined };
  ({ db } = await import("../lib/db"));
  ({ encrypt } = await import("../lib/crypto"));
  posts = await import("../app/api/posts/route");
  bulk = await import("../app/api/posts/bulk/route");
  ({ duplicatePost } = await import("../lib/posts/duplicate"));
  ({ lineageAfterCreate } = await import("../lib/intelligence/lineage"));
}, 60_000);
afterAll(() => {
  delete g.__r1234User;
  g.__queueBackend = previousBackend;
});

let n = 0;
async function creator() {
  n++;
  const user = await db.user.create({ data: { name: "L", email: `r1234-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `r1234/${n}.mp4`, mimeType: "video/mp4", size: 1000, duration: 10, width: 1080, height: 1920, status: "ready" } });
  await db.socialAccount.create({ data: { userId: user.id, platform: "instagram", platformUserId: `mock-ig-r1234-${n}`, username: "me", accessToken: encrypt("tok"), status: "connected" } });
  g.__r1234User = { ...user, role: "owner", joinedAt: user.createdAt, actor: null, scope: null };
  return { user, media };
}
const req = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" } });
const ctx = { params: { id: "" } };
async function create(body: Record<string, unknown>): Promise<{ status: number; id: string }> {
  const r = await posts.POST(req("/api/posts", { title: "Draft", story: "One idea. More words.", targets: [{ platform: "instagram", caption: "hi" }], ...body }), ctx);
  const j = (await r.json()) as { post?: { id: string } };
  return { status: r.status, id: j.post?.id ?? "" };
}
const variationOf = (postId: string) => db.contentVariation.findUnique({ where: { postId }, include: { item: true } });

describe("R1234 POST /api/posts", () => {
  test("a new draft gets an item and an original variation", async () => {
    const { user, media } = await creator();
    const r = await create({ mediaId: media.id });
    expect(r.status).toBe(200);
    const v = await variationOf(r.id);
    expect(v?.kind).toBe("original");
    expect(v?.platform).toBe("instagram");
    expect(v?.item.ownerId).toBe(user.id);
    expect(v?.item.origin).toBe("manual");
    expect(v?.item.concept).toBe("One idea.");
  });

  test("adaptedFromPostId files the new draft under the source's item as adapted", async () => {
    const { user, media } = await creator();
    const src = await create({ mediaId: media.id });
    const child = await create({ mediaId: media.id, adaptedFromPostId: src.id });
    expect(child.status).toBe(200);
    const [sv, cv] = [await variationOf(src.id), await variationOf(child.id)];
    expect(cv?.kind).toBe("adapted");
    expect(cv?.itemId).toBe(sv!.itemId);
    expect(cv?.parentVariationId).toBe(sv!.id);
    // No throwaway item for the child.
    expect(await db.contentItem.count({ where: { ownerId: user.id } })).toBe(1);
  });

  test("an adaptedFromPostId from another workspace is ignored: the draft gets its own item", async () => {
    const other = await creator();
    const foreign = await create({ mediaId: other.media.id });
    const { user, media } = await creator();
    const r = await create({ mediaId: media.id, adaptedFromPostId: foreign.id });
    expect(r.status).toBe(200);
    const v = await variationOf(r.id);
    expect(v?.kind).toBe("original");
    expect(v?.item.ownerId).toBe(user.id);
    expect(await db.contentVariation.count({ where: { itemId: (await variationOf(foreign.id))!.itemId } })).toBe(1);
  });

  test("a clientKey retry saves into the twin and adds no second item", async () => {
    const { user, media } = await creator();
    const a = await create({ mediaId: media.id, clientKey: "r1234_twin" });
    const b = await create({ mediaId: media.id, clientKey: "r1234_twin", title: "Newer" });
    expect(b.id).toBe(a.id);
    expect(await db.contentItem.count({ where: { ownerId: user.id } })).toBe(1);
    expect(await db.contentVariation.count({ where: { postId: a.id } })).toBe(1);
  });

  test("an update adds nothing", async () => {
    const { user, media } = await creator();
    const a = await create({ mediaId: media.id });
    const r = await create({ mediaId: media.id, postId: a.id, adaptedFromPostId: a.id, title: "Edited" });
    expect(r.status).toBe(200);
    expect(await db.contentItem.count({ where: { ownerId: user.id } })).toBe(1);
    expect((await variationOf(a.id))?.kind).toBe("original");
  });

  test("a bad adaptedFromPostId is a 400", async () => {
    const { media } = await creator();
    expect((await create({ mediaId: media.id, adaptedFromPostId: "not a post id!" })).status).toBe(400);
    expect((await create({ mediaId: media.id, adaptedFromPostId: "a".repeat(41) })).status).toBe(400);
  });
});

describe("R1234 duplicatePost", () => {
  test("the copy is an adapted variation of the source's item", async () => {
    const { user, media } = await creator();
    const src = await create({ mediaId: media.id });
    const copy = await duplicatePost(user.id, src.id);
    const [sv, cv] = [await variationOf(src.id), await variationOf(copy.id)];
    expect(cv?.kind).toBe("adapted");
    expect(cv?.itemId).toBe(sv!.itemId);
    expect(cv?.parentVariationId).toBe(sv!.id);
  });

  test("a source with no item yet gets one, and a copy of the copy chains below it", async () => {
    const { user, media } = await creator();
    const raw = await db.post.create({ data: { userId: user.id, mediaId: media.id, title: "Old", targets: { create: [{ platform: "instagram" }] } } });
    const copy = await duplicatePost(user.id, raw.id);
    const again = await duplicatePost(user.id, copy.id);
    const [rv, cv, av] = [await variationOf(raw.id), await variationOf(copy.id), await variationOf(again.id)];
    expect(rv?.kind).toBe("original");
    expect(cv?.parentVariationId).toBe(rv!.id);
    expect(av?.parentVariationId).toBe(cv!.id);
    expect(new Set([rv!.itemId, cv!.itemId, av!.itemId]).size).toBe(1);
  });
});

describe("R1234 bulk booking", () => {
  test("every booked post gets an item", async () => {
    const { user, media } = await creator();
    // A batch takes each video once, so the second item needs its own file.
    const second = await db.media.create({ data: { userId: user.id, originalFilename: "b.mp4", storageKey: `r1234/${++n}b.mp4`, mimeType: "video/mp4", size: 1000, duration: 10, width: 1080, height: 1920, status: "ready" } });
    const at = (m: number) => new Date(Date.now() + 3 * 3600_000 + m * 3600_000).toISOString();
    const r = await bulk.POST(req("/api/posts/bulk", { platforms: ["instagram"], items: [{ mediaId: media.id, caption: "a", scheduledAt: at(0) }, { mediaId: second.id, caption: "b", scheduledAt: at(2) }] }), ctx);
    expect(r.status).toBe(201);
    const ids = (await db.post.findMany({ where: { userId: user.id }, select: { id: true } })).map((p) => p.id);
    expect(ids.length).toBe(2);
    for (const id of ids) expect((await variationOf(id))?.kind).toBe("original");
    expect(await db.contentItem.count({ where: { ownerId: user.id, origin: "manual" } })).toBe(2);
  });
});

describe("R1234 lineageAfterCreate is guarded", () => {
  test("an unknown owner writes nothing and resolves", async () => {
    const { media, user } = await creator();
    const p = await db.post.create({ data: { userId: user.id, mediaId: media.id } });
    expect(await lineageAfterCreate("no-such-owner", p.id, p.id)).toBeUndefined();
    expect(await db.contentVariation.count({ where: { postId: p.id } })).toBe(0);
  });

  test("a failing Content Memory write is logged with a code and swallowed, and the save still succeeds", async () => {
    const { media } = await creator();
    const target = db as unknown as { $transaction: unknown };
    const realTx = target.$transaction;
    const warn = console.warn;
    const codes: string[] = [];
    console.warn = (...a: unknown[]) => void codes.push(String(a[0]));
    // Only the lineage transaction is made to fail: the save's own transaction runs first.
    let calls = 0;
    target.$transaction = function (this: unknown, ...a: unknown[]) {
      if (++calls > 1) return Promise.reject(new Error("memory down"));
      return (realTx as (...x: unknown[]) => unknown).apply(db, a);
    };
    try {
      const r = await create({ mediaId: media.id });
      expect(r.status).toBe(200);
      expect(await variationOf(r.id)).toBeNull();
      expect(await lineageAfterCreate("x", "y")).toBeUndefined();
    } finally {
      target.$transaction = realTx;
      console.warn = warn;
    }
    expect(codes).toContain("[lineage] ensure_failed");
  });
});

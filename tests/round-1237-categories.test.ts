/**
 * R1237: content categories and topics (lib/intelligence/categories.ts) against the test database: normalisation and
 * case-insensitive uniqueness, at most 5 tags, cross-owner categories refused, tagPost making the item when missing,
 * deterministic suggestions (none without keywords), delete removing tags, the tags route, and UI source pins.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
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
const g = globalThis as unknown as { __r1237User?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__r1237User !== undefined ? g.__r1237User : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let cat: typeof import("../lib/intelligence/categories");
let core: typeof import("../lib/intelligence/categories-core");
let tagsRoute: typeof import("../app/api/posts/[id]/tags/route");
let catsRoute: typeof import("../app/api/content/categories/route");
let n = 0;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  cat = await import("../lib/intelligence/categories");
  core = await import("../lib/intelligence/categories-core");
  tagsRoute = await import("../app/api/posts/[id]/tags/route");
  catsRoute = await import("../app/api/content/categories/route");
}, 60_000);
afterAll(() => {
  delete g.__r1237User;
});

async function user() {
  return db.user.create({ data: { name: `C ${++n}`, email: `r1237-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
}
async function post(userId: string, o: { title?: string; story?: string; hook?: string } = {}) {
  const media = await db.media.create({ data: { userId, storageKey: `r1237/m${++n}.mp4`, originalFilename: "a.mp4", mimeType: "video/mp4", size: 10, status: "ready" } });
  return db.post.create({ data: { userId, mediaId: media.id, title: o.title ?? "Untitled", story: o.story ?? null, hook: o.hook ?? null, targets: { create: [{ platform: "instagram" }] } } });
}
const status = async (p: Promise<unknown>) => p.then(() => 0, (e: { status?: number }) => e.status ?? -1);

describe("R1237 categories-core", () => {
  test("names, keywords and topics are normalised", () => {
    expect(core.normaliseName("  Easy   weeknight\tdinners ")).toBe("Easy weeknight dinners");
    expect(core.normaliseName("x".repeat(60)).length).toBe(40);
    expect(core.nameKey(" RECIPES ")).toBe(core.nameKey("recipes"));
    const kw = core.normaliseKeywords([" Rice ", "rice", "", 7, "y".repeat(50), ...Array.from({ length: 30 }, (_, i) => `k${i}`)]);
    expect(kw[0]).toBe("Rice");
    expect(kw[1]).toBe("y".repeat(30));
    expect(kw.length).toBe(20);
    expect(core.parseKeywords("not json")).toEqual([]);
    expect(core.parseKeywords('{"a":1}')).toEqual([]);
    expect(core.normaliseTopic("   ")).toBeNull();
    expect(core.normaliseTopic("t".repeat(80))?.length).toBe(60);
  });
});

describe("R1237 categories", () => {
  test("create normalises; a name differing only in case or spaces is a 409", async () => {
    const u = await user();
    const c = await cat.createCategory(u.id, { name: "  Rice   Recipes ", keywords: ["rice", "Rice", " pilaf "] });
    expect(c.name).toBe("Rice Recipes");
    expect(c.keywords).toEqual(["rice", "pilaf"]);
    expect(await status(cat.createCategory(u.id, { name: "rice recipes" }))).toBe(409);
    expect(await status(cat.createCategory(u.id, { name: "   " }))).toBe(400);
    // Another owner may use the same name.
    const other = await user();
    expect((await cat.createCategory(other.id, { name: "Rice Recipes" })).name).toBe("Rice Recipes");
    const b = await cat.createCategory(u.id, { name: "Baking" });
    expect(await status(cat.renameCategory(u.id, b.id, { name: "RICE recipes" }))).toBe(409);
    expect((await cat.renameCategory(u.id, b.id, { name: "baking", keywords: ["bread"] })).keywords).toEqual(["bread"]);
    expect(await status(cat.renameCategory(other.id, b.id, { name: "Mine" }))).toBe(404);
    expect((await cat.listCategories(u.id)).map((x) => x.name)).toEqual(["baking", "Rice Recipes"]);
  });

  test("tagPost makes the item when missing, replaces the set and caps it at 5", async () => {
    const u = await user();
    const p = await post(u.id);
    const cs = await Promise.all(["A", "B", "C", "D", "E", "F"].map((name) => cat.createCategory(u.id, { name })));
    expect(await db.contentVariation.count({ where: { postId: p.id } })).toBe(0);
    const tags = await cat.tagPost(u.id, p.id, [cs[0].id, cs[1].id, cs[0].id]);
    expect(tags.map((t) => t.name)).toEqual(["A", "B"]);
    const v = await db.contentVariation.findUniqueOrThrow({ where: { postId: p.id } });
    expect(await db.contentItemCategory.count({ where: { itemId: v.itemId } })).toBe(2);
    expect(await status(cat.tagPost(u.id, p.id, cs.map((c) => c.id)))).toBe(400);
    await cat.tagPost(u.id, p.id, [cs[2].id]);
    expect((await cat.tagsForPost(u.id, p.id)).categories.map((c) => c.name)).toEqual(["C"]);
    await cat.tagPost(u.id, p.id, []);
    expect(await db.contentItemCategory.count({ where: { itemId: v.itemId } })).toBe(0);
  });

  test("another owner's category or post is refused and nothing changes", async () => {
    const [u, other] = [await user(), await user()];
    const p = await post(u.id);
    const mine = await cat.createCategory(u.id, { name: "Mine" });
    const theirs = await cat.createCategory(other.id, { name: "Theirs" });
    await cat.tagPost(u.id, p.id, [mine.id]);
    expect(await status(cat.tagPost(u.id, p.id, [mine.id, theirs.id]))).toBe(404);
    expect((await cat.tagsForPost(u.id, p.id)).categories.map((c) => c.id)).toEqual([mine.id]);
    expect(await status(cat.tagPost(other.id, p.id, [theirs.id]))).toBe(404);
    expect(await status(cat.setTopic(other.id, p.id, "x"))).toBe(404);
    expect(await status(cat.deleteCategory(u.id, theirs.id))).toBe(404);
  });

  test("setTopic stores a tidy topic and clears on blank", async () => {
    const u = await user();
    const p = await post(u.id);
    expect(await cat.setTopic(u.id, p.id, "  Weeknight   rice ")).toBe("Weeknight rice");
    expect((await cat.tagsForPost(u.id, p.id)).topic).toBe("Weeknight rice");
    expect(await cat.setTopic(u.id, p.id, " ")).toBeNull();
    expect((await cat.tagsForPost(u.id, p.id)).topic).toBeNull();
  });

  test("suggestion is deterministic, and null when no category has keywords", async () => {
    const u = await user();
    const p = await post(u.id, { title: "Fluffy rice every time", story: "Rinse the rice, then rest it.", hook: "Bread lovers look away" });
    await cat.createCategory(u.id, { name: "Bread" });
    expect(await cat.suggestForPost(u.id, p.id)).toBeNull();
    const rice = await cat.createCategory(u.id, { name: "Grains", keywords: ["rice", "pilaf"] });
    await cat.createCategory(u.id, { name: "Baking", keywords: ["bread"] });
    const a = await cat.suggestForPost(u.id, p.id);
    const b = await cat.suggestForPost(u.id, p.id);
    expect(a).toEqual({ id: rice.id, name: "Grains" });
    expect(b).toEqual(a);
    // Once applied it is no longer offered.
    await cat.tagPost(u.id, p.id, [rice.id]);
    expect((await cat.tagsForPost(u.id, p.id)).suggestion).toBeNull();
    const plain = await post(u.id, { title: "Nothing relevant" });
    expect(await cat.suggestForPost(u.id, plain.id)).toBeNull();
  });

  test("delete removes the category's tags, the item stays; tagsForPost never makes an item", async () => {
    const u = await user();
    const p = await post(u.id);
    const c = await cat.createCategory(u.id, { name: "Gone soon" });
    await cat.tagPost(u.id, p.id, [c.id]);
    const v = await db.contentVariation.findUniqueOrThrow({ where: { postId: p.id } });
    await cat.deleteCategory(u.id, c.id);
    expect(await db.contentItemCategory.count({ where: { categoryId: c.id } })).toBe(0);
    expect(await db.contentCategory.count({ where: { id: c.id } })).toBe(0);
    expect(await db.contentItem.count({ where: { id: v.itemId } })).toBe(1);
    const fresh = await post(u.id);
    expect((await cat.tagsForPost(u.id, fresh.id)).categories).toEqual([]);
    expect(await db.contentVariation.count({ where: { postId: fresh.id } })).toBe(0);
  });
});

describe("R1237 routes", () => {
  const req = (method: string, path: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" } });

  test("an editor can create a category and tag a post; GET returns tags, topic and the list", async () => {
    const owner = await user();
    const p = await post(owner.id);
    g.__r1237User = { ...owner, role: "editor", joinedAt: owner.createdAt, actor: { id: "someone" }, scope: null };
    const made = await catsRoute.POST(req("POST", "/api/content/categories", { name: "Tips", keywords: ["tip"] }), { params: {} });
    expect(made.status).toBe(201);
    const { category } = (await made.json()) as { category: { id: string } };
    const put = await tagsRoute.PUT(req("PUT", `/api/posts/${p.id}/tags`, { categoryIds: [category.id], topic: "Quick tips" }), { params: { id: p.id } });
    expect(put.status).toBe(200);
    const got = (await (await tagsRoute.GET(req("GET", `/api/posts/${p.id}/tags`), { params: { id: p.id } })).json()) as { topic: string; categories: { id: string }[]; available: unknown[] };
    expect(got.topic).toBe("Quick tips");
    expect(got.categories.map((c) => c.id)).toEqual([category.id]);
    expect(got.available.length).toBe(1);
    const bad = await tagsRoute.PUT(req("PUT", `/api/posts/${p.id}/tags`, { categoryIds: Array.from({ length: 6 }, (_, i) => `c${i}`) }), { params: { id: p.id } });
    expect(bad.status).toBe(400);
  });
});

describe("R1237 UI pins", () => {
  const src = readFileSync("components/content/TagsControl.tsx", "utf8");
  const sheet = readFileSync("components/posts/PostSheet.tsx", "utf8");
  test("TagsControl is a client component mounted in the post sheet", () => {
    expect(src.startsWith('"use client"')).toBe(true);
    expect(sheet).toContain('import { TagsControl } from "@/components/content/TagsControl";');
    expect(sheet).toContain("<TagsControl postId={post.id} />");
  });
  test("accessible, house style, no server values", () => {
    expect(src).toContain("min-h-11");
    expect(src).toContain("h-11");
    expect(src).toContain("focus-visible:");
    expect(src).toContain("aria-pressed");
    expect(src).toContain('role="alert"');
    expect(src).toContain("Suggested: ");
    expect(src).toContain("onBlur={saveTopic}");
    expect(src).toContain('e.key === "Enter"');
    expect(src).not.toContain("transition-all");
    expect(src).not.toContain("\u2014");
    // Only types may come from the server module.
    expect(src).toMatch(/import type \{ PostTags \} from "@\/lib\/intelligence\/categories";/);
    expect(src).not.toMatch(/^import \{[^}]*\} from "@\/lib\/intelligence\/categories";/m);
  });
  test("the client limits match the server's", () => {
    expect(src).toContain(`TOPIC_MAX = ${core.TOPIC_MAX}`);
    expect(src).toContain(`NAME_MAX = ${core.NAME_MAX}`);
    expect(src).toContain(`TAGS_MAX = ${core.TAGS_PER_ITEM}`);
  });
  test("no em dashes in the new server files", () => {
    for (const f of ["lib/intelligence/categories.ts", "lib/intelligence/categories-core.ts", "app/api/posts/[id]/tags/route.ts", "app/api/content/categories/route.ts", "app/api/content/categories/[id]/route.ts"])
      expect(readFileSync(f, "utf8")).not.toContain("\u2014");
  });
});

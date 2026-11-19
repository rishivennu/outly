/**
 * R1233: Content Memory (lib/intelligence/memory.ts) against the test database: idempotent items, adaptation
 * lineage, a resumable idempotent backfill, defensive storyMeta parsing, practice posts skipped, tenant isolation
 * and brand profile validation.
 */
import { beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let mem: typeof import("../lib/intelligence/memory");
let n = 0;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  mem = await import("../lib/intelligence/memory");
}, 60_000);

async function user() {
  return db.user.create({ data: { name: `M ${++n}`, email: `r1233-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
}
async function post(userId: string, o: { story?: string; storyMeta?: string | null; targets?: { platform?: string; status?: string; practice?: boolean }[]; format?: string } = {}) {
  const media = await db.media.create({ data: { userId, storageKey: `sample/m${++n}.mp4`, originalFilename: "a.mp4", mimeType: "video/mp4", size: 10, status: "ready" } });
  const p = await db.post.create({
    data: { userId, mediaId: media.id, status: "published", title: `Post ${n}`, story: o.story ?? "Three ways to cook rice. Then a long tail.", storyMeta: o.storyMeta ?? null, format: o.format ?? "video", publishedAt: new Date() },
  });
  for (const t of o.targets ?? [{}]) {
    await db.postTarget.create({ data: { postId: p.id, platform: t.platform ?? "instagram", platformStatus: t.status ?? "published", practice: t.practice ?? false } });
  }
  return p;
}

describe("R1233 ensureItemForPost", () => {
  test("creates once, then returns the same item", async () => {
    const u = await user();
    const p = await post(u.id, { format: "carousel" });
    const a = await mem.ensureItemForPost(u.id, p.id, { origin: "manual" });
    const b = await mem.ensureItemForPost(u.id, p.id);
    expect(a?.created).toBe(true);
    expect(b?.created).toBe(false);
    expect(b?.item.id).toBe(a!.item.id);
    expect(a?.item.format).toBe("carousel");
    expect(a?.item.concept).toBe("Three ways to cook rice.");
    expect(a?.variation.kind).toBe("original");
    expect(a?.variation.platform).toBe("instagram");
    expect(await db.contentItem.count({ where: { ownerId: u.id } })).toBe(1);
  });
  test("another owner's post is not found", async () => {
    const [u, other] = [await user(), await user()];
    const p = await post(u.id);
    expect(await mem.ensureItemForPost(other.id, p.id)).toBeNull();
    expect(await db.contentVariation.count({ where: { postId: p.id } })).toBe(0);
  });
});

describe("R1233 attachAdaptation", () => {
  test("child joins the parent's item, parent item made first when missing", async () => {
    const u = await user();
    const parent = await post(u.id);
    const child = await post(u.id, { targets: [{ platform: "youtube" }] });
    const v = await mem.attachAdaptation(u.id, parent.id, child.id, { tone: "hook" });
    const pv = await db.contentVariation.findUnique({ where: { postId: parent.id } });
    expect(pv).not.toBeNull();
    expect(v?.itemId).toBe(pv!.itemId);
    expect(v?.parentVariationId).toBe(pv!.id);
    expect(v?.kind).toBe("adapted");
    expect(v?.tone).toBe("hook");
    expect(v?.platform).toBe("youtube");
    const again = await mem.attachAdaptation(u.id, parent.id, child.id, { tone: "hook" });
    expect(again?.id).toBe(v!.id);
    expect(await db.contentItem.count({ where: { ownerId: u.id } })).toBe(1);
  });
  test("a child with its own item moves and the empty item is archived; loops are refused", async () => {
    const u = await user();
    const parent = await post(u.id);
    const child = await post(u.id);
    const own = await mem.ensureItemForPost(u.id, child.id);
    await mem.attachAdaptation(u.id, parent.id, child.id);
    const old = await db.contentItem.findUnique({ where: { id: own!.item.id } });
    expect(old?.archivedAt).not.toBeNull();
    expect(await mem.attachAdaptation(u.id, child.id, parent.id)).toBeNull();
    expect(await mem.attachAdaptation(u.id, parent.id, parent.id)).toBeNull();
  });
  test("cross-owner parent is ignored", async () => {
    const [u, other] = [await user(), await user()];
    const foreign = await post(other.id);
    const child = await post(u.id);
    expect(await mem.attachAdaptation(u.id, foreign.id, child.id)).toBeNull();
    expect(await db.contentVariation.count({ where: { postId: foreign.id } })).toBe(0);
  });
});

describe("R1233 backfillOwner", () => {
  test("idempotent, practice-only skipped, malformed and cross-owner storyMeta ignored, adaptedFrom attached", async () => {
    const [u, other] = [await user(), await user()];
    const foreign = await post(other.id);
    const a = await post(u.id);
    const b = await post(u.id, { storyMeta: JSON.stringify({ mode: "adapt", adaptedFrom: a.id }) });
    const bad = await post(u.id, { storyMeta: "{not json" });
    const arr = await post(u.id, { storyMeta: "[1,2]" });
    const cross = await post(u.id, { storyMeta: JSON.stringify({ adaptedFrom: foreign.id }) });
    const practice = await post(u.id, { targets: [{ practice: true }] });
    const draft = await post(u.id, { targets: [{ status: "pending" }] });

    const first = await mem.backfillOwner(u.id, { batch: 200 });
    expect(first.scanned).toBe(5);
    expect(first.attached).toBe(1);
    expect(first.created).toBe(4);
    expect(first.nextCursor).toBeNull();
    const items1 = await db.contentItem.count({ where: { ownerId: u.id } });
    const vars1 = await db.contentVariation.count({ where: { item: { ownerId: u.id } } });
    expect(items1).toBe(4);
    expect(vars1).toBe(5);

    const second = await mem.backfillOwner(u.id);
    expect(second).toEqual({ scanned: 0, created: 0, attached: 0, nextCursor: null });
    expect(await db.contentItem.count({ where: { ownerId: u.id } })).toBe(items1);
    expect(await db.contentVariation.count({ where: { item: { ownerId: u.id } } })).toBe(vars1);

    const av = await db.contentVariation.findUnique({ where: { postId: a.id } });
    const bv = await db.contentVariation.findUnique({ where: { postId: b.id } });
    expect(bv?.itemId).toBe(av!.itemId);
    expect(bv?.kind).toBe("adapted");
    for (const p of [bad, arr, cross]) expect((await db.contentVariation.findUnique({ where: { postId: p.id } }))?.kind).toBe("original");
    expect(await db.contentVariation.count({ where: { postId: { in: [practice.id, draft.id, foreign.id] } } })).toBe(0);
    expect((await db.contentItem.findFirst({ where: { ownerId: u.id } }))?.origin).toBe("backfill");
  });
  test("resumable in small batches", async () => {
    const u = await user();
    for (let i = 0; i < 3; i++) await post(u.id);
    const r1 = await mem.backfillOwner(u.id, { batch: 2 });
    expect(r1.scanned).toBe(2);
    expect(r1.nextCursor).not.toBeNull();
    const r2 = await mem.backfillOwner(u.id, { batch: 2, cursor: r1.nextCursor });
    expect(r2.scanned).toBe(1);
    expect(r2.nextCursor).toBeNull();
    expect(await db.contentItem.count({ where: { ownerId: u.id } })).toBe(3);
  });
  test("adaptedFromOf is defensive", () => {
    expect(mem.adaptedFromOf(null)).toBeNull();
    expect(mem.adaptedFromOf("nope")).toBeNull();
    expect(mem.adaptedFromOf('{"adaptedFrom":5}')).toBeNull();
    expect(mem.adaptedFromOf('{"adaptedFrom":"abc"}')).toBe("abc");
  });
});

describe("R1233 listItems and archiveItem", () => {
  test("owner-scoped, paged, archived items hidden", async () => {
    const [u, other] = [await user(), await user()];
    for (let i = 0; i < 3; i++) await mem.ensureItemForPost(u.id, (await post(u.id)).id);
    const page1 = await mem.listItems(u.id, { limit: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.items[0].variations[0].post.targets[0].platform).toBe("instagram");
    const page2 = await mem.listItems(u.id, { limit: 2, cursor: page1.nextCursor });
    expect(page2.items.length).toBe(1);
    expect(page2.nextCursor).toBeNull();
    expect((await mem.listItems(other.id)).items).toEqual([]);
    const id = page1.items[0].id;
    expect(await mem.archiveItem(other.id, id)).toBe(false);
    expect(await mem.archiveItem(u.id, id)).toBe(true);
    expect((await mem.listItems(u.id)).items.length).toBe(2);
  });
});

describe("R1233 brand profile", () => {
  test("objective validated, lists cleaned, scopes and owners isolated", async () => {
    const [u, other] = [await user(), await user()];
    await expect(mem.upsertBrandProfile(u.id, "", { objective: "fame" })).rejects.toThrow();
    const p = await mem.upsertBrandProfile(u.id, "", { objective: "community", pillars: [" Recipes ", "Recipes", "", "Travel"], tone: "warm" });
    expect(p.objective).toBe("community");
    expect(p.pillars).toEqual(["Recipes", "Travel"]);
    await mem.upsertBrandProfile(u.id, "client-a", { objective: "sales", name: "Client A" });
    expect((await mem.getBrandProfile(u.id))?.objective).toBe("community");
    expect((await mem.getBrandProfile(u.id, "client-a"))?.name).toBe("Client A");
    expect(await mem.getBrandProfile(other.id)).toBeNull();
    const again = await mem.upsertBrandProfile(u.id, "", { objective: "awareness" });
    expect(again.objective).toBe("awareness");
    expect(again.tone).toBeNull();
    expect(await db.brandProfile.count({ where: { ownerId: u.id } })).toBe(2);
  });
});

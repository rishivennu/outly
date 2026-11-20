/**
 * R1246: agency clients made real. A client brand profile lists the owner's accounts it covers (BrandProfile.accountIds),
 * the brand routes manage clients under ?scope=, and the overview narrows to a client's accounts when it has any.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import { CLIENTS_MAX, CLIENT_ACCOUNTS_MAX, brandProfileSchema, isScopeKey, parseBrandBody, slugOf } from "../lib/intelligence/brand-core";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));
const g = globalThis as unknown as { __r1246User?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__r1246User !== undefined ? g.__r1246User : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let encrypt: typeof import("../lib/crypto").encrypt;
let mem: typeof import("../lib/intelligence/memory");
let vc: typeof import("../components/intelligence/view-core");
let brandRoute: typeof import("../app/api/settings/brand/route");
let profilesRoute: typeof import("../app/api/settings/brand/profiles/route");
let overviewRoute: typeof import("../app/api/intelligence/overview/route");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  ({ encrypt } = await import("../lib/crypto"));
  mem = await import("../lib/intelligence/memory");
  vc = await import("../components/intelligence/view-core");
  brandRoute = await import("../app/api/settings/brand/route");
  profilesRoute = await import("../app/api/settings/brand/profiles/route");
  overviewRoute = await import("../app/api/intelligence/overview/route");
}, 60_000);
afterAll(() => {
  delete g.__r1246User;
});

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const DAY = 864e5;
let n = 0;
async function user() {
  return db.user.create({ data: { name: `C ${++n}`, email: `r1246-${n}-${Date.now()}@test.dev`, passwordHash: "x", timezone: "UTC" } });
}
async function account(userId: string, platform = "instagram") {
  return db.socialAccount.create({ data: { userId, platform, platformUserId: `${platform}-${++n}-${Date.now()}`, username: `acct${n}`, accessToken: encrypt("tok"), status: "connected" } });
}
async function post(userId: string, accountId: string, views: number) {
  const at = new Date(Date.now() - 3 * DAY);
  const media = await db.media.create({ data: { userId, originalFilename: "v.mp4", storageKey: `r1246/${++n}-${Date.now()}.mp4`, mimeType: "video/mp4", size: 100, status: "ready" } });
  const p = await db.post.create({ data: { userId, mediaId: media.id, title: `P${n}`, story: "A story.", status: "published", format: "video", publishedAt: at } });
  const t = await db.postTarget.create({ data: { postId: p.id, platform: "instagram", socialAccountId: accountId, platformStatus: "published", practice: false, publishedAt: at } });
  await db.targetMetric.create({ data: { targetId: t.id, capturedAt: at, views, likes: 3, comments: 1, shares: 0, saves: 0 } });
}
const asOwner = (u: { id: string; name: string; email: string; createdAt: Date }) => (g.__r1246User = { ...u, role: "owner", joinedAt: u.createdAt, actor: null, scope: null });
const asMember = (u: { id: string; name: string; email: string; createdAt: Date }) =>
  (g.__r1246User = { ...u, role: "manager", joinedAt: u.createdAt, actor: { id: "m", name: "M", email: "m@test.dev" }, scope: null });
const headers = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };
const req = (path: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = { params: {} } as never;

describe("R1246 the client rules", () => {
  test("a client needs a name; your own brand does not", () => {
    expect(brandProfileSchema.safeParse({ objective: "sales" }).success).toBe(true);
    expect(brandProfileSchema.safeParse({ objective: "sales", client: true }).success).toBe(false);
    expect(brandProfileSchema.safeParse({ objective: "sales", scopeKey: "acme" }).success).toBe(false);
    expect(brandProfileSchema.safeParse({ objective: "sales", scopeKey: "acme", name: "   " }).success).toBe(false);
    expect(brandProfileSchema.safeParse({ objective: "sales", scopeKey: "acme", name: "Acme" }).success).toBe(true);
    expect(() => parseBrandBody({ objective: "sales" }, "acme")).toThrow();
    expect(parseBrandBody({ objective: "sales", name: "Acme" }, "acme").scopeKey).toBe("acme");
  });
  test("client keys are 1 to 40 of [a-z0-9-], and one is made from the name", () => {
    expect(isScopeKey("zeta-foods-2")).toBe(true);
    expect(isScopeKey("Zeta")).toBe(false);
    expect(isScopeKey("a_b")).toBe(false);
    expect(isScopeKey("")).toBe(false);
    expect(isScopeKey("a".repeat(41))).toBe(false);
    expect(brandProfileSchema.safeParse({ objective: "sales", name: "A", scopeKey: "Bad Key" }).success).toBe(false);
    expect(slugOf("Zeta Foods & Co.")).toBe("zeta-foods-co");
    expect(slugOf("Café Ñandú")).toBe("cafe-nandu");
    expect(slugOf("!!!")).toBe("client");
    const long = slugOf(`${"word ".repeat(20)}`);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(isScopeKey(long)).toBe(true);
  });
  test("account ids are deduped and capped at 50", () => {
    const ids = Array.from({ length: CLIENT_ACCOUNTS_MAX + 1 }, (_, i) => `acc${i}`);
    expect(CLIENT_ACCOUNTS_MAX).toBe(50);
    expect(brandProfileSchema.safeParse({ objective: "sales", accountIds: ids.slice(0, 50) }).success).toBe(true);
    expect(brandProfileSchema.safeParse({ objective: "sales", accountIds: ids }).success).toBe(false);
    const dup = brandProfileSchema.parse({ objective: "sales", accountIds: [...ids.slice(0, 30), ...ids.slice(0, 30)] });
    expect(dup.accountIds).toHaveLength(30);
    expect(brandProfileSchema.safeParse({ objective: "sales", accountIds: ["not an id!"] }).success).toBe(false);
  });
});

describe("R1246 client profiles in memory", () => {
  test("another owner's account ids are dropped on write; the own brand keeps none", async () => {
    const a = await user();
    const b = await user();
    const mine = await account(a.id);
    const theirs = await account(b.id);
    const p = await mem.upsertBrandProfile(a.id, "acme", { objective: "awareness", name: "Acme", accountIds: [mine.id, theirs.id, mine.id, "ghost"] });
    expect(p.accountIds).toEqual([mine.id]);
    expect(await mem.accountIdsForClient(a.id, "acme")).toEqual([mine.id]);
    expect(await mem.accountIdsForClient(b.id, "acme")).toBeNull();
    expect(await mem.accountIdsForClient(a.id, "")).toBeNull();
    // Leaving accountIds out keeps them.
    expect((await mem.upsertBrandProfile(a.id, "acme", { objective: "sales", name: "Acme" })).accountIds).toEqual([mine.id]);
    const own = await mem.upsertBrandProfile(a.id, "", { objective: "engagement", accountIds: [mine.id] });
    expect(own.accountIds).toEqual([]);
  });
  test("delete refuses the own brand and another owner's client", async () => {
    const a = await user();
    const b = await user();
    await mem.upsertBrandProfile(a.id, "", { objective: "engagement" });
    await mem.upsertBrandProfile(a.id, "acme", { objective: "awareness", name: "Acme" });
    expect(await mem.deleteBrandProfile(a.id, "")).toBe(false);
    expect(await mem.deleteBrandProfile(b.id, "acme")).toBe(false);
    expect(await db.brandProfile.count({ where: { ownerId: a.id } })).toBe(2);
    expect(await mem.deleteBrandProfile(a.id, "acme")).toBe(true);
    expect(await mem.deleteBrandProfile(a.id, "acme")).toBe(false);
    expect(await mem.getBrandProfile(a.id, "")).not.toBeNull();
  });
  test("new clients get a key from the name without overwriting, and stop at CLIENTS_MAX", async () => {
    const a = await user();
    const one = await mem.createClientProfile(a.id, { objective: "sales", name: "Acme Ltd" });
    const two = await mem.createClientProfile(a.id, { objective: "leads", name: "Acme Ltd" });
    expect([one.scopeKey, two.scopeKey]).toEqual(["acme-ltd", "acme-ltd-2"]);
    expect((await mem.getBrandProfile(a.id, "acme-ltd"))?.objective).toBe("sales");
    await expect(mem.createClientProfile(a.id, { objective: "sales", name: "X", scopeKey: "acme-ltd" })).rejects.toThrow();
    for (let i = 3; i <= CLIENTS_MAX; i++) await mem.createClientProfile(a.id, { objective: "sales", name: `Client ${i}` });
    // The own brand does not count as a client.
    await mem.upsertBrandProfile(a.id, "", { objective: "engagement" });
    expect(await db.brandProfile.count({ where: { ownerId: a.id, scopeKey: { not: "" } } })).toBe(CLIENTS_MAX);
    await expect(mem.createClientProfile(a.id, { objective: "sales", name: "One too many" })).rejects.toMatchObject({ status: 409 });
    // Editing an existing client is still fine at the cap.
    expect((await mem.upsertBrandProfile(a.id, "acme-ltd", { objective: "community", name: "Acme Ltd" })).objective).toBe("community");
  });
});

describe("R1246 /api/settings/brand clients", () => {
  test("add, read, edit, list and remove a client; the own brand can't be removed", async () => {
    const a = await user();
    const acc = await account(a.id, "youtube");
    asOwner(a);
    const got = (await (await brandRoute.GET(req("/api/settings/brand"), ctx)).json()) as { accounts: { id: string; platform: string; username: string }[] };
    expect(got.accounts.map((x) => x.id)).toEqual([acc.id]);
    expect(JSON.stringify(got)).not.toContain("accessToken");

    const noName = await brandRoute.POST(req("/api/settings/brand", "POST", { objective: "sales", client: true }), ctx);
    expect(noName.status).toBe(400);
    const made = await brandRoute.POST(req("/api/settings/brand", "POST", { objective: "sales", client: true, name: "Zeta Foods", accountIds: [acc.id] }), ctx);
    expect(made.status).toBe(200);
    const created = ((await made.json()) as { profile: { scopeKey: string; accountIds: string[] } }).profile;
    expect(created).toMatchObject({ scopeKey: "zeta-foods", accountIds: [acc.id] });
    // Creating a client never touched the own brand.
    expect(await mem.getBrandProfile(a.id, "")).toBeNull();

    const one = (await (await brandRoute.GET(req("/api/settings/brand?scope=zeta-foods"), ctx)).json()) as { profile: { name: string } };
    expect(one.profile.name).toBe("Zeta Foods");
    const edit = await brandRoute.POST(req("/api/settings/brand?scope=zeta-foods", "POST", { objective: "community", name: "Zeta", accountIds: [] }), ctx);
    expect(((await edit.json()) as { profile: { objective: string; accountIds: string[] } }).profile).toMatchObject({ objective: "community", accountIds: [] });
    const ghost = await brandRoute.POST(req("/api/settings/brand?scope=ghost", "POST", { objective: "community", name: "Ghost" }), ctx);
    expect(ghost.status).toBe(404);

    const listed = (await (await profilesRoute.GET(req("/api/settings/brand/profiles"), ctx)).json()) as { profiles: { scopeKey: string; accountIds: string[] }[] };
    expect(listed.profiles).toEqual([expect.objectContaining({ scopeKey: "zeta-foods", accountIds: [] })]);

    expect((await brandRoute.DELETE(req("/api/settings/brand", "DELETE"), ctx)).status).toBe(400);
    expect((await brandRoute.DELETE(req("/api/settings/brand?scope=ghost", "DELETE"), ctx)).status).toBe(404);
    expect((await brandRoute.DELETE(req("/api/settings/brand?scope=zeta-foods", "DELETE"), ctx)).status).toBe(200);
    expect(await mem.getBrandProfile(a.id, "zeta-foods")).toBeNull();
  });
  test("one owner can't remove another's client", async () => {
    const a = await user();
    const b = await user();
    await mem.upsertBrandProfile(a.id, "acme", { objective: "awareness", name: "Acme" });
    asOwner(b);
    expect((await brandRoute.DELETE(req("/api/settings/brand?scope=acme", "DELETE"), ctx)).status).toBe(404);
    expect(await mem.getBrandProfile(a.id, "acme")).not.toBeNull();
  });
});

describe("R1246 overview per client", () => {
  test("a client with one account sees only that account's posts; one with none sees the workspace and clientAccounts 0", async () => {
    const a = await user();
    const one = await account(a.id);
    const two = await account(a.id);
    for (const v of [100, 200, 300]) await post(a.id, one.id, v);
    for (const v of [400, 500]) await post(a.id, two.id, v);
    await mem.upsertBrandProfile(a.id, "acme", { objective: "awareness", name: "Acme", accountIds: [one.id] });
    await mem.upsertBrandProfile(a.id, "empty", { objective: "sales", name: "Empty" });
    asOwner(a);

    const all = (await (await overviewRoute.GET(req("/api/intelligence/overview?days=28"), ctx)).json()) as { posts: number; clientAccounts?: number };
    expect(all.posts).toBe(5);
    expect(all.clientAccounts).toBeUndefined();

    const acme = (await (await overviewRoute.GET(req("/api/intelligence/overview?days=28&client=acme"), ctx)).json()) as { posts: number; objective: string; clientAccounts: number };
    expect(acme).toMatchObject({ posts: 3, objective: "awareness", clientAccounts: 1 });

    // An account the client does not own leaves nothing, never the workspace's numbers.
    const other = (await (await overviewRoute.GET(req(`/api/intelligence/overview?days=28&client=acme&account=${two.id}`), ctx)).json()) as { posts: number };
    expect(other.posts).toBe(0);

    const empty = (await (await overviewRoute.GET(req("/api/intelligence/overview?days=28&client=empty"), ctx)).json()) as { posts: number; objective: string; clientAccounts: number };
    expect(empty).toMatchObject({ posts: 5, objective: "sales", clientAccounts: 0 });

    asMember(a);
    expect((await overviewRoute.GET(req("/api/intelligence/overview?days=28&client=acme"), ctx)).status).toBe(403);
  });
  test("the switcher says whose numbers are on screen", () => {
    expect(vc.clientNote(null)).toBe(vc.CLIENT_NOTE);
    expect(vc.clientNote(0)).toBe(vc.CLIENT_NO_ACCOUNTS_NOTE);
    expect(vc.CLIENT_NO_ACCOUNTS_NOTE).toContain("This client has no accounts yet; add them in Settings, Brand.");
    expect(vc.clientNote(1)).toBe("Numbers from this client's 1 account only.");
    expect(vc.clientNote(3)).toBe("Numbers from this client's 3 accounts only.");
    const profiles = [
      { scopeKey: "", name: "Me", objective: "engagement", accountIds: [] },
      { scopeKey: "acme", name: "Acme", objective: "awareness", accountIds: ["a", "b"] },
      { scopeKey: "old", name: "Old", objective: "sales" },
    ];
    expect(vc.clientAccountCount(profiles, "")).toBeNull();
    expect(vc.clientAccountCount(profiles, "acme")).toBe(2);
    expect(vc.clientAccountCount(profiles, "old")).toBe(0);
    expect(vc.clientAccountCount(profiles, "ghost")).toBeNull();
  });
});

describe("R1246 the Clients section", () => {
  const card = read("components/settings/BrandProfileCard.tsx");
  test("honest empty states, a confirm step, and the house rules", () => {
    expect(card).toContain("No clients yet. Add one to see its numbers on their own.");
    expect(card).toContain("You have no connected accounts yet.");
    expect(card).toContain("Yes, remove");
    expect(card).toContain('type="checkbox"');
    expect(card).toContain("{!workspace && <ClientsSection");
    expect(card).not.toContain("transition-all");
    expect(card).not.toContain("\u2014");
    expect(read("lib/intelligence/brand-core.ts")).not.toContain("\u2014");
    expect(read("lib/intelligence/memory.ts")).not.toContain("\u2014");
  });
  test("both schema files carry BrandProfile.accountIds", () => {
    for (const f of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) expect(read(f)).toMatch(/model BrandProfile \{[^}]*accountIds String\?/);
  });
});

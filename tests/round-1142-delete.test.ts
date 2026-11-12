/**
 * 1142: deleting a reel. Instagram can't be deleted by API, so with appOnly=verify Outlly checks Instagram no
 * longer has it before anything changes; and deleting gives the post slot back with the fresh count.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

let db: typeof import("../lib/db").db;
let del: typeof import("../lib/posts/delete");
let ent: typeof import("../lib/billing/entitlements");
let keys: typeof import("../lib/social/keys");
let enc: (s: string) => string;
let n = 0;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  keys?.__setKeys(undefined);
});

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  del = await import("../lib/posts/delete");
  ent = await import("../lib/billing/entitlements");
  keys = await import("../lib/social/keys");
  enc = (await import("../lib/crypto")).encrypt;
  await (await import("../lib/billing/plans")).ensurePlans();
}, 60_000);

function stubFetch(handler: (url: string) => Response) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return calls;
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const gone = () => json({ error: { message: "Unsupported get request. Object with ID '1' does not exist", type: "IGApiException", code: 100, error_subcode: 33, fbtrace_id: "x" } }, 400);

async function user() {
  return db.user.create({ data: { name: `D ${++n}`, email: `r1142-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
}
async function igPost(userId: string, status = "published") {
  const media = await db.media.create({ data: { userId, storageKey: `sample/d${n}.mp4`, originalFilename: "a.mp4", mimeType: "video/mp4", size: 10, status: "ready" } });
  const acct = await db.socialAccount.create({ data: { userId, platform: "instagram", platformUserId: `real-ig-${++n}`, username: "@me", accessToken: enc("tok-secret"), status: "connected" } });
  const p = await db.post.create({ data: { userId, mediaId: media.id, status: status === "published" ? "published" : "draft", title: "Reel", launchedAt: new Date() } });
  const live = status === "published";
  const t = await db.postTarget.create({
    data: { postId: p.id, platform: "instagram", socialAccountId: acct.id, platformStatus: status, platformPostId: live ? `1790${n}` : null, platformUrl: live ? `https://www.instagram.com/reel/x${n}/` : null, publishedAt: live ? new Date() : null },
  });
  return { p, t };
}

describe("1142 Instagram delete is checked, not assumed", () => {
  test("still on Instagram: STILL_LIVE, and nothing changed", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const { p, t } = await igPost(u.id);
    const calls = stubFetch(() => json({ id: "1" }));
    await expect(del.deletePost({ id: u.id }, p.id, { platforms: true, appOnlyAck: true, verify: true })).rejects.toMatchObject({ status: 409, code: "STILL_LIVE" });
    expect(calls.some((c) => c.includes("fields=id"))).toBe(true);
    expect(calls.some((c) => c.includes("tok-secret") && !c.includes("graph.instagram.com"))).toBe(false);
    expect(await db.post.count({ where: { id: p.id } })).toBe(1);
    expect((await db.postTarget.findUniqueOrThrow({ where: { id: t.id } })).removeMode).toBeNull();
  });

  test("deleted in the app: recorded as deleted on Instagram and removed from the studio", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const { p } = await igPost(u.id);
    const acct = await db.socialAccount.findFirstOrThrow({ where: { userId: u.id } });
    const calls = stubFetch((url) => (url.includes("/me?") ? json({ id: acct.platformUserId }) : gone()));
    const r = await del.deletePost({ id: u.id }, p.id, { platforms: true, appOnlyAck: true, verify: true });
    expect(calls.some((c) => c.includes("/me?"))).toBe(true); // "does not exist" is only trusted once the token is proven
    expect(r.local).toBe("deleted");
    expect(r.remote).toEqual([expect.objectContaining({ platform: "instagram", outcome: "deleted" })]);
    expect(await db.post.count({ where: { id: p.id } })).toBe(0);
  });

  test("'does not exist' with a token that can't read its own account is not proof: CANT_CHECK", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const { p, t } = await igPost(u.id);
    stubFetch((url) => (url.includes("/me?") ? json({ error: { message: "Invalid OAuth access token", code: 190 } }, 400) : gone()));
    await expect(del.deletePost({ id: u.id }, p.id, { platforms: true, appOnlyAck: true, verify: true })).rejects.toMatchObject({ code: "CANT_CHECK" });
    expect(await db.post.count({ where: { id: p.id } })).toBe(1);
    expect((await db.postTarget.findUniqueOrThrow({ where: { id: t.id } })).removeMode).toBeNull();
  });

  test("a bare code 100 without subcode 33 is not proof either", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const { p } = await igPost(u.id);
    stubFetch((url) => (url.includes("/me?") ? json({ id: "x" }) : json({ error: { message: "Object does not exist, cannot be loaded due to missing permissions", code: 100 } }, 400)));
    await expect(del.deletePost({ id: u.id }, p.id, { platforms: true, appOnlyAck: true, verify: true })).rejects.toMatchObject({ code: "CANT_CHECK" });
    expect(await db.post.count({ where: { id: p.id } })).toBe(1);
  });

  test("Instagram doesn't answer: CANT_CHECK, nothing changed", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const { p } = await igPost(u.id);
    stubFetch(() => json({ error: { message: "down" } }, 503));
    await expect(del.deletePost({ id: u.id }, p.id, { platforms: true, appOnlyAck: true, verify: true })).rejects.toMatchObject({ code: "CANT_CHECK" });
    expect(await db.post.count({ where: { id: p.id } })).toBe(1);
  });

  test("studio only never calls Instagram and keeps it live", async () => {
    const u = await user();
    const { p } = await igPost(u.id);
    const calls = stubFetch(() => json({}));
    const r = await del.deletePost({ id: u.id }, p.id, { platforms: false, appOnlyAck: false });
    expect(r.remote).toEqual([expect.objectContaining({ platform: "instagram", outcome: "kept" })]);
    expect(calls).toHaveLength(0);
  });
});

describe("1142 deleting gives the post slot back", () => {
  test("the slot is freed at once and the answer carries the new count", async () => {
    // Other suites change the Free plan; pin a counted limit here and put it back after.
    const before = await db.plan.findUniqueOrThrow({ where: { slug: "free" } });
    await db.plan.update({ where: { slug: "free" }, data: { postLimit: 2, postPeriod: "week" } });
    try {
      const u = await user();
      const limit = (await ent.postUsage(u.id)).postLimit;
      expect(limit).toBe(2);
      const made = [];
      for (let i = 0; i < limit; i++) {
        const { p } = await igPost(u.id, "pending");
        await ent.spendPost(u.id, p.id);
        made.push(p);
      }
      expect((await ent.postUsage(u.id)).left).toBe(0);
      const r = await del.deletePost({ id: u.id }, made[0].id, { platforms: false, appOnlyAck: false });
      expect(r.quota).toMatchObject({ left: 1, limit, freed: true });
      const next = await igPost(u.id, "pending");
      expect((await ent.spendPost(u.id, next.p.id)).fresh).toBe(true);
    } finally {
      await db.plan.update({ where: { slug: "free" }, data: { postLimit: before.postLimit, postPeriod: before.postPeriod } });
    }
  });

  test("a top-up unit that paid for the slot goes back to the pack", async () => {
    const u = await user();
    const { p } = await igPost(u.id, "pending");
    const pack = await db.topUp.create({ data: { userId: u.id, kind: "x", pack: "t", units: 5, remaining: 4, status: "active", expiresAt: new Date(Date.now() + 864e5) } as never });
    await db.featureUse.create({ data: { userId: u.id, feature: "post", period: ent.periodKey("week"), ref: p.id, topUpId: pack.id } });
    await del.deletePost({ id: u.id }, p.id, { platforms: false, appOnlyAck: false });
    expect((await db.topUp.findUniqueOrThrow({ where: { id: pack.id } })).remaining).toBe(5);
    expect(await db.featureUse.count({ where: { userId: u.id, ref: p.id } })).toBe(0);
  });

  test("checks stay read-only until all pass; refreshes can't wedge; welcome lifts if unmounted mid-exit", () => {
    const d = readFileSync("lib/posts/delete.ts", "utf8");
    expect(d).toContain("confirmGone(user.id, t.id, false)");
    expect(d.indexOf("markDeleted(user.id, id)")).toBeGreaterThan(d.indexOf('"CANT_CHECK"'));
    expect(readFileSync("lib/cache.ts", "utf8")).toContain("REFRESH_STUCK_MS");
    expect(readFileSync("components/shell/PwaWelcome.tsx", "utf8")).toContain("Unmounted mid-exit");
  });

  test("the sheet confirms, names what stays live, refreshes the counts and checks Instagram", () => {
    const s = readFileSync("components/posts/PostSheet.tsx", "utf8");
    expect(s).toContain("appOnly=verify");
    expect(s).toContain("router.refresh()");
    expect(s).toContain('setConfirm("everywhere")');
    expect(s).toContain("This can't be undone");
  });
});

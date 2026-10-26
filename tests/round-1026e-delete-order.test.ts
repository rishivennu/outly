/** 10-26e: a platform delete records its intent first, so a failed save can't leave a gone post looking live. */
import { beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let rm: typeof import("../lib/social/remove");
let keys: typeof import("../lib/social/keys");
let enc: (s: string) => string;
let n = 0;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  rm = await import("../lib/social/remove");
  keys = await import("../lib/social/keys");
  enc = (await import("../lib/crypto")).encrypt;
}, 60_000);

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => handler(String(input instanceof Request ? input.url : input), init)) as typeof fetch;
}

async function setup(platform: string, removeMode: string | null = null, removedAt: Date | null = null) {
  const u = await db.user.create({ data: { name: `Ord ${++n}`, email: `ord-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: u.id, storageKey: `sample/o${n}.mp4`, originalFilename: "a.mp4", mimeType: "video/mp4", size: 10, status: "ready" } });
  const acct = await db.socialAccount.create({ data: { userId: u.id, platform, platformUserId: `real-o${n}`, username: "@me", accessToken: enc("tok"), status: "connected" } });
  const post = await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "published", title: "Clip" } });
  const t = await db.postTarget.create({
    data: { postId: post.id, platform, socialAccountId: acct.id, platformStatus: "published", platformPostId: "pp-1", platformUrl: "https://example.com/p/1", publishedAt: new Date(), removeMode, removedAt },
  });
  return { u, t };
}
const mode = async (id: string) => (await db.postTarget.findUniqueOrThrow({ where: { id } })).removeMode;
const fail = async (p: Promise<unknown>) => p.then(() => null, (e) => e as { code?: string });

describe("delete writes its intent before calling the platform", () => {
  test("the row says 'deleting' while X is being called, then 'deleted'", async () => {
    keys.__setKeys({ x: { clientId: "cid", clientSecret: "sec" } } as never);
    const a = await setup("x");
    let during: string | null | undefined;
    stubFetch(async () => {
      during = await mode(a.t.id);
      return new Response(JSON.stringify({ data: { deleted: true } }));
    });
    await rm.removeFromPlatform(a.u.id, a.t.id, "delete");
    expect(during).toBe("deleting");
    expect(await mode(a.t.id)).toBe("deleted");
  });

  test("a refusal puts the marker back, so the post still shows live", async () => {
    const a = await setup("x");
    stubFetch(() => new Response(JSON.stringify({ data: { deleted: false } })));
    expect(await fail(rm.removeFromPlatform(a.u.id, a.t.id, "delete"))).not.toBeNull();
    expect(await mode(a.t.id)).toBeNull();
  });

  test("retrying a delete whose save failed finishes it, even when X now says deleted=false", async () => {
    const a = await setup("x", "deleting");
    stubFetch(() => new Response(JSON.stringify({ data: { deleted: false } })));
    await rm.removeFromPlatform(a.u.id, a.t.id, "delete");
    expect(await mode(a.t.id)).toBe("deleted");
  });

  test("a failed delete of a private YouTube video leaves it private, not public", async () => {
    keys.__setKeys({ youtube: { clientId: "cid", clientSecret: "sec" } } as never);
    const a = await setup("youtube", "hidden", new Date());
    stubFetch(() => new Response(JSON.stringify({ error: { message: "backend" } }), { status: 500 }));
    expect(await fail(rm.removeFromPlatform(a.u.id, a.t.id, "delete"))).not.toBeNull();
    expect(await mode(a.t.id)).toBe("hidden");
    keys.__setKeys(undefined);
  });
});

describe("env fallback covers every platform", () => {
  test("each keyed platform has CLIENT_ID / CLIENT_SECRET env vars", async () => {
    const { env } = await import("../lib/env");
    const { KEYED_PLATFORMS } = await import("../lib/settings");
    for (const p of KEYED_PLATFORMS) {
      expect(`${p.toUpperCase()}_CLIENT_ID` in env).toBe(true);
      expect(`${p.toUpperCase()}_CLIENT_SECRET` in env).toBe(true);
    }
  });
});

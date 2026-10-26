/**
 * 10-26c: take a live post down on the platform from inside Outlly (delete; YouTube private/public),
 * "remove everywhere", the Facebook / Threads dashboards no longer calling X's API, Meta Graph error codes,
 * and the Instagram-vs-Meta app ID guard.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let rm: typeof import("../lib/social/remove");
let services: typeof import("../lib/services");
let keys: typeof import("../lib/social/keys");
let enc: (s: string) => string;
let n = 0;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  rm = await import("../lib/social/remove");
  services = await import("../lib/services");
  keys = await import("../lib/social/keys");
  enc = (await import("../lib/crypto")).encrypt;
}, 60_000);

type Calls = { url: string; method: string; body?: string }[];
function stubFetch(handler: (url: string, init: RequestInit) => Response): Calls {
  const calls: Calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, method: (init.method ?? "GET").toUpperCase(), body: typeof init.body === "string" ? init.body : undefined });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

async function setup(platform: string, opts: { practice?: boolean; status?: string; accountStatus?: string; realAccount?: boolean } = {}) {
  const u = await db.user.create({ data: { name: `Del ${++n}`, email: `del-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: u.id, storageKey: `sample/${n}.mp4`, originalFilename: "a.mp4", mimeType: "video/mp4", size: 10, status: "ready" } });
  const acct = await db.socialAccount.create({
    data: {
      userId: u.id,
      platform,
      platformUserId: opts.realAccount ? `real-${n}` : `mock-${n}`,
      username: "@me",
      accessToken: enc("tok"),
      status: opts.accountStatus ?? "connected",
    },
  });
  const post = await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "published", title: "Clip" } });
  const t = await db.postTarget.create({
    data: {
      postId: post.id,
      platform,
      socialAccountId: acct.id,
      platformStatus: opts.status ?? "published",
      platformPostId: "pp-1",
      platformUrl: "https://example.com/p/1",
      practice: !!opts.practice,
      publishedAt: new Date(),
    },
  });
  return { u, post, t, acct };
}
const fail = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { status: number; code?: string; message: string; extra?: Record<string, unknown> };
  }
};

describe("removeFromPlatform", () => {
  test("deletes through the account's publisher and marks the studio copy, keeping it published", async () => {
    const { u, t } = await setup("x");
    await rm.removeFromPlatform(u.id, t.id, "delete");
    const after = await db.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.removeMode).toBe("deleted");
    expect(after.removedAt).toBeTruthy();
    expect(after.platformUrl).toBeNull();
    expect(after.platformStatus).toBe("published"); // stats and history stay true
    const v = services.targetView(after);
    expect(v.canDelete).toBe(false);
    expect(v.removeMode).toBe("deleted");
    // a second click is a no-op, not an error
    expect(await fail(rm.removeFromPlatform(u.id, t.id, "delete"))).toBeNull();
  });

  test("Instagram and TikTok answer NOT_SUPPORTED with the link to open", async () => {
    for (const p of ["instagram", "tiktok"]) {
      const { u, t } = await setup(p);
      const e = await fail(rm.removeFromPlatform(u.id, t.id, "delete"));
      expect(e?.status).toBe(409);
      expect(e?.code).toBe("NOT_SUPPORTED");
      expect(e?.extra?.url).toBe("https://example.com/p/1");
      expect(services.targetView(t).canDelete).toBe(false);
    }
  });

  test("only YouTube can hide; hide then show round-trips", async () => {
    const x = await setup("x");
    expect((await fail(rm.removeFromPlatform(x.u.id, x.t.id, "hide")))?.code).toBe("NOT_SUPPORTED");
    const yt = await setup("youtube");
    expect(services.targetView(yt.t).canHide).toBe(true);
    await rm.removeFromPlatform(yt.u.id, yt.t.id, "hide");
    let row = await db.postTarget.findUniqueOrThrow({ where: { id: yt.t.id } });
    expect(row.removeMode).toBe("hidden");
    expect(row.platformUrl).toBe("https://example.com/p/1"); // still exists for the owner
    await rm.removeFromPlatform(yt.u.id, yt.t.id, "show");
    row = await db.postTarget.findUniqueOrThrow({ where: { id: yt.t.id } });
    expect(row.removeMode).toBeNull();
    expect(row.removedAt).toBeNull();
  });

  test("refuses posts that aren't live, other users' posts, and disconnected accounts", async () => {
    const a = await setup("x", { status: "failed" });
    expect((await fail(rm.removeFromPlatform(a.u.id, a.t.id, "delete")))?.status).toBe(409);
    const b = await setup("x");
    expect((await fail(rm.removeFromPlatform(a.u.id, b.t.id, "delete")))?.status).toBe(404);
    const c = await setup("x", { accountStatus: "needs_reconnect" });
    expect((await fail(rm.removeFromPlatform(c.u.id, c.t.id, "delete")))?.code).toBe("NOT_CONNECTED");
  });

  test("practice posts never call anything", async () => {
    const calls = stubFetch(() => new Response("{}"));
    const { u, t } = await setup("youtube", { practice: true, accountStatus: "disconnected" });
    await rm.removeFromPlatform(u.id, t.id, "delete");
    expect(calls.length).toBe(0);
  });
});

describe("real publishers", () => {
  test("X: 404 counts as already gone; 401 flags reconnect; 403 asks for permission", async () => {
    keys.__setKeys({ x: { clientId: "cid", clientSecret: "sec" } } as never);
    let status = 404;
    const calls = stubFetch(() => new Response("{}", { status }));
    const a = await setup("x", { realAccount: true });
    await rm.removeFromPlatform(a.u.id, a.t.id, "delete");
    expect(calls[0].url).toContain("/tweets/pp-1");
    expect(calls[0].method).toBe("DELETE");
    expect((await db.postTarget.findUniqueOrThrow({ where: { id: a.t.id } })).removeMode).toBe("deleted");

    status = 401;
    const b = await setup("x", { realAccount: true });
    expect((await fail(rm.removeFromPlatform(b.u.id, b.t.id, "delete")))?.code).toBe("AUTH_EXPIRED");
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id: b.acct.id } })).status).toBe("needs_reconnect");
    expect((await db.postTarget.findUniqueOrThrow({ where: { id: b.t.id } })).removeMode).toBeNull();

    status = 403;
    const c = await setup("x", { realAccount: true });
    expect((await fail(rm.removeFromPlatform(c.u.id, c.t.id, "delete")))?.code).toBe("FORBIDDEN");
    keys.__setKeys(undefined);
  });

  test("YouTube private keeps the rest of the status part and drops read-only fields", async () => {
    keys.__setKeys({ youtube: { clientId: "cid", clientSecret: "sec" } } as never);
    const calls = stubFetch((url, init) =>
      (init.method ?? "GET") === "GET"
        ? Response.json({ items: [{ status: { privacyStatus: "public", uploadStatus: "processed", embeddable: true, license: "youtube", publicStatsViewable: true, madeForKids: false, selfDeclaredMadeForKids: false } }] })
        : Response.json({}),
    );
    const { u, t } = await setup("youtube", { realAccount: true });
    await rm.removeFromPlatform(u.id, t.id, "hide");
    const put = calls.find((c) => c.method === "PUT")!;
    const body = JSON.parse(put.body!);
    expect(body).toEqual({ id: "pp-1", status: { embeddable: true, license: "youtube", publicStatsViewable: true, selfDeclaredMadeForKids: false, privacyStatus: "private" } });
    keys.__setKeys(undefined);
  });

  test("Facebook: Graph 'does not exist' (subcode 33) counts as gone", async () => {
    keys.__setKeys({ facebook: { clientId: "fid", clientSecret: "sec" } } as never);
    stubFetch(() => new Response(JSON.stringify({ error: { message: "Unsupported delete request. Object with ID 'pp-1' does not exist", type: "GraphMethodException", code: 100, error_subcode: 33 } }), { status: 400 }));
    const { u, t } = await setup("facebook", { realAccount: true });
    await rm.removeFromPlatform(u.id, t.id, "delete");
    expect((await db.postTarget.findUniqueOrThrow({ where: { id: t.id } })).removeMode).toBe("deleted");
    keys.__setKeys(undefined);
  });
});

describe("refusals that look like success", () => {
  test("X 200 deleted=false and Graph 200 success=false never mark the post deleted", async () => {
    keys.__setKeys({ x: { clientId: "c", clientSecret: "s" }, facebook: { clientId: "f", clientSecret: "s" } } as never);
    stubFetch((url) => (url.includes("api.x.com") ? Response.json({ data: { deleted: false } }) : Response.json({ success: false })));
    for (const p of ["x", "facebook"]) {
      const { u, t } = await setup(p, { realAccount: true });
      expect((await fail(rm.removeFromPlatform(u.id, t.id, "delete")))?.status).toBe(502);
      const row = await db.postTarget.findUniqueOrThrow({ where: { id: t.id } });
      expect(row.removeMode).toBeNull();
      expect(row.platformUrl).toBe("https://example.com/p/1");
    }
    keys.__setKeys(undefined);
  });
});

describe("removeEverywhere", () => {
  test("deletes what the APIs allow, skips Instagram, reports failures", async () => {
    const { u, post } = await setup("x");
    const acct = (await db.socialAccount.findFirstOrThrow({ where: { userId: u.id } })).id;
    await db.postTarget.create({ data: { postId: post.id, platform: "instagram", socialAccountId: acct, platformStatus: "published", platformPostId: "ig-1", publishedAt: new Date() } });
    await db.postTarget.create({ data: { postId: post.id, platform: "youtube", platformStatus: "published", platformPostId: "yt-1", publishedAt: new Date() } }); // no account behind it
    const r = await rm.removeEverywhere(u.id, post.id);
    expect(r.find((x) => x.platform === "x")?.ok).toBe(true);
    expect(r.find((x) => x.platform === "instagram")).toBeUndefined();
    const yt = r.find((x) => x.platform === "youtube")!;
    expect(yt.ok).toBe(false);
    expect(yt.message).toContain("Reconnect YouTube");
  });
});

describe("plumbing", () => {
  test("editors can't take posts down; managers can", async () => {
    const { memberBlock } = await import("../lib/team/roles");
    expect(memberBlock("editor", "POST", "/api/targets/abc/remove")).toContain("Editors can't");
    expect(memberBlock("manager" as never, "POST", "/api/targets/abc/remove")).toBeNull();
  });

  test("Meta Graph 400s map to the right codes", async () => {
    const { httpFailure } = await import("../lib/social/types");
    const r = (code: number) => new Response(JSON.stringify({ error: { message: "x", type: "OAuthException", code } }), { status: 400 });
    expect((await httpFailure(r(190), "t")).code).toBe("AUTH_EXPIRED");
    expect((await httpFailure(r(200), "t")).code).toBe("FORBIDDEN");
    expect((await httpFailure(r(100), "t")).code).toBe("MEDIA_REJECTED");
    expect((await httpFailure(r(1900), "t")).code).toBe("MEDIA_REJECTED");
  });

  test("the Meta App ID pasted as the Instagram app ID is caught", () => {
    keys.__setKeys({ instagram: { clientId: "123", clientSecret: "a" }, facebook: { clientId: "123", clientSecret: "b" } } as never);
    expect(keys.instagramIdLooksLikeMetaAppId()).toBe(true);
    keys.__setKeys({ instagram: { clientId: "999", clientSecret: "a" }, facebook: { clientId: "123", clientSecret: "b" } } as never);
    expect(keys.instagramIdLooksLikeMetaAppId()).toBe(false);
    keys.__setKeys(undefined);
    expect(keys.instagramIdLooksLikeMetaAppId()).toBe(false);
  });
});

describe("dashboards", () => {
  test("Threads shows Outlly's own record instead of calling another platform", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 401 }));
    const { u } = await setup("threads", { realAccount: true });
    const { platformDashboard } = await import("../lib/live");
    const d = await platformDashboard(u.id, "threads", { fresh: true });
    expect(d.status).toBe("ok");
    expect(d.posts.length).toBe(1);
    expect(d.notes[0].text).toContain("connected");
    expect(calls.some((c) => c.url.includes("api.x.com"))).toBe(false);
  });

  test("Facebook reads the Page from graph.facebook.com", async () => {
    keys.__setKeys({ facebook: { clientId: "fid", clientSecret: "sec" } } as never);
    const calls = stubFetch((url) => {
      if (url.includes("/video_insights")) return new Response(JSON.stringify({ error: { code: 10, message: "needs read_insights" } }), { status: 400 });
      if (url.includes("/video_reels"))
        return Response.json({ data: [{ id: "v1", description: "Hello #fb", created_time: new Date().toISOString(), permalink_url: "/reel/v1", likes: { summary: { total_count: 4 } }, comments: { summary: { total_count: 2 } } }] });
      return Response.json({ id: "page1", name: "My Page", followers_count: 120, fan_count: 100, link: "https://facebook.com/mypage" });
    });
    const { u } = await setup("facebook", { realAccount: true });
    const { platformDashboard } = await import("../lib/live");
    const d = await platformDashboard(u.id, "facebook", { fresh: true });
    expect(d.status).toBe("ok");
    expect(calls.every((c) => c.url.startsWith("https://graph.facebook.com/"))).toBe(true);
    expect(d.headline.find((h) => h.key === "followers")?.value).toBe(120);
    expect(d.posts[0].likes).toBe(4);
    expect(d.posts[0].url).toBe("https://www.facebook.com/reel/v1");
    expect(d.notes.some((x) => x.text.includes("Reconnect Facebook"))).toBe(true);
    keys.__setKeys(undefined);
  });

  test("a revoked Facebook token still says reconnect", async () => {
    keys.__setKeys({ facebook: { clientId: "fid", clientSecret: "sec" } } as never);
    stubFetch(() => new Response(JSON.stringify({ error: { code: 190, type: "OAuthException", message: "Session invalid" } }), { status: 400 }));
    const { u } = await setup("facebook", { realAccount: true });
    const { platformDashboard } = await import("../lib/live");
    expect((await platformDashboard(u.id, "facebook", { fresh: true })).status).toBe("needs_reconnect");
    keys.__setKeys(undefined);
  });
});

/**
 * Comments inbox: platform responses are mapped with a fake fetch (no network), practice comments are
 * deterministic and labelled, real accounts never get invented data, and the 60s cache is respected.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { MockPublisher } from "../lib/social/mock";
import { YouTubePublisher } from "../lib/social/youtube";
import { InstagramPublisher } from "../lib/social/instagram";
import { XPublisher } from "../lib/social/x";
import { PublisherError, type AccountContext } from "../lib/social/types";

const account: AccountContext = { id: "a1", platformUserId: "u1", username: "@me", accessToken: "tok", refreshToken: null, tokenExpiresAt: null };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
/** Captures the request and answers with a canned platform body. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

describe("practice (mock) comments", () => {
  test("deterministic for a post, labelled practice, and newest first", async () => {
    const p = new MockPublisher("instagram");
    const a = await p.listComments({ platformPostId: "post-1" }, account);
    const b = await p.listComments({ platformPostId: "post-1" }, account);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.map((c) => c.text)).toEqual(b.map((c) => c.text));
    expect(a.length).toBeGreaterThan(1);
    expect(a.every((c) => c.practice === true)).toBe(true);
    const times = a.map((c) => new Date(c.createdAt).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });

  test("a different post gets a different thread", async () => {
    const p = new MockPublisher("youtube");
    const a = await p.listComments({ platformPostId: "post-a" }, account);
    const b = await p.listComments({ platformPostId: "post-b" }, account);
    expect(a[0].id).not.toBe(b[0].id);
  });

  test("a practice reply is stored and shows up under its comment", async () => {
    const p = new MockPublisher("x");
    const before = await p.listComments({ platformPostId: "post-r" }, account);
    const parent = before[0];
    expect(parent.replies).toEqual([]);
    const reply = await p.replyToComment(account, parent.id, "thank you!");
    expect(reply.practice).toBe(true);
    expect(reply.parentId).toBe(parent.id);
    expect(reply.text).toBe("thank you!");
    const after = await p.listComments({ platformPostId: "post-r" }, account);
    expect(after[0].replies!.map((r) => r.text)).toEqual(["thank you!"]);
  });
});

describe("YouTube comment mapping", () => {
  test("commentThreads.list is read into comments with their replies", async () => {
    const calls = fakeFetch(200, {
      items: [
        {
          snippet: { topLevelComment: { id: "c1", snippet: { textOriginal: "love this", authorDisplayName: "Dana", publishedAt: "2026-10-10T10:00:00Z", likeCount: 4 } } },
          replies: { comments: [{ id: "c1r", snippet: { textOriginal: "thanks!", authorDisplayName: "Maya", publishedAt: "2026-10-10T11:00:00Z", parentId: "c1" } }] },
        },
      ],
    });
    const out = await new YouTubePublisher().listComments({ platformPostId: "vid1" }, account);
    expect(calls[0].url).toContain("commentThreads");
    expect(calls[0].url).toContain("videoId=vid1");
    expect(calls[0].url).toContain("part=snippet%2Creplies");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "c1", text: "love this", authorName: "Dana", likeCount: 4, createdAt: "2026-10-10T10:00:00Z" });
    expect(out[0].replies![0]).toMatchObject({ id: "c1r", text: "thanks!", parentId: "c1" });
  });

  test("replying posts to comments.insert with the parent id", async () => {
    const calls = fakeFetch(200, { id: "new1", snippet: { textOriginal: "cheers", authorDisplayName: "Maya", publishedAt: "2026-10-11T09:00:00Z", parentId: "c1" } });
    const r = await new YouTubePublisher().replyToComment(account, "c1", "cheers");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ snippet: { parentId: "c1", textOriginal: "cheers" } });
    expect(r).toMatchObject({ id: "new1", text: "cheers", parentId: "c1" });
  });

  test("a missing scope comes back as a FORBIDDEN publisher error, not as empty", async () => {
    fakeFetch(403, '{"error":{"message":"Request had insufficient authentication scopes."}}');
    const e = await new YouTubePublisher().listComments({ platformPostId: "vid1" }, account).catch((x) => x as PublisherError);
    expect(e).toBeInstanceOf(PublisherError);
    expect((e as PublisherError).code).toBe("FORBIDDEN");
  });

  test("the OAuth scope list asks for force-ssl so comments can be read and posted", async () => {
    const { url } = await new YouTubePublisher().connect("https://app.test/cb");
    expect(decodeURIComponent(url)).toContain("youtube.force-ssl");
  });
});

describe("Instagram comment mapping", () => {
  test("comments and nested replies are mapped, usernames get an @", async () => {
    const calls = fakeFetch(200, {
      data: [
        {
          id: "ig1",
          text: "where is this?",
          username: "rina",
          timestamp: "2026-10-09T08:00:00+0000",
          like_count: 2,
          replies: { data: [{ id: "ig1r", text: "Goa!", username: "maya.makes", timestamp: "2026-10-09T09:00:00+0000" }] },
        },
      ],
    });
    const out = await new InstagramPublisher().listComments({ platformPostId: "media1" }, account);
    expect(calls[0].url).toContain("/media1/comments");
    expect(decodeURIComponent(calls[0].url)).toContain("replies{");
    expect(out[0]).toMatchObject({ id: "ig1", text: "where is this?", authorName: "@rina", likeCount: 2 });
    expect(out[0].replies![0]).toMatchObject({ id: "ig1r", authorName: "@maya.makes", parentId: "ig1" });
  });

  test("a reply posts to /{comment-id}/replies with message=", async () => {
    const calls = fakeFetch(200, { id: "ig-new" });
    const r = await new InstagramPublisher().replyToComment(account, "ig1", "Goa!");
    expect(calls[0].url).toContain("/ig1/replies");
    expect(String(calls[0].init?.body)).toContain("message=Goa%21");
    expect(r).toMatchObject({ id: "ig-new", text: "Goa!", parentId: "ig1" });
  });

  test("the OAuth scope list asks for comment management", async () => {
    const { url } = await new InstagramPublisher().connect("https://app.test/cb");
    expect(decodeURIComponent(url)).toContain("manage_comments");
  });
});

describe("X comment mapping", () => {
  test("conversation search is mapped, the original post is not a comment of itself", async () => {
    const calls = fakeFetch(200, {
      data: [
        { id: "t1", text: "same", created_at: "2026-10-08T07:00:00.000Z", author_id: "9", public_metrics: { like_count: 1 } },
        { id: "root", text: "the original", created_at: "2026-10-08T06:00:00.000Z", author_id: "1" },
      ],
      includes: { users: [{ id: "9", username: "rina" }] },
    });
    const out = await new XPublisher().listComments({ platformPostId: "root" }, account);
    expect(decodeURIComponent(calls[0].url)).toContain("conversation_id:root");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "t1", authorName: "@rina", parentId: "root", likeCount: 1 });
  });

  test("an unknown author is named honestly instead of guessed", async () => {
    fakeFetch(200, { data: [{ id: "t2", text: "hi", author_id: "404" }], includes: { users: [] } });
    const out = await new XPublisher().listComments({ platformPostId: "root" }, account);
    expect(out[0].authorName).toBe("Someone on X");
  });

  test("the Basic-tier 403 maps to FORBIDDEN, not to a reconnect prompt", async () => {
    fakeFetch(403, '{"title":"Client Forbidden","detail":"This endpoint is not available to your tier"}');
    const e = await new XPublisher().listComments({ platformPostId: "root" }, account).catch((x) => x as PublisherError);
    expect((e as PublisherError).code).toBe("FORBIDDEN");
    expect((e as PublisherError).retryable).toBe(false);
  });

  test("a reply is a tweet with in_reply_to_tweet_id", async () => {
    const calls = fakeFetch(200, { data: { id: "t9" } });
    const r = await new XPublisher().replyToComment(account, "t1", "thanks");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ text: "thanks", reply: { in_reply_to_tweet_id: "t1" } });
    expect(r.id).toBe("t9");
  });
});

describe("inbox service", () => {
  let db: typeof import("../lib/db").db;
  let inboxMod: typeof import("../lib/inbox");
  let encrypt: typeof import("../lib/crypto").encrypt;
  beforeAll(async () => {
    ({ db } = await import("../lib/db"));
    inboxMod = await import("../lib/inbox");
    ({ encrypt } = await import("../lib/crypto"));
  });

  let n = 0;
  async function fixture(opts: { platformUserId?: string; status?: string; published?: boolean; platform?: "instagram" | "youtube" | "x" } = {}) {
    const platform = opts.platform ?? "instagram";
    n++;
    const user = await db.user.create({ data: { name: "Inb", email: `inb${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
    const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `inb/${n}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
    const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, status: "published", title: "Shot in Goa" } });
    const acct = await db.socialAccount.create({
      data: { userId: user.id, platform, platformUserId: opts.platformUserId ?? `mock-${platform}-${n}`, username: "@maya", accessToken: encrypt("tok"), status: opts.status ?? "connected" },
    });
    const target = await db.postTarget.create({
      data: {
        postId: post.id,
        platform,
        socialAccountId: acct.id,
        platformStatus: opts.published === false ? "pending" : "published",
        platformPostId: opts.published === false ? null : `media-${n}`,
        platformUrl: null,
        practice: true,
        publishedAt: new Date(),
      },
    });
    return { user, post, target };
  }

  test("practice comments arrive labelled, newest first, with the post they belong to", async () => {
    const f = await fixture();
    const out = await inboxMod.inbox(f.user.id);
    expect(out.errors).toEqual([]);
    expect(out.comments.length).toBeGreaterThan(0);
    expect(out.comments.every((c) => c.practice === true)).toBe(true);
    expect(out.comments[0].postTitle).toBe("Shot in Goa");
    expect(out.comments[0].targetId).toBe(f.target.id);
  });

  test("a second read inside the cache window does not call the platform again", async () => {
    const f = await fixture();
    await inboxMod.inbox(f.user.id);
    const spy: string[] = [];
    const proto = MockPublisher.prototype.listComments!;
    MockPublisher.prototype.listComments = async function (t, a) {
      spy.push(t.platformPostId);
      return proto.call(this, t, a);
    };
    try {
      await inboxMod.inbox(f.user.id);
      expect(spy).toEqual([]);
      inboxMod.invalidateComments(f.target.id);
      await inboxMod.inbox(f.user.id);
      expect(spy).toHaveLength(1);
    } finally {
      MockPublisher.prototype.listComments = proto;
    }
  });

  test("a disconnected account is reported, never filled in with fake comments", async () => {
    const f = await fixture({ status: "needs_reconnect" });
    const out = await inboxMod.inbox(f.user.id);
    expect(out.comments).toEqual([]);
    expect(out.errors[0]).toMatchObject({ targetId: f.target.id, code: "NOT_CONNECTED" });
  });

  test("a real account with no credentials is an error, not an empty inbox", async () => {
    // YouTube needs its app secret to refresh tokens, so a real account without it can't be read.
    const f = await fixture({ platformUserId: "real-yt-1", platform: "youtube" });
    const out = await inboxMod.inbox(f.user.id);
    expect(out.comments).toEqual([]);
    expect(out.errors[0].code).toBe("NOT_CONNECTED");
    expect(out.errors[0].detail).toMatch(/YOUTUBE_CLIENT_ID/);
  });

  test("a real Instagram account works from its token alone (no app secret needed)", async () => {
    const { publisherForAccount } = await import("../lib/social/registry");
    const { InstagramPublisher } = await import("../lib/social/instagram");
    expect(publisherForAccount("instagram", { platformUserId: "real-ig-1" })).toBeInstanceOf(InstagramPublisher);
    expect(() => publisherForAccount("youtube", { platformUserId: "real-yt-1" })).toThrow(/YOUTUBE_CLIENT_ID/);
  });

  test("unpublished posts are not in the inbox", async () => {
    const f = await fixture({ published: false });
    const out = await inboxMod.inbox(f.user.id);
    expect(out.targets).toBe(0);
    expect(out.comments).toEqual([]);
  });

  test("the platform filter only asks that platform", async () => {
    const f = await fixture();
    expect((await inboxMod.inbox(f.user.id, "instagram")).comments.length).toBeGreaterThan(0);
    expect((await inboxMod.inbox(f.user.id, "x")).comments).toEqual([]);
  });

  test("replying goes through the publisher, is labelled practice, and clears the cache", async () => {
    const f = await fixture();
    const first = await inboxMod.inbox(f.user.id);
    const parent = first.comments[0];
    const reply = await inboxMod.replyToComment(f.user.id, f.target.id, parent.id, "thank you!");
    expect(reply.practice).toBe(true);
    const again = await inboxMod.inbox(f.user.id);
    expect(again.comments.find((c) => c.id === parent.id)!.replies!.map((r) => r.text)).toEqual(["thank you!"]);
  });

  test("you cannot reply through someone else's post", async () => {
    const mine = await fixture();
    const other = await fixture();
    await expect(inboxMod.replyToComment(other.user.id, mine.target.id, "c1", "hi")).rejects.toThrow(/couldn't find/);
  });
});

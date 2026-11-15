/**
 * P2 follow-up: comment lists follow the platform's paging cursor instead of stopping at the first page.
 * Every platform call is faked here; nothing leaves the machine.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { collectPages, COMMENT_PAGES } from "../lib/social/paging";
import { InstagramPublisher } from "../lib/social/instagram";
import { YouTubePublisher } from "../lib/social/youtube";
import { XPublisher } from "../lib/social/x";
import { instagramThreads, youtubeThreads } from "../lib/live/comments";
import type { AccountContext } from "../lib/social/types";

const realFetch = globalThis.fetch;
afterEach(() => void (globalThis.fetch = realFetch));
const acct: AccountContext = { id: "a1", platformUserId: "UC1", username: "me", accessToken: "tok en" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function fake(handler: (url: URL) => Response) {
  const calls: URL[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    calls.push(u);
    return handler(u);
  }) as typeof fetch;
  return calls;
}
const ids = (n: number, from = 0, p = "c") => Array.from({ length: n }, (_, i) => `${p}${from + i}`);

describe("collectPages", () => {
  test("follows the cursor until the platform says there is no next page", async () => {
    const seen: (string | null)[] = [];
    const r = await collectPages(async (c) => {
      seen.push(c);
      return c === null ? { items: [1, 2], next: "b" } : c === "b" ? { items: [3], next: "c" } : { items: [4], next: null };
    }, { maxPages: 10, maxItems: 100 });
    expect(r).toEqual({ items: [1, 2, 3, 4], complete: true });
    expect(seen).toEqual([null, "b", "c"]);
  });
  test("stops at the page cap and the item cap, and says the list is not complete", async () => {
    const pages = await collectPages(async () => ({ items: [1], next: `n${Math.random()}` }), { maxPages: 3, maxItems: 100 });
    expect(pages).toEqual({ items: [1, 1, 1], complete: false });
    const capped = await collectPages(async () => ({ items: [1, 2, 3], next: `n${Math.random()}` }), { maxPages: 10, maxItems: 5 });
    expect(capped).toEqual({ items: [1, 2, 3, 1, 2], complete: false });
  });
  test("a cursor handed back twice ends the loop instead of spinning", async () => {
    let n = 0;
    const r = await collectPages(async () => (n++, { items: [n], next: "same" }), { maxPages: 50, maxItems: 500 });
    expect(n).toBe(2);
    expect(r.items).toEqual([1, 2]);
  });
  test("the first page failing throws; a later page failing keeps what loaded", async () => {
    await expect(collectPages(async () => { throw new Error("401"); }, { maxPages: 3, maxItems: 10 })).rejects.toThrow("401");
    const warn = console.warn;
    console.warn = () => {};
    try {
      const r = await collectPages(async (c) => { if (c) throw new Error("timeout"); return { items: ["a"], next: "x" }; }, { maxPages: 3, maxItems: 10 });
      expect(r).toEqual({ items: ["a"], complete: false });
    } finally {
      console.warn = warn;
    }
  });
  test("caps: X reads the least (paid per read); nothing loads more than 500 for one post", () => {
    expect(COMMENT_PAGES.x.maxItems).toBeLessThan(COMMENT_PAGES.instagram.maxItems);
    for (const c of Object.values(COMMENT_PAGES)) expect(c.maxItems).toBeLessThanOrEqual(500);
  });
});

describe("Instagram post comments", () => {
  test("reads past the first 50 using paging.cursors.after, only while paging.next is there", async () => {
    const calls = fake((u) => {
      const after = u.searchParams.get("after");
      if (!after) return json({ data: ids(50).map((id) => ({ id, text: id })), paging: { cursors: { after: "A1" }, next: "https://graph/next" } });
      // Last page: Graph still sends cursors but no `next`.
      return json({ data: ids(7, 50).map((id) => ({ id, text: id, replies: { data: [{ id: `${id}r`, text: "re" }] } })), paging: { cursors: { after: "A2" } } });
    });
    const out = await new InstagramPublisher().listComments({ platformPostId: "m1" }, acct);
    expect(out).toHaveLength(57);
    expect(calls).toHaveLength(2);
    expect(calls[0].searchParams.get("limit")).toBe("50");
    expect(calls[0].searchParams.get("access_token")).toBe("tok en");
    expect(calls[1].searchParams.get("after")).toBe("A1");
    expect(out[56].replies?.[0]).toMatchObject({ id: "c56r", parentId: "c56" });
  });
});

describe("YouTube video comments", () => {
  test("asks for 100 a page and follows nextPageToken", async () => {
    const thread = (id: string) => ({ snippet: { topLevelComment: { id, snippet: { textOriginal: id } } } });
    const calls = fake((u) => (u.searchParams.get("pageToken") ? json({ items: ids(3, 100).map(thread) }) : json({ items: ids(100).map(thread), nextPageToken: "P2" })));
    const out = await new YouTubePublisher().listComments({ platformPostId: "v1" }, acct);
    expect(out).toHaveLength(103);
    expect(calls.map((c) => c.searchParams.get("maxResults"))).toEqual(["100", "100"]);
    expect(calls[1].searchParams.get("pageToken")).toBe("P2");
  });
});

describe("X replies", () => {
  test("follows meta.next_token, keeps author names from every page, and stops at the X cap", async () => {
    let page = 0;
    const calls = fake(() => {
      page++;
      const data = ids(100, page * 100, "t").map((id) => ({ id, text: id, author_id: `u${page}` }));
      return json({ data, includes: { users: [{ id: `u${page}`, username: `fan${page}` }] }, meta: { next_token: `N${page}` } });
    });
    const out = await new XPublisher().listComments({ platformPostId: "root" }, acct);
    expect(calls).toHaveLength(COMMENT_PAGES.x.maxPages);
    expect(out).toHaveLength(COMMENT_PAGES.x.maxItems);
    expect(calls[0].searchParams.get("max_results")).toBe("100");
    expect(calls[1].searchParams.get("next_token")).toBe("N1");
    expect(out[0].authorName).toBe("@fan1");
    expect(out[250].authorName).toBe("@fan3");
  });
  test("the original tweet is still left out of its own replies", async () => {
    fake(() => json({ data: [{ id: "root", text: "mine" }, { id: "t1", text: "reply" }] }));
    const out = await new XPublisher().listComments({ platformPostId: "root" }, acct);
    expect(out.map((c) => c.id)).toEqual(["t1"]);
  });
});

describe("account-wide inbox sweeps", () => {
  test("Instagram: each post's comments follow the cursor too", async () => {
    const calls = fake((u) => {
      if (u.pathname.endsWith("/me/media")) return json({ data: [{ id: "m1", caption: "Hi", comments_count: 60 }] });
      return u.searchParams.get("after") ? json({ data: ids(10, 50).map((id) => ({ id })) }) : json({ data: ids(50).map((id) => ({ id })), paging: { cursors: { after: "A" }, next: "x" } });
    });
    const [th] = await instagramThreads(acct, new Set());
    expect(th.comments).toHaveLength(60);
    expect(calls.filter((c) => c.pathname.endsWith("/comments"))).toHaveLength(2);
  });
  test("YouTube: the channel sweep follows nextPageToken and groups by video", async () => {
    const t = (id: string, v: string) => ({ snippet: { videoId: v, topLevelComment: { id, snippet: { textOriginal: id } } } });
    fake((u) => {
      if (u.pathname.endsWith("/videos")) return json({ items: [] });
      return u.searchParams.get("pageToken") ? json({ items: [t("c2", "v2")] }) : json({ items: [t("c0", "v1"), t("c1", "v1")], nextPageToken: "P" });
    });
    const th = await youtubeThreads(acct, new Set());
    expect(th.map((x) => [x.mediaId, x.comments.length])).toEqual([["v1", 2], ["v2", 1]]);
  });
});

test("every comment fetch has a timeout, so one slow page cannot hang the inbox", () => {
  for (const f of ["lib/social/instagram.ts", "lib/social/youtube.ts", "lib/social/x.ts", "lib/live/comments.ts"]) {
    const s = readFileSync(f, "utf8");
    expect(s).toContain("collectPages");
    const block = s.slice(s.indexOf("collectPages<"));
    expect(block).toContain("AbortSignal.timeout(12_000)");
  }
});

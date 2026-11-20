/**
 * 1252: Threads joins Inbox > Comments like Instagram. Replies to the creator's posts are read from the
 * post's /conversation (threads_read_replies) and nested one level; a reply from Outlly is a text post with
 * reply_to_id, created then published (threads_manage_replies). Posts made outside Outlly are swept from
 * the profile's newest posts, quiet ones dropped, with the same media preview rules as Instagram.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ThreadsPublisher, nestThreadsReplies } from "../lib/social/threads";
import { threadsThreads } from "../lib/live/comments";
import { threadsMedia } from "../lib/inbox-media";
import { COMMENT_PLATFORMS, commentCapable } from "../lib/inbox-state";
import type { AccountContext } from "../lib/social/types";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const acct = { platformUserId: "me1", accessToken: "tok", username: "@outlly_com" } as AccountContext;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const conversation = [
  { id: "r1", text: "Love this", username: "ana", timestamp: "2026-11-19T10:00:00+0000", replied_to: { id: "p1" }, is_reply: true },
  { id: "r2", text: "Thanks Ana!", username: "outlly_com", timestamp: "2026-11-19T10:05:00+0000", replied_to: { id: "r1" }, is_reply: true },
  { id: "r3", text: "Same here", username: "bo", timestamp: "2026-11-19T10:06:00+0000", replied_to: { id: "r2" }, is_reply: true },
  { id: "r4", text: "Disagree", username: "cy", timestamp: "2026-11-19T11:00:00+0000", replied_to: { id: "p1" }, is_reply: true },
];

describe("1252 nesting", () => {
  test("a reply to the post is a comment; deeper replies sit under the comment they descend from, keeping their real parent", () => {
    const out = nestThreadsReplies("p1", conversation);
    expect(out.map((c) => c.id)).toEqual(["r1", "r4"]);
    expect(out[0].authorName).toBe("@ana");
    expect(out[0].replies!.map((r) => [r.id, r.parentId])).toEqual([["r2", "r1"], ["r3", "r2"]]);
    expect(out[1].replies).toEqual([]);
  });
  test("a reply whose parent is not in the page is shown at the top rather than lost", () => {
    const out = nestThreadsReplies("p1", [{ id: "x", text: "orphan", replied_to: { id: "gone" } }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("x");
    expect(out[0].authorName).toBe("Someone on Threads");
  });
});

describe("1252 publisher", () => {
  test("listComments reads /conversation with the reply fields and follows the cursor", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const u = new URL(String(input instanceof Request ? input.url : input));
      urls.push(u.pathname + u.search);
      if (u.pathname !== "/v1.0/p1/conversation") return json({ error: "nope" }, 404);
      if (!u.searchParams.get("after")) return json({ data: conversation.slice(0, 2), paging: { next: "https://x", cursors: { after: "c2" } } });
      return json({ data: conversation.slice(2) });
    }) as typeof fetch;
    const list = await new ThreadsPublisher().listComments({ platformPostId: "p1" }, acct);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("fields=id,text,username,timestamp,replied_to,is_reply,hide_status");
    expect(urls[0]).toContain("access_token=tok");
    expect(urls[1]).toContain("after=c2");
    expect(list.map((c) => c.id)).toEqual(["r1", "r4"]);
    expect(list[0].replies).toHaveLength(2);
  });
  test("replyToComment creates a TEXT container with reply_to_id and publishes it", async () => {
    const calls: { path: string; body: string }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(input instanceof Request ? input.url : input));
      calls.push({ path: u.pathname, body: String(init?.body ?? "") });
      if (u.pathname === "/v1.0/me1/threads") return json({ id: "c9" });
      // 1258: the container is IN_PROGRESS once, then FINISHED; publishing waits for that.
      if (u.pathname === "/v1.0/c9") return json({ status: calls.filter((c) => c.path === "/v1.0/c9").length > 1 ? "FINISHED" : "IN_PROGRESS" });
      if (u.pathname === "/v1.0/me1/threads_publish") return json({ id: "r9" });
      return json({ error: "nope" }, 404);
    }) as typeof fetch;
    const r = await new ThreadsPublisher().replyToComment(acct, "r1", "Thanks Ana!");
    expect(calls.map((c) => c.path)).toEqual(["/v1.0/me1/threads", "/v1.0/c9", "/v1.0/c9", "/v1.0/me1/threads_publish"]);
    expect(calls[0].body).toContain("media_type=TEXT");
    expect(calls[0].body).toContain("reply_to_id=r1");
    expect(calls[0].body).toContain("text=Thanks+Ana%21");
    expect(calls[3].body).toContain("creation_id=c9");
    expect(r).toMatchObject({ id: "r9", text: "Thanks Ana!", authorName: "@outlly_com", parentId: "r1" });
  });
  test("1258: a reply container that ends in ERROR is a rejection carrying Threads' own words, and nothing is published", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const u = new URL(String(input instanceof Request ? input.url : input));
      calls.push(u.pathname);
      if (u.pathname === "/v1.0/me1/threads") return json({ id: "c9" });
      if (u.pathname === "/v1.0/c9") return json({ status: "ERROR", error_message: "Reply not allowed" });
      return json({ id: "r9" });
    }) as typeof fetch;
    await expect(new ThreadsPublisher().replyToComment(acct, "r1", "Hi")).rejects.toMatchObject({ code: "MEDIA_REJECTED", technical: expect.stringContaining("Reply not allowed") });
    expect(calls).not.toContain("/v1.0/me1/threads_publish");
  });
  test("a refused conversation read is a PublisherError, not a swallowed empty list", async () => {
    globalThis.fetch = (async () => json({ error: { message: "(#10) Application does not have permission for this action", code: 10 } }, 403)) as typeof fetch;
    await expect(new ThreadsPublisher().listComments({ platformPostId: "p1" }, acct)).rejects.toMatchObject({ technical: expect.stringContaining('"code":10') });
  });
});

describe("1252 account sweep", () => {
  test("newest posts not already tracked are asked for their conversation; quiet ones are dropped; media previews follow Instagram's rules", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const u = new URL(String(input instanceof Request ? input.url : input));
      if (u.pathname === "/v1.0/me1/threads")
        return json({
          data: [
            { id: "p1", text: "Why Reels die\nmore", permalink: "https://www.threads.net/@outlly_com/post/A", timestamp: "2026-11-19T09:00:00+0000", media_type: "VIDEO", media_url: "https://cdn/v.mp4", thumbnail_url: "https://cdn/t.jpg" },
            { id: "tracked", text: "Sent from Outlly", media_type: "TEXT_POST" },
            { id: "p2", text: "Hot take", permalink: "https://www.threads.net/@outlly_com/post/B", timestamp: "2026-11-18T09:00:00+0000", media_type: "TEXT_POST" },
            { id: "p3", text: "", media_type: "IMAGE", media_url: "https://cdn/i.jpg" },
          ],
        });
      const m = /^\/v1\.0\/(\w+)\/conversation$/.exec(u.pathname);
      if (m) {
        asked.push(m[1]);
        return json({ data: m[1] === "p1" ? conversation : m[1] === "p3" ? [{ id: "z", text: "nice", username: "dee", replied_to: { id: "p3" } }] : [] });
      }
      return json({ error: "nope" }, 404);
    }) as typeof fetch;
    const out = await threadsThreads(acct, new Set(["tracked"]));
    expect(asked.sort()).toEqual(["p1", "p2", "p3"]);
    expect(out.map((t) => t.mediaId)).toEqual(["p1", "p3"]);
    expect(out[0]).toMatchObject({ title: "Why Reels die", url: "https://www.threads.net/@outlly_com/post/A" });
    expect(out[0].media).toMatchObject({ kind: "video", videoUrl: "https://cdn/v.mp4", thumbnailUrl: "https://cdn/t.jpg", caption: "Why Reels die\nmore", account: "@outlly_com" });
    expect(out[0].comments).toHaveLength(2);
    expect(out[1]).toMatchObject({ title: "Untitled post" });
    expect(out[1].media).toMatchObject({ kind: "image", thumbnailUrl: "https://cdn/i.jpg", videoUrl: null });
  });
  test("a text post has no preview", () => {
    expect(threadsMedia({ media_type: "TEXT_POST", text: "hi" }, "@me")).toBeNull();
  });
});

describe("1252 wiring", () => {
  test("Threads is a comment platform: filter chip, own-account sweep, and the OAuth scopes it needs", () => {
    expect(COMMENT_PLATFORMS).toContain("threads");
    expect(commentCapable("threads")).toBe(true);
    const inbox = src("lib/inbox.ts");
    expect(inbox).toContain("threads: threadsThreads,");
    const scope = /scope: "([^"]+)"/.exec(src("lib/social/threads.ts"))![1].split(",");
    expect(scope).toEqual(["threads_basic", "threads_content_publish", "threads_delete", "threads_manage_insights", "threads_read_replies", "threads_manage_replies"]);
    expect(src("lib/social/platform-setup.ts")).toContain("threads_read_replies, threads_manage_replies");
  });
});

/**
 * 1296: TikTok gets live numbers through the Display API so the app review can show every scope in use.
 * user.info.basic + user.info.stats read the profile with follower, like and video totals; video.list reads the
 * newest videos with view, like, comment and share counts (the dashboard) and one video's counts (per-post
 * insights and the background sync). A refused scope leaves a dash and a reconnect note, never a zero.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { tiktokDashboard } from "../lib/live/tiktok";
import { CAN } from "../lib/insights/post";
import { SYNCABLE } from "../lib/analytics/sync";
import type { AccountContext } from "../lib/social/types";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const acct = { platformUserId: "open-1", username: "@outlly", accessToken: "tok" } as AccountContext;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const user = { open_id: "open-1", display_name: "Outlly", username: "outlly", avatar_url: "https://p16.tiktokcdn.com/a.jpg", follower_count: 1200, likes_count: 5400, video_count: 12, profile_deep_link: "https://www.tiktok.com/@outlly" };
const videos = [
  { id: "v1", title: "Launch day", video_description: "Launch day #outlly #launch", duration: 31, cover_image_url: "https://c/1.jpg", share_url: "https://www.tiktok.com/@outlly/video/v1", create_time: Math.floor(Date.now() / 1000) - 86400, view_count: 1000, like_count: 100, comment_count: 10, share_count: 5 },
  { id: "v2", title: "Behind the scenes", create_time: Math.floor(Date.now() / 1000) - 40 * 86400, view_count: 500, like_count: 50, comment_count: 0, share_count: 2 },
];

describe("1296 TikTok dashboard", () => {
  test("profile, totals and the newest videos come from the Display API", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (url.includes("/v2/user/info/")) return json({ data: { user }, error: { code: "ok" } });
      if (url.includes("/v2/video/list/")) return json({ data: { videos, cursor: 0, has_more: false }, error: { code: "ok" } });
      return json({ error: { code: "unexpected" } }, 404);
    }) as typeof fetch;
    const d = await tiktokDashboard(acct, 28);
    expect(d.status).toBe("ok");
    expect(d.profile).toEqual({ name: "Outlly", handle: "@outlly", avatar: user.avatar_url, url: user.profile_deep_link, bio: null });
    const h = Object.fromEntries(d.headline.map((x) => [x.key, x.value]));
    expect(h.followers).toBe(1200);
    expect(h.likes_total).toBe(5400);
    expect(h.videos).toBe(12);
    expect(h.views).toBe(1500);
    expect(h.likes).toBe(150);
    expect(h.comments).toBe(10);
    expect(h.shares).toBe(7);
    expect(h.recent).toBe(1);
    expect(d.totals).toEqual({ followers: 1200, posts: 12, views: 1500, viewsScope: "recent_posts" });
    expect(d.posts[0]).toMatchObject({ id: "v1", title: "Launch day", thumb: "https://c/1.jpg", url: videos[0].share_url, format: "Videos", duration: 31, views: 1000, likes: 100, comments: 10, shares: 5, hashtags: 2 });
    expect(d.notes).toEqual([]);
    expect(calls[0].url).toContain("/v2/user/info/?fields=");
    expect(calls[0].url).toContain("follower_count");
    expect(calls[1].url).toContain("/v2/video/list/?fields=");
    expect(calls[1].method).toBe("POST");
    expect(JSON.parse(calls[1].body!)).toEqual({ max_count: 20 });
    for (const c of calls) expect(c.url.startsWith("https://open.tiktokapis.com/")).toBe(true);
  });

  test("a refused video.list scope keeps the profile, shows dashes and asks for one reconnect", async () => {
    globalThis.fetch = (async (u: string | URL | Request) => {
      const url = String(u);
      if (url.includes("/v2/user/info/")) return json({ data: { user }, error: { code: "ok" } });
      return json({ data: {}, error: { code: "scope_not_authorized", message: "The user did not authorize the scope required for completing this request." } });
    }) as typeof fetch;
    const d = await tiktokDashboard(acct, 28);
    expect(d.status).toBe("ok");
    expect(d.posts).toEqual([]);
    expect(d.headline.find((x) => x.key === "views")?.value).toBeNull();
    expect(d.notes[0].level).toBe("info");
    expect(d.notes[0].text).toContain("Reconnect TikTok once");
  });

  test("a dead token is AUTH_EXPIRED, so the page says reconnect instead of 'try later'", async () => {
    globalThis.fetch = (async () => json({ data: {}, error: { code: "access_token_invalid", message: "The access token is invalid or not found in the request." } })) as typeof fetch;
    await expect(tiktokDashboard(acct, 28)).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch;
    await expect(tiktokDashboard(acct, 28)).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
  });
});

describe("1296 wiring", () => {
  test("the live dispatcher reads TikTok itself; only LinkedIn still falls back to Outlly's own record", () => {
    const live = src("lib/live/index.ts");
    expect(live).toContain('import { tiktokDashboard } from "./tiktok";');
    expect(live).toContain("tiktokDashboard(ctx, days)");
    expect(live).toContain('if (platform === "linkedin") {');
    expect(live).not.toContain('platform === "linkedin" || platform === "tiktok"');
  });
  test("per-post insights and the background sync include TikTok", () => {
    expect(CAN.tiktok).toEqual(["views", "likes", "comments", "shares", "engagementRate"]);
    expect(SYNCABLE).toContain("tiktok");
    const post = src("lib/insights/post.ts");
    expect(post).toContain('"tiktok"]');
    expect(post).toContain("https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count");
    expect(post).toContain("threads, tiktok }");
  });
  test("the connect asks for exactly the scopes the app review lists, and the admin card says the same", () => {
    expect(src("lib/social/tiktok.ts")).toContain('scope: "user.info.basic,user.info.profile,user.info.stats,video.list,video.publish,video.upload"');
    const setup = src("lib/social/platform-setup.ts");
    expect(setup).toContain('scopes: "user.info.basic, user.info.profile, user.info.stats, video.list, video.upload, video.publish"');
    expect(setup).toContain("Display API");
  });
});

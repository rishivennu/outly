/**
 * 1251: Threads gets live numbers like Instagram and Facebook. The dashboard reads the profile, the window's
 * account insights, followers and the newest posts' insights from graph.threads.net; a refused insights call
 * leaves a dash and a reconnect note, never a zero. The per-post reader joins SUPPORTED so Content, the
 * background sync and Content Intelligence pick Threads up through the same paths as the other platforms.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { threadsDashboard } from "../lib/live/threads";
import { CAN } from "../lib/insights/post";
import { PER_POST_METRICS } from "../lib/intelligence/core";
import { SYNCABLE } from "../lib/analytics/sync";
import type { AccountContext } from "../lib/social/types";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const acct = { platformUserId: "17841400000", accessToken: "tok" } as AccountContext;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refused = () => json({ error: { message: "(#10) Application does not have permission for this action", type: "OAuthException", code: 10 } }, 403);

/** A fake graph.threads.net; `denyInsights` plays an account connected before threads_manage_insights existed. */
function fakeThreads(opts: { denyInsights?: boolean } = {}) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(u.pathname + u.search);
    expect(u.hostname).toBe("graph.threads.net");
    expect(u.searchParams.get("access_token")).toBe("tok");
    if (u.pathname === "/v1.0/17841400000") return json({ id: "17841400000", username: "outlly_com", name: "Outlly", threads_profile_picture_url: "https://cdn/p.jpg", threads_biography: "Plan, publish, learn." });
    if (u.pathname === "/v1.0/17841400000/threads")
      return json({
        data: [
          { id: "m1", media_type: "VIDEO", text: "Why Reels die at 3 seconds\n#hooks #shorts", permalink: "https://www.threads.net/@outlly_com/post/C1", timestamp: new Date(Date.now() - 2 * 864e5).toISOString(), thumbnail_url: "https://cdn/t1.jpg" },
          { id: "m2", media_type: "TEXT_POST", text: "Hot take: captions beat music.", permalink: "https://www.threads.net/@outlly_com/post/C2", timestamp: new Date(Date.now() - 40 * 864e5).toISOString() },
        ],
      });
    if (opts.denyInsights && u.pathname.includes("insights")) return refused();
    if (u.pathname === "/v1.0/17841400000/threads_insights" && u.searchParams.get("metric") === "followers_count") return json({ data: [{ name: "followers_count", period: "day", total_value: { value: 1234 } }] });
    if (u.pathname === "/v1.0/17841400000/threads_insights") {
      expect(Number(u.searchParams.get("since"))).toBeGreaterThanOrEqual(1712991600);
      return json({
        data: [
          { name: "views", period: "day", values: [{ value: 100, end_time: "2026-11-18T07:00:00+0000" }, { value: 150, end_time: "2026-11-19T07:00:00+0000" }] },
          { name: "likes", period: "day", total_value: { value: 40 } },
          { name: "replies", period: "day", total_value: { value: 7 } },
          { name: "reposts", period: "day", total_value: { value: 3 } },
          { name: "quotes", period: "day", total_value: { value: 2 } },
        ],
      });
    }
    if (u.pathname === "/v1.0/m1/insights") return json({ data: [{ name: "views", values: [{ value: 900 }] }, { name: "likes", values: [{ value: 30 }] }, { name: "replies", values: [{ value: 4 }] }, { name: "reposts", values: [{ value: 2 }] }, { name: "quotes", values: [{ value: 1 }] }, { name: "shares", values: [{ value: 5 }] }] });
    if (u.pathname === "/v1.0/m2/insights") return json({ data: [{ name: "views", values: [{ value: 120 }] }, { name: "likes", values: [{ value: 6 }] }, { name: "replies", values: [{ value: 0 }] }] });
    return json({ error: { message: `unexpected ${u.pathname}` } }, 404);
  }) as typeof fetch;
  return calls;
}

describe("1251 Threads dashboard", () => {
  test("profile, window totals, followers, daily views and per-post numbers come from graph.threads.net", async () => {
    const calls = fakeThreads();
    const d = await threadsDashboard(acct, 28);
    expect(d.platform).toBe("threads");
    expect(d.status).toBe("ok");
    expect(d.profile).toEqual({ name: "Outlly", handle: "@outlly_com", avatar: "https://cdn/p.jpg", url: "https://www.threads.net/@outlly_com", bio: "Plan, publish, learn." });
    const h = Object.fromEntries(d.headline.map((x) => [x.key, x.value]));
    expect(h).toEqual({ followers: 1234, views: 250, likes: 40, comments: 7, shares: 5 });
    expect(d.series).toEqual([{ key: "views", label: "Views", points: [{ date: "2026-11-18", value: 100 }, { date: "2026-11-19", value: 150 }] }]);
    expect(d.posts).toHaveLength(2);
    expect(d.posts[0]).toMatchObject({ id: "m1", title: "Why Reels die at 3 seconds", format: "Video", views: 900, likes: 30, comments: 4, shares: 8, hashtags: 2, thumb: "https://cdn/t1.jpg", url: "https://www.threads.net/@outlly_com/post/C1" });
    expect(d.posts[1]).toMatchObject({ id: "m2", format: "Text", views: 120, likes: 6, comments: 0, shares: null, thumb: null });
    expect(d.totals).toEqual({ followers: 1234, posts: null, views: 250, viewsScope: "28_days" });
    expect(d.notes).toEqual([]);
    // followers_count travels alone: Threads refuses it with a date range.
    expect(calls.some((c) => c.includes("metric=followers_count") && !c.includes("since="))).toBe(true);
    expect(calls.some((c) => c.includes("metric=views,likes,replies,reposts,quotes&since="))).toBe(true);
  });

  test("without threads_manage_insights every number is a dash and one note says to reconnect; nothing is zero", async () => {
    fakeThreads({ denyInsights: true });
    const d = await threadsDashboard(acct, 7);
    expect(d.status).toBe("ok");
    expect(d.headline.map((x) => x.value)).toEqual([null, null, null, null, null]);
    expect(d.series).toEqual([]);
    expect(d.posts.map((p) => [p.views, p.likes, p.comments, p.shares])).toEqual([[null, null, null, null], [null, null, null, null]]);
    expect(d.notes).toHaveLength(1);
    expect(d.notes[0].text).toContain("Reconnect Threads once to grant the insights permission");
    expect(d.notes[0].detail).toContain('"code":10');
  });

  test("a failed profile read is thrown so the caller can tell reconnect from try-later", async () => {
    globalThis.fetch = (async () => refused()) as typeof fetch;
    await expect(threadsDashboard(acct)).rejects.toBeDefined();
  });
});

describe("1251 Threads joins the per-post readers", () => {
  test("the dispatcher routes threads to its own reader and only LinkedIn falls back to Outlly's record", () => {
    const live = src("lib/live/index.ts");
    expect(live).toContain('import { threadsDashboard } from "./threads";');
    expect(live).toContain("threadsDashboard(ctx, days)");
    expect(live).toContain('if (platform === "linkedin") {'); // 1296: TikTok has its own reader now
    expect(live).not.toContain('platform === "threads" || platform === "linkedin"');
  });
  test("Content, sync, reconcile and Content Intelligence all know Threads' per-post metrics", () => {
    expect(CAN.threads).toEqual(["views", "likes", "comments", "shares", "engagementRate"]);
    expect(PER_POST_METRICS.threads).toEqual(CAN.threads);
    expect(SYNCABLE).toContain("threads");
    expect(src("lib/posts/reconcile.ts")).toContain('["instagram", "youtube", "facebook", "threads", "tiktok"]');
    const post = src("lib/insights/post.ts");
    expect(post).toContain('const SUPPORTED: Platform[] = ["instagram", "youtube", "facebook", "threads", "tiktok"];');
    expect(post).toContain("metric=views,likes,replies,reposts,quotes,shares");
  });
  test("the OAuth request asks for threads_manage_insights (1252 added the two reply scopes; nothing Outlly does not use)", () => {
    const scope = /scope: "([^"]+)"/.exec(src("lib/social/threads.ts"))![1].split(",");
    expect(scope).toContain("threads_manage_insights");
    expect(scope).not.toContain("threads_keyword_search");
    expect(scope).not.toContain("threads_profile_discovery");
    expect(src("lib/social/platform-setup.ts")).toContain("threads_basic, threads_content_publish, threads_delete, threads_manage_insights");
  });
});

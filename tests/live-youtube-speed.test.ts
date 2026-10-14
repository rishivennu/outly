/**
 * 10-14 perf: the YouTube dashboard sends every independent call at once. With each call taking 100 ms,
 * the old chain (channel -> uploads+analytics -> videos) took ~300 ms; now it is uploads -> videos (~200 ms),
 * because the uploads playlist comes straight from the channel id (UC... -> UU...).
 */
import { afterEach, expect, test } from "bun:test";
import { youtubeDashboard } from "../lib/live/youtube";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const report = { columnHeaders: [{ name: "views" }], rows: [[10]] };

test("youtube calls run in parallel and the uploads playlist is derived from the channel id", async () => {
  const urls: string[] = [];
  const startedAt = new Map<string, number>();
  const t0 = performance.now();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    urls.push(u);
    startedAt.set(u, performance.now() - t0);
    await new Promise((r) => setTimeout(r, 100));
    if (u.includes("/channels?")) return ok({ items: [{ id: "UCabc123", snippet: { title: "Chan" }, statistics: { viewCount: "5", subscriberCount: "2", videoCount: "1" }, contentDetails: { relatedPlaylists: { uploads: "UUabc123" } } }] });
    if (u.includes("/playlistItems?")) return ok({ items: [{ contentDetails: { videoId: "v1" } }] });
    if (u.includes("/videos?")) return ok({ items: [{ id: "v1", snippet: { title: "A video", publishedAt: "2026-10-01T00:00:00Z" }, statistics: { viewCount: "7" }, contentDetails: { duration: "PT40S" } }] });
    return ok(report);
  }) as typeof fetch;

  const d = await youtubeDashboard({ id: "a", platformUserId: "UCabc123", username: "chan", accessToken: "tok", refreshToken: null, tokenExpiresAt: null });

  expect(d.status).toBe("ok");
  expect(d.posts.map((p) => p.id)).toEqual(["v1"]);
  expect(urls.find((u) => u.includes("/playlistItems?"))).toContain("playlistId=UUabc123");
  expect(urls.length).toBe(7);
  // Structure, not wall time: channel, uploads and all four analytics reports leave together,
  // and the video stats leave after one round trip (the old code needed two).
  const at = (part: string) => [...startedAt].filter(([u]) => u.includes(part)).map(([, ms]) => ms);
  for (const ms of [...at("/channels?"), ...at("/playlistItems?"), ...at("youtubeanalytics")]) expect(ms).toBeLessThan(40);
  expect(at("/videos?")[0]).toBeLessThan(190);
});

test("an unknown channel id still works: uploads wait for the channel call", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes("/channels?")) return ok({ items: [{ id: "XYZ", snippet: { title: "Chan" }, statistics: {}, contentDetails: { relatedPlaylists: { uploads: "PLreal" } } }] });
    if (u.includes("/playlistItems?")) {
      expect(u).toContain("playlistId=PLreal");
      return ok({ items: [] });
    }
    return ok(report);
  }) as typeof fetch;
  const d = await youtubeDashboard({ id: "a", platformUserId: "XYZ", username: "chan", accessToken: "tok", refreshToken: null, tokenExpiresAt: null });
  expect(d.status).toBe("ok");
  expect(d.posts).toEqual([]);
});

test("a stale channel id never mixes in another channel's posts", async () => {
  const lists: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes("/channels?")) return ok({ items: [{ id: "UCnew", snippet: { title: "New" }, statistics: {}, contentDetails: { relatedPlaylists: { uploads: "UUnew" } } }] });
    if (u.includes("/playlistItems?")) {
      lists.push(u);
      return ok({ items: [{ contentDetails: { videoId: u.includes("UUnew") ? "new1" : "old1" } }] });
    }
    if (u.includes("/videos?")) return ok({ items: [{ id: u.includes("new1") ? "new1" : "old1", snippet: { title: "v", publishedAt: "2026-10-01T00:00:00Z" }, statistics: {}, contentDetails: { duration: "PT40S" } }] });
    return ok(report);
  }) as typeof fetch;
  const d = await youtubeDashboard({ id: "a", platformUserId: "UCold", username: "chan", accessToken: "tok", refreshToken: null, tokenExpiresAt: null });
  expect(d.posts.map((p) => p.id)).toEqual(["new1"]);
  expect(lists.some((u) => u.includes("UUnew"))).toBe(true);
});

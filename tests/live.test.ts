/**
 * Live dashboards: the suggestion rules only speak with enough data and always cite the numbers,
 * Instagram's Pacific-time hours land in the creator's timezone, YouTube durations parse, and the
 * account-wide comment loaders map platform bodies without inventing anything.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { median, shiftHours, suggest } from "../lib/live/suggest";
import type { LivePost } from "../lib/live/types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const NOW = new Date("2026-10-11T12:00:00Z");
function post(i: number, over: Partial<LivePost> = {}): LivePost {
  return {
    id: `p${i}`,
    title: `Post ${i}`,
    thumb: null,
    url: null,
    publishedAt: new Date(NOW.getTime() - (i + 1) * 3 * 864e5).toISOString(),
    format: "Reels",
    views: 1000,
    likes: 50,
    comments: 2,
    captionLength: 100,
    hashtags: 2,
    ...over,
  };
}

describe("suggest", () => {
  test("stays silent with no posts", () => {
    expect(suggest({ platform: "instagram", posts: [], series: [], timezone: "Asia/Kolkata", now: NOW })).toEqual([]);
  });

  test("flags a long gap since the last post, with the date as evidence", () => {
    const posts = [post(0, { publishedAt: "2026-02-23T13:02:02Z" })];
    const s = suggest({ platform: "instagram", posts, series: [], timezone: "Asia/Kolkata", now: NOW });
    const gap = s.find((x) => x.id === "cadence-gap")!;
    const days = Math.floor((NOW.getTime() - Date.parse("2026-02-23T13:02:02Z")) / 86_400_000);
    expect(gap.title).toContain(`${days} days`);
    expect(gap.evidence).toContain("23 Feb 2026");
    expect(gap.impact).toBe("high");
    expect(gap.source).toBe("rules");
  });

  test("finds a breakout only when it is at least 2x the median", () => {
    const flat = Array.from({ length: 6 }, (_, i) => post(i));
    expect(suggest({ platform: "youtube", posts: flat, series: [], timezone: "UTC", now: NOW }).some((x) => x.id === "breakout")).toBe(false);
    const spiky = [...flat, post(9, { views: 5200, title: "The big one" })];
    const b = suggest({ platform: "youtube", posts: spiky, series: [], timezone: "UTC", now: NOW }).find((x) => x.id === "breakout")!;
    expect(b.body).toContain("The big one");
    expect(b.evidence).toContain("5.2K views");
  });

  test("format advice needs three of each and a real gap", () => {
    const posts = [...Array.from({ length: 3 }, (_, i) => post(i, { format: "Shorts", views: 3000 })), ...Array.from({ length: 3 }, (_, i) => post(i + 3, { format: "Long videos", views: 1000 }))];
    const f = suggest({ platform: "youtube", posts, series: [], timezone: "UTC", now: NOW }).find((x) => x.id === "format")!;
    expect(f.title).toBe("Shorts outperform everything else");
    expect(f.evidence).toContain("3.0×");
    const two = posts.slice(1);
    expect(suggest({ platform: "youtube", posts: two, series: [], timezone: "UTC", now: NOW }).some((x) => x.id === "format")).toBe(false);
  });

  test("retention warning uses watch time over duration", () => {
    const posts = Array.from({ length: 4 }, (_, i) => post(i, { duration: 60, avgWatch: 15 }));
    const r = suggest({ platform: "youtube", posts, series: [], timezone: "UTC", now: NOW }).find((x) => x.id === "retention")!;
    expect(r.evidence).toContain("25%");
  });

  test("online peak names the hour in the creator's timezone", () => {
    const hours = Array.from({ length: 24 }, (_, h) => ({ startMinute: h * 60, label: `${h}h`, value: h === 21 ? 300 : 100 }));
    const s = suggest({ platform: "instagram", posts: [], series: [], hours, timezone: "Asia/Kolkata", now: NOW }).find((x) => x.id === "online-peak")!;
    expect(s.title).toBe("Post around 21h");
  });

  test("momentum needs a real baseline", () => {
    const pts = (a: number, b: number) => [...Array(7).fill(a), ...Array(7).fill(b)].map((value, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, value }));
    const up = suggest({ platform: "instagram", posts: [], series: [{ key: "reach", label: "Reach", points: pts(10, 20) }], timezone: "UTC", now: NOW });
    expect(up.find((x) => x.id === "momentum-up")?.evidence).toContain("+100%");
    const tiny = suggest({ platform: "instagram", posts: [], series: [{ key: "reach", label: "Reach", points: pts(1, 2) }], timezone: "UTC", now: NOW });
    expect(tiny.length).toBe(0);
  });

  test("never returns more than six, high impact first", () => {
    const posts = Array.from({ length: 12 }, (_, i) => post(i, { views: i === 0 ? 9000 : 500 + i * 10, comments: 0, duration: 60, avgWatch: 10, publishedAt: new Date(NOW.getTime() - (40 + i) * 864e5).toISOString() }));
    const s = suggest({ platform: "instagram", posts, series: [], timezone: "UTC", now: NOW });
    expect(s.length).toBeLessThanOrEqual(6);
    expect(s[0].impact).toBe("high");
  });

  test("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("shiftHours", () => {
  test("Pacific to India is +12:30 in October (PDT)", () => {
    const h = shiftHours({ "0": 10, "9": 99 }, "Asia/Kolkata", new Date("2026-10-11T12:00:00Z"));
    expect(h.find((x) => x.value === 10)!.label).toBe("12:30 PM");
    expect(h.find((x) => x.value === 99)!.label).toBe("9:30 PM");
  });
  test("same zone is unchanged and sorted", () => {
    const h = shiftHours({ "13": 2, "1": 1 }, "America/Los_Angeles", new Date("2026-10-11T12:00:00Z"));
    expect(h.map((x) => x.label)).toEqual(["1 AM", "1 PM"]);
  });
});

describe("youtube durations", () => {
  test("parses ISO 8601", async () => {
    const { isoSeconds } = await import("../lib/live/youtube");
    expect(isoSeconds("PT59S")).toBe(59);
    expect(isoSeconds("PT1M3S")).toBe(63);
    expect(isoSeconds("PT1H2M")).toBe(3720);
    expect(isoSeconds(undefined)).toBe(null);
  });
});

describe("account-wide comments", () => {
  const acct = { id: "a1", platformUserId: "UCchan", username: "@me", accessToken: "tok", refreshToken: null, tokenExpiresAt: null };

  test("instagram: only media with comments, skipping ones Outlly tracks", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (u: string) => {
      urls.push(String(u));
      if (String(u).includes("/me/media"))
        return new Response(JSON.stringify({ data: [{ id: "m1", caption: "First\nmore", permalink: "https://ig/p/1", comments_count: 2 }, { id: "m2", comments_count: 0 }, { id: "m3", comments_count: 5 }] }));
      return new Response(JSON.stringify({ data: [{ id: "c1", text: "nice", username: "fan", timestamp: "2026-10-01T00:00:00Z", replies: { data: [{ id: "r1", text: "thanks", username: "me" }] } }] }));
    }) as typeof fetch;
    const { instagramThreads } = await import("../lib/live/comments");
    const t = await instagramThreads(acct, new Set(["m3"]));
    expect(t.length).toBe(1);
    expect(t[0]).toMatchObject({ mediaId: "m1", title: "First", url: "https://ig/p/1" });
    expect(t[0].comments[0]).toMatchObject({ id: "c1", authorName: "@fan" });
    expect(t[0].comments[0].replies![0]).toMatchObject({ id: "r1", parentId: "c1" });
    expect(urls.some((u) => u.includes("/m2/"))).toBe(false);
  });

  test("youtube: one channel call, grouped by video, titled from videos.list", async () => {
    globalThis.fetch = (async (u: string) => {
      if (String(u).includes("commentThreads")) {
        expect(String(u)).toContain("allThreadsRelatedToChannelId=UCchan");
        const c = (id: string, v: string) => ({ snippet: { videoId: v, topLevelComment: { id, snippet: { textOriginal: `hi ${id}`, authorDisplayName: "Viewer", publishedAt: "2026-10-01T00:00:00Z" } } } });
        return new Response(JSON.stringify({ items: [c("c1", "v1"), c("c2", "v1"), c("c3", "v2")] }));
      }
      return new Response(JSON.stringify({ items: [{ id: "v1", snippet: { title: "Video one" } }] }));
    }) as typeof fetch;
    const { youtubeThreads } = await import("../lib/live/comments");
    const t = await youtubeThreads(acct, new Set());
    expect(t.map((x) => [x.mediaId, x.comments.length, x.title])).toEqual([
      ["v1", 2, "Video one"],
      ["v2", 1, "A video on your channel"],
    ]);
  });

  test("a refused request surfaces as an error, never as an empty inbox", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    const { instagramThreads } = await import("../lib/live/comments");
    await expect(instagramThreads(acct, new Set())).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
  });
});

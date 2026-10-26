/**
 * 10-16 UX round, feature 1: bulk scheduling. Pure spreading/copy rules, then the batch booking against
 * the throwaway test database (connections, plan limit, ownership, times, scheduled jobs).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spreadSlots } from "../lib/schedule/spread";
import { bulkTargets, titleFromFilename, tooLongFor } from "../lib/posts/bulk";
import { bulkScheduleSchema } from "../lib/validation";

const TZ = "Asia/Kolkata";
const localHour = (iso: string, tz = TZ) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
const localDay = (iso: string, tz = TZ) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
// Monday 12 Oct 2026, 08:00 IST
const NOW = new Date("2026-10-12T02:30:00Z");

describe("spreadSlots", () => {
  test("one a day at the best hour when there are 7 or more", () => {
    const s = spreadSlots({ count: 7, peakHours: [19, 12], tz: TZ, now: NOW });
    expect(s).toHaveLength(7);
    expect(new Set(s.map((x) => localDay(x))).size).toBe(7);
    expect(s.every((x) => localHour(x) === 19)).toBe(true);
    expect(localDay(s[0])).toBe("2026-10-12");
  });
  test("fewer than 7 are spaced over the week, not bunched at the start", () => {
    const s = spreadSlots({ count: 3, peakHours: [19], tz: TZ, now: NOW });
    expect(s.map((x) => localDay(x))).toEqual(["2026-10-12", "2026-10-14", "2026-10-17"]);
  });
  test("sorted, unique and never in the next 30 minutes", () => {
    const late = new Date("2026-10-12T13:20:00Z"); // 18:50 IST: today's 19:00 is too close
    const s = spreadSlots({ count: 4, peakHours: [19, 12], tz: TZ, now: late });
    expect([...s].sort()).toEqual(s);
    expect(new Set(s).size).toBe(4);
    expect(s.every((x) => +new Date(x) - +late >= 30 * 60_000)).toBe(true);
    expect(localDay(s[0])).toBe("2026-10-13");
  });
  test("steps around what is already booked", () => {
    const taken = ["2026-10-12T13:30:00Z"]; // 19:00 IST today
    const s = spreadSlots({ count: 1, peakHours: [19, 12], tz: TZ, now: NOW, taken });
    expect(localDay(s[0])).toBe("2026-10-12");
    expect(localHour(s[0])).toBe(12);
  });
  test("doubles up on a day only when the horizon runs out", () => {
    const s = spreadSlots({ count: 10, peakHours: [19, 12], tz: TZ, now: NOW, horizonDays: 7 });
    expect(s).toHaveLength(10);
    const perDay = new Map<string, number>();
    for (const x of s) perDay.set(localDay(x), (perDay.get(localDay(x)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBe(2);
    expect(perDay.size).toBe(7);
  });
  test("no peak hours falls back to sensible ones; zero asks for nothing", () => {
    expect(spreadSlots({ count: 2, peakHours: [], tz: TZ, now: NOW })).toHaveLength(2);
    expect(spreadSlots({ count: 0, peakHours: [19], tz: TZ, now: NOW })).toEqual([]);
  });
  test("hour is local in another zone too (DST-safe)", () => {
    const s = spreadSlots({ count: 3, peakHours: [9], tz: "America/New_York", now: new Date("2026-10-30T12:00:00Z") });
    expect(s.every((x) => localHour(x, "America/New_York") === 9)).toBe(true);
  });
});

describe("bulkTargets", () => {
  const item = { title: "Sunset run", caption: "Golden hour on the ridge.", hashtags: "#run #sunset" };
  test("YouTube gets a title and the caption as its description", () => {
    const [yt] = bulkTargets(item, ["youtube"]);
    expect(yt).toMatchObject({ platform: "youtube", title: "Sunset run", caption: null, description: "Golden hour on the ridge.", hashtags: "#run #sunset" });
  });
  test("Instagram gets caption + hashtags, no title", () => {
    const [ig] = bulkTargets(item, ["instagram"]);
    expect(ig).toMatchObject({ title: null, caption: "Golden hour on the ridge.", hashtags: "#run #sunset" });
  });
  test("X stays within 280 and folds hashtags in only when they fit", () => {
    const [x] = bulkTargets(item, ["x"]);
    expect(x.caption).toBe("Golden hour on the ridge. #run #sunset");
    expect(x.hashtags).toBeNull();
    const [long] = bulkTargets({ ...item, caption: "a".repeat(400) }, ["x"]);
    expect(long.caption!.length).toBe(280);
    expect(long.caption!.endsWith("…")).toBe(true);
    const [bare] = bulkTargets({ title: "Only a title" }, ["x"]);
    expect(bare.caption).toBe("Only a title");
  });
  test("empty copy saves as nulls, not empty strings", () => {
    const [ig] = bulkTargets({}, ["instagram"]);
    expect(ig).toMatchObject({ caption: null, hashtags: null, title: null });
  });
  test("titleFromFilename reads like a title", () => {
    expect(titleFromFilename("my_trip-day 2.mp4")).toBe("My trip day 2");
    expect(titleFromFilename(".mov")).toBe("Untitled");
  });
  test("tooLongFor flags only the platforms the clip is too long for", () => {
    expect(tooLongFor(120, ["instagram", "youtube", "x", "facebook"])).toEqual(["facebook"]);
    expect(tooLongFor(200, ["youtube"])).toEqual(["youtube"]);
    expect(tooLongFor(null, ["youtube"])).toEqual([]);
  });
});

describe("bulkScheduleSchema", () => {
  const id = "c" + "a".repeat(24);
  const at = new Date(Date.now() + 3600e3).toISOString();
  test("caps a batch at 10 and refuses the same video twice", () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ mediaId: `c${String(i).padStart(24, "0")}`, scheduledAt: at }));
    expect(bulkScheduleSchema.safeParse({ platforms: ["x"], items }).success).toBe(false);
    expect(bulkScheduleSchema.safeParse({ platforms: ["x"], items: [{ mediaId: id, scheduledAt: at }, { mediaId: id, scheduledAt: at }] }).success).toBe(false);
    expect(bulkScheduleSchema.safeParse({ platforms: [], items: [{ mediaId: id, scheduledAt: at }] }).success).toBe(false);
    expect(bulkScheduleSchema.safeParse({ platforms: ["x"], items: [{ mediaId: id, scheduledAt: at }] }).success).toBe(true);
  });
});

/* ---------------- against the test database ---------------- */

let db: typeof import("../lib/db").db;
let bulk: typeof import("../lib/posts/bulk-server");
let encrypt: typeof import("../lib/crypto").encrypt;
type Job = { name: string; data: unknown; opts?: { jobId?: string; delayMs?: number } };
const g = globalThis as unknown as { __queueBackend?: unknown };
let jobs: Job[] = [];
let previousBackend: unknown;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  bulk = await import("../lib/posts/bulk-server");
  ({ encrypt } = await import("../lib/crypto"));
  previousBackend = g.__queueBackend;
  g.__queueBackend = { add: async (name: string, data: unknown, opts?: Job["opts"]) => void jobs.push({ name, data, opts }) };
}, 60_000);
afterAll(() => {
  g.__queueBackend = previousBackend;
});

let n = 0;
async function creator(platforms: string[] = ["instagram", "youtube"]) {
  const u = await db.user.create({ data: { name: "Bulk", email: `bulk-${++n}-${Date.now()}@test.dev`, passwordHash: "x", timezone: TZ } });
  for (const p of platforms)
    await db.socialAccount.create({ data: { userId: u.id, platform: p, platformUserId: `${p}-${u.id}`, username: "me", accessToken: encrypt("tok"), status: "connected" } });
  const media = await Promise.all(
    [1, 2, 3].map((i) => db.media.create({ data: { userId: u.id, originalFilename: `c${i}.mp4`, storageKey: `bulk/${u.id}-${i}.mp4`, mimeType: "video/mp4", size: 1000, duration: 20, status: "ready" } })),
  );
  return { u, media };
}
const inHours = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();

describe("bookBatch", () => {
  test("creates and schedules every post, one job each, copy shaped per platform", async () => {
    jobs = [];
    const { u, media } = await creator();
    const r = await bulk.bookBatch(u.id, {
      platforms: ["instagram", "youtube"],
      items: media.map((m, i) => ({ mediaId: m.id, title: `Clip ${i + 1}`, caption: "Hello there", hashtags: "#a", scheduledAt: inHours(2 + i * 24) })),
    });
    expect(r.failed).toEqual([]);
    expect(r.posts).toHaveLength(3);
    expect(r.posts.every((p) => p.status === "scheduled" && p.targets.length === 2)).toBe(true);
    const yt = r.posts[0].targets.find((t) => t.platform === "youtube")!;
    expect(yt).toMatchObject({ title: "Clip 1", description: "Hello there", status: "pending" });
    const sched = jobs.filter((j) => j.name === "SCHEDULED_POST");
    expect(sched).toHaveLength(3);
    expect(sched.every((j) => (j.opts?.delayMs ?? 0) > 3600e3)).toBe(true);
  });

  test("refuses a platform that isn't connected, before creating anything", async () => {
    const { u, media } = await creator(["instagram"]);
    await expect(bulk.bookBatch(u.id, { platforms: ["instagram", "x"], items: [{ mediaId: media[0].id, scheduledAt: inHours(3) }] })).rejects.toThrow(/X needs you to connect/);
    expect(await db.post.count({ where: { userId: u.id } })).toBe(0);
  });

  test("refuses a time in the past and someone else's video", async () => {
    const { u, media } = await creator();
    const other = await creator();
    await expect(bulk.bookBatch(u.id, { platforms: ["instagram"], items: [{ mediaId: media[0].id, scheduledAt: new Date(Date.now() - 1000).toISOString() }] })).rejects.toThrow(/Video 1: pick a time/);
    await expect(bulk.bookBatch(u.id, { platforms: ["instagram"], items: [{ mediaId: other.media[0].id, scheduledAt: inHours(3) }] })).rejects.toThrow(/couldn't find that video/);
    expect(await db.post.count({ where: { userId: u.id } })).toBe(0);
  });

  test("a batch bigger than what's left on the plan is refused whole", async () => {
    const { u, media } = await creator();
    await bulk.planBatch(u.id, ["instagram"], 1, TZ); // makes sure the plans exist
    const free = await db.plan.findUniqueOrThrow({ where: { slug: "free" } });
    await db.plan.update({ where: { slug: "free" }, data: { postLimit: 2, postPeriod: "month" } }); // 10-26: Free is weekly now; this pins the monthly wording
    try {
      await expect(bulk.bookBatch(u.id, { platforms: ["instagram"], items: media.map((m, i) => ({ mediaId: m.id, scheduledAt: inHours(3 + i) })) })).rejects.toThrow(/2 posts left this month/);
      expect(await db.post.count({ where: { userId: u.id } })).toBe(0);
      const plan = await bulk.planBatch(u.id, ["instagram"], 3, TZ);
      expect(plan.left).toBe(2);
    } finally {
      await db.plan.update({ where: { slug: "free" }, data: { postLimit: free.postLimit, postPeriod: free.postPeriod } });
    }
  });

  test("planBatch suggests count slots clear of what's booked", async () => {
    const { u, media } = await creator();
    const booked = await db.post.create({ data: { userId: u.id, mediaId: media[0].id, status: "scheduled", scheduledAt: new Date(Date.now() + 5 * 3600e3) } });
    const p = await bulk.planBatch(u.id, ["instagram"], 5, TZ);
    expect(p.slots).toHaveLength(5);
    expect(p.source).toBe("typical");
    expect(p.slots.every((s) => Math.abs(+new Date(s) - +booked.scheduledAt!) >= 2 * 3600e3)).toBe(true);
    expect((await bulk.planBatch(u.id, ["instagram"], 99, TZ)).slots).toHaveLength(10);
  });
});

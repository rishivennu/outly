/**
 * 10-16 UX round, feature 3: the Monday "Last week" card on Home. Window and wording are pure;
 * the query runs against the throwaway database.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { recapCopy, recapVisible, recapWindow } from "../lib/reports/weekly-core";

const TZ = "Asia/Kolkata";
const MON = new Date("2026-10-19T04:30:00Z"); // Monday 10:00 IST
const TUE_LATE = new Date("2026-10-20T18:00:00Z"); // Tuesday 23:30 IST
const WED = new Date("2026-10-20T18:31:00Z"); // Wednesday 00:01 IST

describe("window", () => {
  test("shows Monday and Tuesday in the creator's own zone, not Wednesday", () => {
    expect(recapVisible(MON, TZ)).toBe(true);
    expect(recapVisible(TUE_LATE, TZ)).toBe(true);
    expect(recapVisible(WED, TZ)).toBe(false);
    // Sunday 23:00 in New York is already Monday in India
    const sunNY = new Date("2026-10-19T03:00:00Z");
    expect(recapVisible(sunNY, "America/New_York")).toBe(false);
    expect(recapVisible(sunNY, TZ)).toBe(true);
  });
  test("last week is the full local Monday to Sunday before this one", () => {
    const w = recapWindow(MON, TZ);
    expect(w.since.toISOString()).toBe("2026-10-11T18:30:00.000Z"); // Mon 12 Oct 00:00 IST
    expect(w.until.toISOString()).toBe("2026-10-18T18:30:00.000Z"); // Mon 19 Oct 00:00 IST
    expect(w.key).toBe("2026-10-12");
    expect(w.label).toBe("Oct 12 to Oct 18");
  });
});

describe("wording", () => {
  test("posts compared with the week before, views only 'so far'", () => {
    const c = recapCopy({ published: 3, views: 12400, upcoming: 1 }, 1, 3);
    expect(c.headline).toBe("3 posts out, 12.4K views so far.");
    expect(c.versus).toBe("Up from 1 the week before.");
    expect(c.goal).toBe("You hit your goal of 3 a week.");
    expect(c.cta).toEqual({ label: "Plan 2 more for this week", href: "/create/bulk" });
  });
  test("a quiet week says so plainly, and points at planning", () => {
    const c = recapCopy({ published: 0, views: 0, upcoming: 0 }, 2, 3);
    expect(c.headline).toBe("Nothing went out last week.");
    expect(c.versus).toBe("Down from 2 the week before.");
    expect(c.goal).toBe("0 of your 3 a week.");
    expect(c.cta.href).toBe("/create/bulk");
  });
  test("no numbers yet, steady week, and a full week ahead", () => {
    const c = recapCopy({ published: 1, views: 0, upcoming: 4 }, 1, 3);
    expect(c.headline).toBe("1 post out last week.");
    expect(c.versus).toBe("Same as the week before.");
    expect(c.goal).toBe("1 of your 3 a week.");
    expect(c.cta).toEqual({ label: "See this week", href: "/calendar" });
    expect(recapCopy({ published: 0, views: 0, upcoming: 0 }, 0, 3).versus).toBeNull();
    expect(recapCopy({ published: 2, views: 5, upcoming: 2 }, 0, 3).cta.label).toBe("Plan one more for this week");
  });
});

let db: typeof import("../lib/db").db;
let weekly: typeof import("../lib/reports/weekly");
beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  weekly = await import("../lib/reports/weekly");
}, 60_000);

let n = 0;
async function creator() {
  const u = await db.user.create({ data: { name: "Recap", email: `recap-${++n}-${Date.now()}@test.dev`, passwordHash: "x", timezone: TZ } });
  const media = await db.media.create({ data: { userId: u.id, originalFilename: "a.mp4", storageKey: `recap/${u.id}.mp4`, mimeType: "video/mp4", size: 1, status: "ready" } });
  const post = async (when: string, platforms: [string, number][], opts: { practice?: boolean; title?: string } = {}) => {
    const p = await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "published", title: opts.title ?? "A post", publishedAt: new Date(when) } });
    for (const [platform, views] of platforms) {
      const t = await db.postTarget.create({ data: { postId: p.id, platform, platformStatus: "published", publishedAt: new Date(when), practice: !!opts.practice } });
      await db.targetMetric.create({ data: { targetId: t.id, views, likes: 1, comments: 0 } });
    }
    return p;
  };
  return { u, media, post };
}
const recapFor = (u: { id: string }, now = MON) => weekly.lastWeekRecap({ id: u.id, timezone: TZ, postingGoal: 3, weeklyReport: true }, now);

describe("lastWeekRecap", () => {
  test("counts posts once each, sums views per platform, finds the best", async () => {
    const { u, media, post } = await creator();
    await post("2026-10-13T12:00:00Z", [["instagram", 900], ["youtube", 300]], { title: "Beach" });
    await post("2026-10-16T12:00:00Z", [["instagram", 4000]], { title: "City" });
    await post("2026-10-07T12:00:00Z", [["x", 50]]); // the week before
    await post("2026-10-14T12:00:00Z", [["instagram", 99999]], { practice: true }); // practice never counts
    await post("2026-10-19T02:00:00Z", [["instagram", 7]]); // this week already
    await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "scheduled", scheduledAt: new Date("2026-10-21T12:00:00Z") } });
    await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "scheduled", scheduledAt: new Date("2026-10-28T12:00:00Z") } }); // next week, not counted
    const r = (await recapFor(u))!;
    expect(r.key).toBe("2026-10-12");
    expect(r.stats.published).toBe(2);
    expect(r.stats.views).toBe(5200);
    expect(r.stats.byPlatform).toEqual([{ platform: "instagram", posts: 2, views: 4900 }, { platform: "youtube", posts: 1, views: 300 }]);
    expect(r.stats.top).toEqual({ title: "City", platform: "instagram", views: 4000 });
    expect(r.stats.upcoming).toBe(1);
    expect(r.copy.headline).toBe("2 posts out, 5,200 views so far.");
    expect(r.copy.versus).toBe("Up from 1 the week before.");
    expect(r.copy.cta.label).toBe("Plan 2 more for this week");
  });
  test("nothing for someone who never posted, or on a Wednesday", async () => {
    const { u, post } = await creator();
    expect(await recapFor(u)).toBeNull();
    await post("2026-10-13T12:00:00Z", [["instagram", 10]]);
    expect(await recapFor(u, WED)).toBeNull();
    expect(await recapFor(u)).not.toBeNull();
  });
  test("a quiet week after an active one still shows, and says so", async () => {
    const { u, post } = await creator();
    await post("2026-10-06T12:00:00Z", [["instagram", 10]]);
    const r = (await recapFor(u))!;
    expect(r.copy.headline).toBe("Nothing went out last week.");
    expect(r.stats.byPlatform).toEqual([]);
  });
  test("the Monday email still gets display names", async () => {
    const { u, post } = await creator();
    await post(new Date(Date.now() - 864e5).toISOString(), [["youtube", 5]]);
    const s = await weekly.weeklyStats(u.id);
    expect(s.byPlatform[0].platform).toBe("YouTube");
  });
});

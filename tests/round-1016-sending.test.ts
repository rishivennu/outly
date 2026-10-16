/** Phase 1 (10-16g): the sending pill's one-line summary and the honest send-time hint. */
import { describe, expect, test } from "bun:test";
import { MIN_SAMPLES, addSample, listNames, median, sendSummary, typicalLabel } from "../lib/client/sending";

describe("listNames", () => {
  test("joins platform names the way people say them", () => {
    expect(listNames([])).toBe("");
    expect(listNames(["youtube"])).toBe("YouTube");
    expect(listNames(["youtube", "x"])).toBe("YouTube and X");
    expect(listNames(["instagram", "youtube", "x"])).toBe("Instagram, YouTube and X");
  });
  test("unknown platforms pass through instead of crashing", () => {
    expect(listNames(["myspace"])).toBe("myspace");
  });
});

describe("sendSummary", () => {
  test("still sending: counts what is live so far", () => {
    const s = sendSummary([{ platform: "youtube", status: "published" }, { platform: "x", status: "uploading" }]);
    expect(s).toEqual({ active: true, tone: "work", text: "1 of 2 live" });
  });
  test("still sending with a failure names who needs a hand", () => {
    const s = sendSummary([{ platform: "x", status: "failed" }, { platform: "youtube", status: "queued" }]);
    expect(s.tone).toBe("bad");
    expect(s.text).toBe("0 of 2 live, X needs a hand");
  });
  test("all live", () => {
    expect(sendSummary([{ platform: "youtube", status: "published" }, { platform: "x", status: "published" }])).toEqual({ active: false, tone: "live", text: "Live on YouTube and X" });
  });
  test("some live, some failed", () => {
    const s = sendSummary([{ platform: "youtube", status: "published" }, { platform: "x", status: "failed" }, { platform: "facebook", status: "failed" }]);
    expect(s).toEqual({ active: false, tone: "bad", text: "Live on YouTube. X and Facebook need a hand" });
  });
  test("everything stopped by the creator reads as a stop, not an error", () => {
    expect(sendSummary([{ platform: "x", status: "failed", errorCode: "CANCELED" }]).text).toBe("Stopped. Nothing went out");
    expect(sendSummary([{ platform: "x", status: "failed", errorCode: "CANCELED" }, { platform: "youtube", status: "failed", errorCode: "RATE_LIMIT" }]).text).toBe("Nothing went out yet");
  });
  test("copy never uses em-dashes", () => {
    const all = [
      sendSummary([{ platform: "x", status: "failed" }, { platform: "youtube", status: "processing" }]),
      sendSummary([{ platform: "x", status: "published" }, { platform: "youtube", status: "failed" }]),
    ];
    for (const s of all) expect(s.text).not.toContain("\u2014");
  });
});

describe("send-time hint", () => {
  test("median of odd and even lists, null when empty", () => {
    expect(median([])).toBeNull();
    expect(median([30, 10, 20])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
  });
  test("addSample keeps the newest 7, rounds, and ignores junk", () => {
    let all: Record<string, number[]> = {};
    for (let i = 1; i <= 9; i++) all = addSample(all, "x", i + 0.4);
    expect(all.x).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(addSample(all, "x", -1)).toBe(all);
    expect(addSample(all, "x", Number.NaN)).toBe(all);
    expect(addSample(all, "x", 7 * 3600)).toBe(all);
  });
  test("addSample does not mutate the input", () => {
    const all = { x: [10] };
    addSample(all, "x", 20);
    expect(all.x).toEqual([10]);
  });
  test("no hint until there are enough real sends", () => {
    expect(typicalLabel(undefined)).toBeNull();
    expect(typicalLabel(Array(MIN_SAMPLES - 1).fill(120))).toBeNull();
    expect(typicalLabel([120, 120, 120])).toBe("about 2 min");
  });
  test("short, minute and hour labels", () => {
    expect(typicalLabel([20, 30, 40])).toBe("under a minute");
    expect(typicalLabel([60, 90, 600])).toBe("about 2 min");
    expect(typicalLabel([4000, 4000, 9000])).toBe("about 1 h");
  });
});

describe("post live notice (db)", () => {
  test("one in-app notice per post, naming where it went live and who still needs a hand", async () => {
    const { db } = await import("../lib/db");
    const { noticePostLive } = await import("../lib/retention/notices");
    const u = await db.user.create({ data: { name: "Live Tester", email: `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.dev`, passwordHash: "x" } });
    const m = await db.media.create({ data: { userId: u.id, originalFilename: "a.mp4", storageKey: `live/${u.id}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
    const post = await db.post.create({ data: { userId: u.id, mediaId: m.id, title: "Morning run", status: "partial" } });
    await db.postTarget.create({ data: { postId: post.id, platform: "youtube", platformStatus: "published" } });
    await db.postTarget.create({ data: { postId: post.id, platform: "x", platformStatus: "failed" } });
    await noticePostLive(post.id);
    await noticePostLive(post.id);
    const ns = await db.notice.findMany({ where: { userId: u.id } });
    expect(ns.length).toBe(1);
    expect(ns[0]).toMatchObject({ kind: "post_live", tone: "info", title: '"Morning run" is live on YouTube', href: `/create?post=${post.id}` });
    expect(ns[0].body).toContain("X still needs a hand");
  });
  test("nothing live, or practice only: no notice", async () => {
    const { db } = await import("../lib/db");
    const { noticePostLive } = await import("../lib/retention/notices");
    const u = await db.user.create({ data: { name: "Quiet Tester", email: `quiet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.dev`, passwordHash: "x" } });
    const m = await db.media.create({ data: { userId: u.id, originalFilename: "a.mp4", storageKey: `quiet/${u.id}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
    const a = await db.post.create({ data: { userId: u.id, mediaId: m.id, title: "Fail", status: "failed" } });
    await db.postTarget.create({ data: { postId: a.id, platform: "x", platformStatus: "failed" } });
    const b = await db.post.create({ data: { userId: u.id, mediaId: m.id, title: "Practice", status: "published" } });
    await db.postTarget.create({ data: { postId: b.id, platform: "x", platformStatus: "published", practice: true } });
    await noticePostLive(a.id);
    await noticePostLive(b.id);
    expect(await db.notice.count({ where: { userId: u.id } })).toBe(0);
  });
});

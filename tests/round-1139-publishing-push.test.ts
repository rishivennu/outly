/**
 * 1139: the publishing tracker's lock-screen notifications (lib/retention/publishing-push.ts).
 * One per post, driven by the real job events from syncPost: started, live, failed or needs action. Each stage
 * has its own key, so calling it on every target change can never buzz twice, and the failure keys are the ones
 * noticeFailedTarget uses, so there is one notice per destination with the link to the post's own recovery
 * screen instead of the general failed list.
 */
import { describe, expect, test } from "bun:test";
import { db } from "../lib/db";
import { encrypt } from "../lib/crypto";
import { NEEDS_ACTION, failureCopy, names, publishingActions, publishingPush, pushTag } from "../lib/retention/publishing-push";
import { actionsOf } from "../lib/push/webpush";

let n = 0;
async function fixture(status = "publishing") {
  const s = `${Date.now()}-${n++}`;
  const user = await db.user.create({ data: { name: "Track", email: `track-${s}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `track/${s}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
  const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, title: "Morning run", status } });
  const account = async (platform: string, id: string) =>
    db.socialAccount.create({ data: { userId: user.id, platform, platformUserId: id, username: `@${platform}`, displayName: platform, accessToken: encrypt("t"), status: "connected" } });
  const ig = await account("instagram", `ig-real-${s}`);
  const yt = await account("youtube", `yt-real-${s}`);
  const target = (platform: string, accountId: string, platformStatus: string) => db.postTarget.create({ data: { postId: post.id, platform, socialAccountId: accountId, platformStatus } });
  return { user, post, ig, yt, target };
}
const notices = (userId: string) => db.notice.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

describe("pure parts", () => {
  test("one device tag per post, so each update replaces the last notification", () => {
    expect(pushTag("abc")).toBe("post:abc");
  });
  test("platform names read the way people say them", () => {
    expect(names([{ platform: "instagram" }])).toBe("Instagram");
    expect(names([{ platform: "instagram" }, { platform: "youtube" }])).toBe("Instagram and YouTube");
    expect(names([{ platform: "instagram" }, { platform: "youtube" }, { platform: "x" }])).toBe("Instagram, YouTube and X");
  });
  test("every failure says the one thing that fixes it, with no emoji and no em dashes", () => {
    const codes = [...NEEDS_ACTION, "RATE_LIMITED", "NETWORK", "PLATFORM_DOWN", "UNKNOWN", null];
    for (const c of codes) {
      const copy = failureCopy("instagram", c);
      expect(copy.body.length).toBeGreaterThan(10);
      expect(copy.action.length).toBeGreaterThan(3);
      for (const w of [copy.body, copy.action]) {
        expect(w).not.toContain("\u2014");
        expect(w).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      }
    }
    expect(failureCopy("instagram", "AUTH_EXPIRED").action).toBe("Reconnect Instagram");
  });
  test("the buttons survive what the push layer will accept, unchanged", () => {
    const href = "/create?post=p1";
    const sets = [
      publishingActions("started", href),
      publishingActions("live", href),
      publishingActions("failed", href, { platform: "instagram", errorCode: "AUTH_EXPIRED" }),
      publishingActions("failed", href, { platform: "youtube", errorCode: "MEDIA_REJECTED" }),
      publishingActions("failed", href, { platform: "x", errorCode: null }),
    ];
    for (const set of sets) {
      expect(set.length).toBeGreaterThan(0);
      expect(set.length).toBeLessThanOrEqual(2);
      for (const a of set) {
        expect(a.action).toMatch(/^[\w-]{1,24}$/);
        expect(a.title.length).toBeLessThanOrEqual(24);
        expect(a.href.startsWith("/")).toBe(true);
      }
      // Nothing is trimmed or dropped on the way to the device: these are the names webpush reads.
      expect(actionsOf(set)).toEqual(set);
    }
  });
  test("a sign-out offers the fix as its own button, pointing at the accounts page", () => {
    const set = publishingActions("failed", "/create?post=p1", { platform: "instagram", errorCode: "NOT_CONNECTED" });
    expect(set.map((a) => a.action)).toEqual(["open", "reconnect"]);
    expect(set[1]).toMatchObject({ title: "Reconnect Instagram", href: "/accounts" });
  });
});

describe("started", () => {
  test("the first destination uploading earns one notice, however often the hook runs", async () => {
    const f = await fixture();
    await f.target("instagram", f.ig.id, "uploading");
    await f.target("youtube", f.yt.id, "queued");
    expect(await publishingPush(f.post.id)).toEqual(["started"]);
    expect(await publishingPush(f.post.id)).toEqual([]);
    const ns = await notices(f.user.id);
    expect(ns.length).toBe(1);
    expect(ns[0]).toMatchObject({ kind: "post_live", key: `pubstart:${f.post.id}`, href: `/create?post=${f.post.id}` });
    expect(ns[0].title).toBe('Sending "Morning run"');
    expect(ns[0].body).toContain("Uploading to Instagram");
  });
  test("nothing has started yet: no notice at all", async () => {
    const f = await fixture();
    await f.target("instagram", f.ig.id, "queued");
    expect(await publishingPush(f.post.id)).toEqual([]);
    expect(await db.notice.count({ where: { userId: f.user.id } })).toBe(0);
  });
  test("a draft or a scheduled post stays quiet until it really runs", async () => {
    for (const status of ["draft", "scheduled"]) {
      const f = await fixture(status);
      await f.target("instagram", f.ig.id, "pending");
      expect(await publishingPush(f.post.id)).toEqual([]);
      expect(await db.notice.count({ where: { userId: f.user.id } })).toBe(0);
    }
  });
});

describe("live", () => {
  test("everything out: one live notice, keyed so noticePostLive never adds a second", async () => {
    const f = await fixture("published");
    await f.target("instagram", f.ig.id, "published");
    await f.target("youtube", f.yt.id, "published");
    expect(await publishingPush(f.post.id)).toEqual(["live"]);
    const { noticePostLive } = await import("../lib/retention/notices");
    await noticePostLive(f.post.id);
    const ns = await notices(f.user.id);
    expect(ns.length).toBe(1);
    expect(ns[0]).toMatchObject({ kind: "post_live", key: `live:${f.post.id}`, href: `/create?post=${f.post.id}` });
    expect(ns[0].title).toBe('"Morning run" is live on Instagram and YouTube');
    expect(ns[0].body).toBe("Everything went out. Open it for the links to each post.");
  });
  test("partly out: the live notice names who still needs a hand, and the failure gets its own", async () => {
    const f = await fixture("partial");
    await f.target("instagram", f.ig.id, "published");
    const bad = await f.target("youtube", f.yt.id, "failed");
    await db.postTarget.update({ where: { id: bad.id }, data: { errorCode: "PLATFORM_DOWN" } });
    expect((await publishingPush(f.post.id)).sort()).toEqual(["failed", "live"]);
    const ns = await notices(f.user.id);
    expect(ns.length).toBe(2);
    expect(ns.find((x) => x.kind === "post_live")!.body).toContain("YouTube still needs a hand");
    expect(ns.find((x) => x.kind === "post_failed")!.href).toBe(`/create?post=${f.post.id}`);
  });
  test("still sending: no live notice before the platforms have answered", async () => {
    const f = await fixture();
    await f.target("instagram", f.ig.id, "published");
    await f.target("youtube", f.yt.id, "uploading");
    expect(await publishingPush(f.post.id)).toEqual(["started"]);
    expect(await db.notice.count({ where: { userId: f.user.id, kind: "post_live", key: `live:${f.post.id}` } })).toBe(0);
  });
});

describe("failed and needs action", () => {
  test("a failure points at the post's own recovery screen, not the failed list", async () => {
    const f = await fixture("failed");
    const bad = await f.target("instagram", f.ig.id, "failed");
    await db.postTarget.update({ where: { id: bad.id }, data: { errorCode: "AUTH_EXPIRED" } });
    expect(await publishingPush(f.post.id)).toEqual(["failed"]);
    const ns = await notices(f.user.id);
    expect(ns.length).toBe(1);
    expect(ns[0]).toMatchObject({ kind: "post_failed", tone: "danger", key: `fail:${f.post.id}:${bad.id}`, href: `/create?post=${f.post.id}`, action: "Reconnect Instagram" });
    expect(ns[0].title).toBe('"Morning run" needs you for Instagram');
    // the same key noticeFailedTarget uses, so the creator is told once, with the better link
    const { noticeFailedTarget } = await import("../lib/retention/notices");
    await noticeFailedTarget(bad.id, "AUTH_EXPIRED");
    expect(await db.notice.count({ where: { userId: f.user.id, kind: "post_failed" } })).toBe(1);
  });
  test("a plain refusal reads as Failed, one notice per destination", async () => {
    const f = await fixture("failed");
    const a = await f.target("instagram", f.ig.id, "failed");
    const b = await f.target("youtube", f.yt.id, "failed");
    await db.postTarget.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { errorCode: "PLATFORM_DOWN" } });
    expect(await publishingPush(f.post.id)).toEqual(["failed"]);
    expect(await publishingPush(f.post.id)).toEqual([]);
    const ns = await notices(f.user.id);
    expect(ns.length).toBe(2);
    for (const x of ns) {
      expect(x.title).toContain("didn't post to");
      expect(x.href).toBe(`/create?post=${f.post.id}`);
    }
  });
  test("the creator stopping an upload is not a failure and never buzzes", async () => {
    const f = await fixture("failed");
    const bad = await f.target("instagram", f.ig.id, "failed");
    await db.postTarget.update({ where: { id: bad.id }, data: { errorCode: "CANCELED" } });
    expect(await publishingPush(f.post.id)).toEqual([]);
    expect(await db.notice.count({ where: { userId: f.user.id } })).toBe(0);
  });
  test("failure alerts switched off: nothing is sent", async () => {
    const f = await fixture("failed");
    await db.user.update({ where: { id: f.user.id }, data: { notifyPrefs: JSON.stringify({ ev: { post_failed: false, post_live: false } }) } });
    const bad = await f.target("instagram", f.ig.id, "failed");
    await db.postTarget.update({ where: { id: bad.id }, data: { errorCode: "PLATFORM_DOWN" } });
    expect(await publishingPush(f.post.id)).toEqual([]);
    expect(await db.notice.count({ where: { userId: f.user.id } })).toBe(0);
  });
});

describe("practice runs", () => {
  test("a rehearsal never reaches a phone", async () => {
    const f = await fixture("published");
    const t = await f.target("instagram", f.ig.id, "published");
    await db.postTarget.update({ where: { id: t.id }, data: { practice: true } });
    expect(await publishingPush(f.post.id)).toEqual([]);
    expect(await db.notice.count({ where: { userId: f.user.id } })).toBe(0);
  });
});

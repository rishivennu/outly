/**
 * 1148: toasts that wait, deletes with Undo, library search and multi-select, the changelog.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { countdown, toastDuration, TOAST_MIN_MS } from "../lib/client/toast-core";
import { deferredQueue, reinsert, undoablePost, UNDO_SAFE_MS } from "../lib/client/deferred-delete";
import { bulkDeleteCopy, matchesQuery, selectRange } from "../lib/client/library-tools";
import { CHANGELOG, changelogByDay, changelogDate } from "../lib/changelog";

function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    set: (fn: () => void, ms: number) => (timers.set(next, { at: now + ms, fn }), next++),
    clear: (h: unknown) => void timers.delete(h as number),
    tick(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) if (t.at <= now) (timers.delete(id), t.fn());
    },
  };
}

describe("toast options", () => {
  test("errors stay until dismissed; the rest stay at least 6 s", () => {
    expect(toastDuration("error")).toBeNull();
    expect(toastDuration("error", 9000)).toBeNull();
    expect(toastDuration("ok")).toBe(TOAST_MIN_MS);
    expect(toastDuration("info", 1000)).toBe(6000);
    expect(toastDuration("info", 10_000)).toBe(10_000);
  });
  test("the clock stops while held and keeps the time left", () => {
    const c = fakeClock();
    let done = 0;
    const t = countdown(6000, () => done++, c);
    c.tick(4000);
    t.pause();
    c.tick(60_000);
    expect(done).toBe(0);
    expect(t.left()).toBe(2000);
    t.resume();
    c.tick(1999);
    expect(done).toBe(0);
    c.tick(1);
    expect(done).toBe(1);
    t.resume();
    c.tick(10_000);
    expect(done).toBe(1);
  });
  test("cancel never fires", () => {
    const c = fakeClock();
    let done = 0;
    countdown(6000, () => done++, c).cancel();
    c.tick(10_000);
    expect(done).toBe(0);
  });
});

describe("deferred delete", () => {
  const job = (log: string[], fail = false) => ({
    commit: async () => {
      log.push("commit");
      if (fail) throw new Error("x");
    },
    flush: () => log.push("flush"),
    restore: () => log.push("restore"),
    onFail: () => log.push("fail"),
    onDone: () => log.push("done"),
  });
  test("undo puts it back and nothing is sent", async () => {
    const log: string[] = [];
    const q = deferredQueue();
    q.add("a", job(log));
    expect(q.undo("a")).toBe(true);
    expect(await q.commit("a")).toBe(false);
    expect(log).toEqual(["restore"]);
  });
  test("the toast going sends it once; undo after that does nothing", async () => {
    const log: string[] = [];
    const q = deferredQueue();
    q.add("a", job(log));
    expect(await q.commit("a")).toBe(true);
    expect(q.undo("a")).toBe(false);
    expect(await q.commit("a")).toBe(false);
    expect(log).toEqual(["commit", "done"]);
  });
  test("a failed delete comes back and says so", async () => {
    const log: string[] = [];
    const q = deferredQueue();
    q.add("a", job(log, true));
    expect(await q.commit("a")).toBe(false);
    expect(log).toEqual(["commit", "restore", "fail"]);
  });
  test("closing the page flushes everything pending, once", () => {
    const log: string[] = [];
    const q = deferredQueue();
    q.add("a", job(log));
    q.add("b", job(log));
    q.flushAll();
    q.flushAll();
    expect(log).toEqual(["flush", "flush"]);
    expect(q.size).toBe(0);
  });
  test("reinsert keeps the place and never duplicates", () => {
    const l = [{ id: "a" }, { id: "c" }];
    expect(reinsert(l, { id: "b" }, 1).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(reinsert(l, { id: "b" }, 99).map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(reinsert(l, { id: "a" }, 0)).toBe(l);
  });
  test("only studio removals of things on no platform wait for Undo", () => {
    const now = Date.parse("2026-11-14T10:00:00Z");
    const t = (status: string, platformPostId: string | null = null, removeMode: string | null = null) => ({ status, platformPostId, removeMode });
    const at = (ms: number) => new Date(now + ms).toISOString();
    expect(undoablePost({ status: "draft", scheduledAt: null, targets: [t("pending")] }, now)).toBe(true);
    expect(undoablePost({ status: "failed", scheduledAt: null, targets: [t("failed")] }, now)).toBe(true);
    expect(undoablePost({ status: "scheduled", scheduledAt: at(UNDO_SAFE_MS + 60_000), targets: [t("pending")] }, now)).toBe(true);
    expect(undoablePost({ status: "scheduled", scheduledAt: at(60_000), targets: [t("pending")] }, now)).toBe(false);
    expect(undoablePost({ status: "published", scheduledAt: null, targets: [t("published", "p1")] }, now)).toBe(false);
    expect(undoablePost({ status: "partial", scheduledAt: null, targets: [t("published", "p1"), t("failed")] }, now)).toBe(false);
    expect(undoablePost({ status: "failed", scheduledAt: null, targets: [t("processing")] }, now)).toBe(false);
    expect(undoablePost({ status: "publishing", scheduledAt: null, targets: [t("queued")] }, now)).toBe(false);
  });
});

describe("library search and selection", () => {
  const p = (o: Partial<{ title: string; hook: string; filename: string; caption: string; hashtags: string }>) => ({
    title: o.title ?? null,
    hook: o.hook ?? null,
    story: null,
    media: { filename: o.filename ?? null },
    targets: [{ title: null, caption: o.caption ?? null, description: null, hashtags: o.hashtags ?? null }],
  });
  test("matches title, caption, tags and file name, ignoring case", () => {
    expect(matchesQuery(p({ title: "Sourdough Day" }), "sourdough")).toBe(true);
    expect(matchesQuery(p({ caption: "New recipe" }), "RECIPE")).toBe(true);
    expect(matchesQuery(p({ hashtags: "#breadtok" }), "#bread")).toBe(true);
    expect(matchesQuery(p({ filename: "IMG_2041.mov" }), "img_20")).toBe(true);
    expect(matchesQuery(p({ title: "Cake" }), "bread")).toBe(false);
    expect(matchesQuery(p({}), "  ")).toBe(true);
  });
  test("shift-click picks the run between the two clicks", () => {
    const ids = ["a", "b", "c", "d", "e"];
    let s = selectRange(ids, new Set(), null, 1, false);
    expect([...s]).toEqual(["b"]);
    s = selectRange(ids, s, 1, 3, true);
    expect([...s].sort()).toEqual(["b", "c", "d"]);
    s = selectRange(ids, s, 3, 2, false);
    expect([...s].sort()).toEqual(["b", "d"]);
    s = selectRange(ids, s, 4, 0, true);
    expect([...s].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
  test("the confirm names the count and what stays live", () => {
    const live = { targets: [{ status: "published" }] };
    const draft = { targets: [{ status: "pending" }] };
    expect(bulkDeleteCopy([draft, draft, draft])).toEqual({ title: "Delete 3 posts?", body: "All 3 go from your studio with their captions and videos. You can undo it for a few seconds after.", confirm: "Delete 3 posts" });
    expect(bulkDeleteCopy([live, draft]).body).toContain("1 of them went live, and those stay up on the platform.");
    expect(bulkDeleteCopy([draft]).confirm).toBe("Delete 1 post");
  });
});

describe("changelog", () => {
  test("only the real entries, newest first, grouped by day", () => {
    expect(CHANGELOG).toHaveLength(6);
    const days = changelogByDay();
    expect(days.map((d) => [d.date, d.entries.length])).toEqual([["2026-11-14", 4], ["2026-11-13", 2]]);
    expect(changelogDate("2026-11-14")).toBe("14 November 2026");
    for (const e of CHANGELOG) {
      expect(e.body).not.toMatch(/[\u2014]|\.\.\./);
      expect(e.body.length).toBeGreaterThan(10);
    }
  });
});

describe("server search and bulk delete", () => {
  let db: typeof import("../lib/db").db;
  let lib: typeof import("../lib/posts/library");
  let del: typeof import("../lib/posts/delete");
  beforeAll(async () => {
    ({ db } = await import("../lib/db"));
    lib = await import("../lib/posts/library");
    del = await import("../lib/posts/delete");
  }, 60_000);
  const mk = async (userId: string, title: string, filename: string, caption: string) => {
    const media = await db.media.create({ data: { userId, storageKey: `sample/${title}.mp4`, originalFilename: filename, mimeType: "video/mp4", size: 10, status: "ready" } });
    return db.post.create({ data: { userId, mediaId: media.id, title, status: "draft", targets: { create: [{ platform: "youtube", caption }] } } });
  };
  test("q searches title, file name and caption, only in your own library", async () => {
    const u = await db.user.create({ data: { name: "S", email: `r1148-${Date.now()}@test.dev`, passwordHash: "x" } });
    const other = await db.user.create({ data: { name: "O", email: `r1148o-${Date.now()}@test.dev`, passwordHash: "x" } });
    await mk(u.id, "Sourdough day", "a.mp4", "warm loaf");
    await mk(u.id, "Cake", "bread-cam.mov", "sweet");
    await mk(u.id, "Coffee", "c.mp4", "with bread on the side");
    await mk(other.id, "Bread for others", "x.mp4", "bread");
    const titles = async (q: string) => (await lib.libraryPage({ id: u.id, scope: null }, null, 48, {}, null, q)).posts.map((p) => p.title).sort();
    expect(await titles("bread")).toEqual(["Cake", "Coffee"]);
    expect(await titles("sourdough")).toEqual(["Sourdough day"]);
    expect(await titles("")).toHaveLength(3);
    expect((await lib.libraryPage({ id: u.id, scope: null }, null, 48, {}, "scheduled", "bread")).posts).toHaveLength(0);
  });
  test("studio-only deletes, as the bulk route sends them, remove drafts", async () => {
    const u = await db.user.create({ data: { name: "D", email: `r1148d-${Date.now()}@test.dev`, passwordHash: "x" } });
    const a = await mk(u.id, "One", "1.mp4", "");
    const r = await del.deletePost({ id: u.id }, a.id, { platforms: false, appOnlyAck: false });
    expect(r.local).toBe("deleted");
    expect(await db.post.count({ where: { id: a.id } })).toBe(0);
  });
});

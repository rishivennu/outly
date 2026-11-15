/** Phase 2 offline drafts, the pure half: statuses, requests, errors, backoff, the single-flight runner, the compare. */
import { describe, expect, test } from "bun:test";
import { MAX_AUTO_TRIES, SYNC_LABEL, backoffMs, buildSyncRequest, classifySyncError, clientKeyFor, createSyncRunner, deriveStatus, diffDrafts, draftSyncSignal, isClientKey, latestValid, sendSync, type SendOutcome, type SyncRequest } from "../lib/client/draft-sync-core";
import { syncDetail } from "../components/create/SyncStatus";

const facts = { online: true, saving: false, dirty: false, conflict: false, failed: false, lastSyncedAt: null as number | null };

describe("status", () => {
  test("the six brief labels plus Conflict", () => {
    expect(Object.values(SYNC_LABEL)).toEqual(["Online", "Offline", "Saving locally", "Waiting to sync", "Sync completed", "Sync failed", "Conflict"]);
  });
  test("each state from the facts", () => {
    expect(deriveStatus(facts)).toBe("online");
    expect(deriveStatus({ ...facts, online: false })).toBe("offline");
    expect(deriveStatus({ ...facts, saving: true, dirty: true })).toBe("saving");
    expect(deriveStatus({ ...facts, online: false, dirty: true })).toBe("waiting");
    expect(deriveStatus({ ...facts, dirty: true })).toBe("waiting");
    expect(deriveStatus({ ...facts, lastSyncedAt: 1 })).toBe("synced");
    expect(deriveStatus({ ...facts, dirty: true, failed: true })).toBe("failed");
    // Failed while offline is just waiting: it goes when the connection is back.
    expect(deriveStatus({ ...facts, online: false, dirty: true, failed: true })).toBe("waiting");
    expect(deriveStatus({ ...facts, conflict: true, dirty: true, saving: true })).toBe("conflict");
  });
});

describe("requests", () => {
  test("a new draft is a POST with its clientKey, an existing one a PATCH with its base time", () => {
    const post = buildSyncRequest({ postId: null, payload: { title: "a", mediaId: "m" }, clientKey: "d_abc", baseUpdatedAt: null });
    expect(post).toEqual({ url: "/api/posts", method: "POST", json: { title: "a", mediaId: "m", clientKey: "d_abc" } });
    const patch = buildSyncRequest({ postId: "p1", payload: { title: "a" }, clientKey: "d_abc", baseUpdatedAt: "2026-11-15T10:00:00.000Z" });
    expect(patch).toEqual({ url: "/api/posts/p1", method: "PATCH", json: { title: "a", baseUpdatedAt: "2026-11-15T10:00:00.000Z" } });
  });
  test("sync never schedules, launches or publishes", () => {
    const r = buildSyncRequest({ postId: "p1", payload: { title: "a", scheduledAt: "2030-01-01", mode: "now", confirmed: true, publish: true, status: "scheduled", requireApproval: false }, clientKey: "k", baseUpdatedAt: null });
    expect(r.json).toEqual({ title: "a" });
  });
  test("clientKey fits the server rule", () => {
    expect(clientKeyFor("d_m1x_abc123")).toBe("d_m1x_abc123");
    expect(isClientKey(clientKeyFor("!!!"))).toBe(true);
    expect(isClientKey(clientKeyFor("x".repeat(90)))).toBe(true);
    expect(isClientKey("a b")).toBe(false);
  });
});

describe("errors", () => {
  test("draft_conflict, retryable and fatal", () => {
    const server = { id: "p1", updatedAt: "t" };
    expect(classifySyncError({ status: 409, code: "draft_conflict", message: "x", data: { server } })).toEqual({ kind: "conflict", message: "This draft changed on another device.", server });
    expect(classifySyncError(new TypeError("Failed to fetch")).kind).toBe("retry");
    for (const status of [408, 429, 500, 503]) expect(classifySyncError({ status, message: "x" }).kind).toBe("retry");
    for (const status of [400, 403, 404, 409, 422]) expect(classifySyncError({ status, message: "x" }).kind).toBe("fatal");
  });
  test("backoff doubles, caps and jitters", () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3].map((a) => backoffMs(a, 1000, 60_000, mid))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(30, 1000, 60_000, mid)).toBe(60_000);
    expect(backoffMs(0, 1000, 60_000, () => 0)).toBe(750);
    expect(backoffMs(0, 1000, 60_000, () => 1)).toBe(1250);
  });
});

/** A clock and timers the test drives. */
function harness(outcomes: (SendOutcome | Promise<SendOutcome>)[], online = { v: true }) {
  let t = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  const sends: number[] = [];
  const conflicts: unknown[] = [];
  const r = createSyncRunner({
    send: async () => {
      sends.push(t);
      return outcomes.length ? await outcomes.shift()! : { kind: "ok" };
    },
    isOnline: () => online.v,
    onChange: () => {},
    onConflict: (s) => conflicts.push(s),
    now: () => t,
    setTimer: (fn, ms) => (timers.push({ at: t + ms, fn, id: ++id }), id),
    clearTimer: (x) => {
      const i = timers.findIndex((y) => y.id === x);
      if (i >= 0) timers.splice(i, 1);
    },
    backoff: (a) => 1000 * 2 ** a,
  });
  const advance = async (ms: number) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const due = timers[0];
      if (!due || due.at > end) break;
      timers.shift();
      t = Math.max(t, due.at);
      due.fn();
      await Bun.sleep(0);
    }
    t = end;
    await Bun.sleep(0);
  };
  return { r, sends, conflicts, timers, advance, online };
}

describe("runner", () => {
  test("debounced: a burst of changes is one request", async () => {
    const h = harness([]);
    h.r.change(500);
    h.r.change(500);
    h.r.change(500);
    await h.advance(499);
    expect(h.sends.length).toBe(0);
    await h.advance(1);
    expect(h.sends.length).toBe(1);
    expect(h.r.isDirty()).toBe(false);
    expect(h.r.state.lastSyncedAt).toBe(500);
  });
  test("single-flight: a change during a request goes right after it, never alongside", async () => {
    let release!: (o: SendOutcome) => void;
    const h = harness([new Promise<SendOutcome>((r) => (release = r))]);
    h.r.change(0);
    await h.advance(0);
    expect(h.sends.length).toBe(1);
    h.r.change(0);
    void h.r.flush();
    void h.r.flush();
    await h.advance(0);
    expect(h.sends.length).toBe(1);
    expect(h.r.state.inFlight).toBe(true);
    release({ kind: "ok" });
    await h.advance(0);
    await h.advance(0);
    expect(h.sends.length).toBe(2);
    expect(h.r.isDirty()).toBe(false);
  });
  test("offline: nothing is sent; coming back sends at once", async () => {
    const h = harness([], { v: false });
    h.r.change(0);
    await h.advance(5000);
    expect(h.sends.length).toBe(0);
    expect(h.r.isDirty()).toBe(true);
    h.online.v = true;
    await h.r.online();
    expect(h.sends.length).toBe(1);
    expect(h.r.isDirty()).toBe(false);
  });
  test("retries back off exponentially, then stop until Retry", async () => {
    const fail = { kind: "retry", error: "Couldn't reach Outlly." } as const;
    const h = harness(Array(MAX_AUTO_TRIES + 2).fill(fail));
    h.r.change(0);
    await h.advance(0);
    expect(h.sends).toEqual([0]);
    await h.advance(1000);
    await h.advance(2000);
    await h.advance(4000);
    expect(h.sends).toEqual([0, 1000, 3000, 7000]);
    await h.advance(1_000_000);
    expect(h.sends.length).toBe(MAX_AUTO_TRIES);
    expect(h.timers.length).toBe(0);
    expect(h.r.state.failed).toBe(true);
    await h.r.retry();
    expect(h.sends.length).toBe(MAX_AUTO_TRIES + 1);
  });
  test("a fatal error is not retried by itself", async () => {
    const h = harness([{ kind: "fatal", error: "Add a video first." }]);
    h.r.change(0);
    await h.advance(100_000);
    expect(h.sends.length).toBe(1);
    expect(h.r.state.error).toBe("Add a video first.");
    expect(h.r.isDirty()).toBe(true);
  });
  test("a conflict stops syncing until the user picks a version", async () => {
    const server = { id: "p1", updatedAt: "t2" };
    const h = harness([{ kind: "conflict", server }]);
    h.r.change(0);
    await h.advance(0);
    expect(h.conflicts).toEqual([server]);
    h.r.change(0);
    await h.advance(100_000);
    expect(h.sends.length).toBe(1);
    await h.r.resolveMine();
    expect(h.sends.length).toBe(2);
    expect(h.r.state.conflict).toBe(false);
  });
  test("keeping the other device's copy settles without sending", async () => {
    const h = harness([{ kind: "conflict", server: {} }]);
    h.r.change(0);
    await h.advance(0);
    h.r.settle(42);
    await h.advance(100_000);
    expect(h.sends.length).toBe(1);
    expect(h.r.isDirty()).toBe(false);
    expect(h.r.state.lastSyncedAt).toBe(42);
  });
  test("not ready (no video yet) stays waiting with no retry loop", async () => {
    const h = harness([{ kind: "skip" }]);
    h.r.change(0);
    await h.advance(100_000);
    expect(h.sends.length).toBe(1);
    expect(h.r.isDirty()).toBe(true);
    expect(h.r.state.failed).toBe(false);
    expect(h.r.state.blocked).toBe(true);
  });
});

describe("review fixes", () => {
  test("no video yet: the pill says so, and never claims a local copy the browser didn't keep", () => {
    const base = { lastSyncedAt: null, error: null };
    expect(syncDetail({ ...base, status: "waiting", needsMedia: true, storedHere: true })).toBe("Syncs after the video uploads");
    expect(syncDetail({ ...base, status: "waiting", storedHere: true })).toBe("Saved on this device");
    expect(syncDetail({ ...base, status: "offline", storedHere: false })).toBe("Not saved on this device");
    expect(syncDetail({ ...base, status: "waiting", storedHere: null })).toBe(null);
    expect(syncDetail({ ...base, status: "failed", error: "Nope." })).toBe("Nope.");
  });
  test("a skip after a failure no longer shows the old failure", async () => {
    const h = harness([{ kind: "fatal", error: "x" }, { kind: "skip" }]);
    h.r.change(0);
    await h.advance(0);
    expect(h.r.state.failed).toBe(true);
    h.r.change(0);
    await h.advance(0);
    expect(h.r.state).toMatchObject({ failed: false, error: null, blocked: true });
    expect(h.r.isDirty()).toBe(true);
  });
  test("Save draft (exclusive) waits for a sync in flight and nothing is sent alongside it", async () => {
    let release!: (o: SendOutcome) => void;
    const h = harness([new Promise<SendOutcome>((r) => (release = r))]);
    h.r.change(0);
    await h.advance(0);
    expect(h.sends.length).toBe(1);
    const log: string[] = [];
    let saved!: () => void;
    const save = h.r.exclusive(async () => {
      log.push("save start");
      await new Promise<void>((r) => (saved = r));
      log.push("save end");
    });
    await h.advance(0);
    expect(log).toEqual([]);
    release({ kind: "ok" });
    await h.advance(0);
    expect(log).toEqual(["save start"]);
    // typing while the save is out: queued, not sent
    h.r.change(0);
    await h.advance(10_000);
    expect(h.sends.length).toBe(1);
    saved();
    await save;
    await h.advance(0);
    expect(log).toEqual(["save start", "save end"]);
    expect(h.sends.length).toBe(2);
  });
  test("a save settles only what it carried: a change typed during it still goes up", async () => {
    const h = harness([]);
    h.r.change(60_000);
    const upTo = h.r.state.version;
    h.r.change(60_000);
    h.r.settle(5, upTo);
    expect(h.r.isDirty()).toBe(true);
    await h.advance(0);
    expect(h.sends.length).toBe(1);
    expect(h.r.isDirty()).toBe(false);
    // without upTo (keeping the other device's copy) everything settles
    h.r.change(60_000);
    h.r.settle(6);
    expect(h.r.isDirty()).toBe(false);
  });
  test("a PATCH to a draft deleted elsewhere (404) is saved again as a new draft with the same clientKey", async () => {
    const calls: SyncRequest[] = [];
    let gone = 0;
    const out = await sendSync({
      postId: "p_old",
      payload: { title: "mine", mediaId: "m" },
      clientKey: "d_k1",
      baseUpdatedAt: "2026-11-15T10:00:00.000Z",
      call: async (r) => {
        calls.push(r);
        if (r.method === "PATCH") throw Object.assign(new Error("We couldn't find that post."), { status: 404 });
        return { post: { id: "p_new" } };
      },
      gone: () => void gone++,
    });
    expect(out).toEqual({ result: { post: { id: "p_new" } }, recreated: true });
    expect(gone).toBe(1);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["PATCH /api/posts/p_old", "POST /api/posts"]);
    expect(calls[1].json).toEqual({ title: "mine", mediaId: "m", clientKey: "d_k1" });
    // other errors are not retried as a create
    const fail = sendSync({ postId: "p", payload: {}, clientKey: "k", baseUpdatedAt: null, call: async () => Promise.reject(Object.assign(new Error("x"), { status: 403 })), gone: () => {} });
    await expect(fail).rejects.toMatchObject({ status: 403 });
    const post404 = sendSync({ postId: null, payload: {}, clientKey: "k", baseUpdatedAt: null, call: async () => Promise.reject(Object.assign(new Error("x"), { status: 404 })), gone: () => {} });
    await expect(post404).rejects.toMatchObject({ status: 404 });
  });
});

describe("compare", () => {
  test("only the fields that differ, named for people", () => {
    const d = diffDrafts(
      { title: "Mine", story: "same", hook: undefined, targets: { instagram: { caption: "my cap", hashtags: "#a" }, youtube: { title: "yt" } } },
      { id: "p1", updatedAt: "t", title: "Theirs", story: "same ", hook: "h", targets: [{ platform: "instagram", caption: "their cap", hashtags: "#a" }, { platform: "youtube", title: "yt" }] },
      (p) => (p === "instagram" ? "Instagram" : p),
    );
    expect(d).toEqual([
      { key: "title", label: "Title", platform: null, mine: "Mine", theirs: "Theirs" },
      { key: "instagram.caption", label: "Instagram caption", platform: "instagram", mine: "my cap", theirs: "their cap" },
    ]);
  });
  test("a target the other side lacks shows as empty there", () => {
    const d = diffDrafts({ targets: { x: { caption: "hi", enabled: true } } }, { id: "p", updatedAt: "t", targets: [] });
    expect(d.map((x) => [x.key, x.mine, x.theirs])).toEqual([["x.enabled", "On", ""], ["x.caption", "hi", ""]]);
  });
  test("the latest valid local copy wins", () => {
    const a = { id: "a", updatedAt: 5, targets: {} };
    const b = { id: "b", updatedAt: 9, targets: {} };
    const broken = { id: "c", updatedAt: 99 } as unknown as typeof a;
    expect(latestValid([a, broken, b, null])).toBe(b);
    expect(latestValid([broken])).toBe(null);
  });
});

describe("app-wide signal", () => {
  test("notifies only on a real change", () => {
    let n = 0;
    const off = draftSyncSignal.subscribe(() => n++);
    draftSyncSignal.set({ status: "waiting", pending: true });
    draftSyncSignal.set({ status: "waiting", pending: true });
    draftSyncSignal.set({ status: "synced", pending: false });
    off();
    draftSyncSignal.set({ status: null, pending: false });
    expect(n).toBe(2);
  });
});

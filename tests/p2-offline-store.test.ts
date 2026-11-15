/** Phase 2 offline drafts, the store: one database per account, nothing shared, all gone on sign-out. */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/* A small in-memory IndexedDB: just the calls lib/client/device-drafts makes. */
type Rec = Map<unknown, unknown>;
const dbs = new Map<string, Map<string, { keyPath?: string; rows: Rec }>>();
const later = (fn: () => void) => setTimeout(fn, 0);
const clone = <T,>(v: T): T => (v instanceof Blob ? v : structuredClone(v));
function request<T>(fn: () => T) {
  const req: { result?: T; onsuccess?: () => void; onerror?: () => void } = {};
  req.result = fn();
  return req;
}
class FakeDb {
  onversionchange: (() => void) | null = null;
  closed = false;
  constructor(public name: string) {}
  get objectStoreNames() {
    const stores = dbs.get(this.name)!;
    return { contains: (n: string) => stores.has(n) };
  }
  createObjectStore(n: string, o?: { keyPath?: string }) {
    dbs.get(this.name)!.set(n, { keyPath: o?.keyPath, rows: new Map() });
  }
  close() {
    this.closed = true;
  }
  transaction(names: string[]) {
    if (this.closed) throw new Error("closed");
    const stores = dbs.get(this.name)!;
    const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: (n: string) => unknown } = {
      objectStore: (n: string) => {
        if (!names.includes(n)) throw new Error("not in tx");
        const s = stores.get(n)!;
        return {
          get: (k: unknown) => request(() => clone(s.rows.get(k))),
          getAll: () => request(() => [...s.rows.values()].map(clone)),
          put: (v: Record<string, unknown>, k?: unknown) =>
            request(() => {
              const key = s.keyPath ? v[s.keyPath] : k;
              s.rows.set(key, clone(v));
              return key;
            }),
          delete: (k: unknown) => request(() => void s.rows.delete(k)),
        };
      },
    };
    later(() => tx.oncomplete?.());
    return tx;
  }
}
const open: FakeDb[] = [];
const fakeIdb = {
  open(name: string) {
    const req: { result?: FakeDb; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void; onblocked?: () => void } = {};
    later(() => {
      const fresh = !dbs.has(name);
      if (fresh) dbs.set(name, new Map());
      req.result = new FakeDb(name);
      open.push(req.result);
      if (fresh) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
  deleteDatabase(name: string) {
    const req: { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void } = {};
    later(() => {
      for (const d of open) if (d.name === name && !d.closed) d.onversionchange?.();
      dbs.delete(name);
      req.onsuccess?.();
    });
    return req;
  },
  databases: async () => [...dbs.keys()].map((name) => ({ name, version: 1 })),
};
const ls = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.indexedDB = fakeIdb;
g.localStorage = {
  getItem: (k: string) => ls.get(k) ?? null,
  setItem: (k: string, v: string) => void ls.set(k, String(v)),
  removeItem: (k: string) => void ls.delete(k),
  get length() {
    return ls.size;
  },
  key: (i: number) => [...ls.keys()][i] ?? null,
};

let dd: typeof import("../lib/client/device-drafts");
let forget: typeof import("../lib/client/forget-billing");
beforeAll(async () => {
  // A copy an older build wrote, owner unknown.
  dbs.set("outlly-drafts", new Map([["drafts", { keyPath: "id", rows: new Map([["old", { id: "old", title: "someone's" }]]) }]]));
  dd = await import("../lib/client/device-drafts");
  forget = await import("../lib/client/forget-billing");
});

const words = (id: string, extra: Record<string, unknown> = {}) => ({ id, postId: null, title: `T ${id}`, story: "s", hook: null, targets: { instagram: { enabled: true, title: "", caption: "c", description: "", hashtags: "", firstComment: "" } }, filename: "v.mp4", poster: null, ...extra });

describe("per-account device drafts", () => {
  test("one account never sees another's drafts", async () => {
    const a = dd.openDrafts("user-a");
    const b = dd.openDrafts("user-b");
    expect(await a.save(words("d_a1"))).toBe(true);
    expect(await b.save(words("d_b1"))).toBe(true);
    expect((await a.list()).map((d) => d.id)).toEqual(["d_a1"]);
    expect((await b.list()).map((d) => d.id)).toEqual(["d_b1"]);
    expect(await b.get("d_a1")).toBe(null);
    expect(dd.draftsDbName("user-a")).not.toBe(dd.draftsDbName("user-b"));
    expect(dd.draftsDbName("user-a")).not.toContain("user-a");
  });
  test("the unscoped legacy database is deleted, not adopted", async () => {
    expect(dbs.has("outlly-drafts")).toBe(false);
    expect((await dd.openDrafts("user-a").list()).some((d) => d.id === "old")).toBe(false);
  });
  test("a save is pending, carries a clientKey, and keeps only known fields", async () => {
    const a = dd.openDrafts("user-a");
    await a.save({ ...words("d_a2"), schedule: { at: null, tz: "Asia/Kolkata" }, captions: { cues: [1] }, token: "secret", session: "x" } as Parameters<typeof a.save>[0]);
    const d = (await a.peek("d_a2"))!;
    expect(d.syncState).toBe("pending");
    expect(d.clientKey).toBe("d_a2");
    expect(d.schedule).toEqual({ at: null, tz: "Asia/Kolkata" });
    expect(d.captions).toEqual({ cues: [1] });
    expect(JSON.stringify(d)).not.toContain("secret");
    expect(Object.keys(d)).not.toContain("session");
  });
  test("synced is never stamped on a newer local change", async () => {
    const a = dd.openDrafts("user-a");
    const before = (await a.peek("d_a2"))!;
    await a.save(words("d_a2", { title: "newer" }));
    await a.update("d_a2", { syncState: "synced", postId: "p9", baseUpdatedAt: "2026-11-15T10:00:00.000Z" }, before.updatedAt);
    const d = (await a.peek("d_a2"))!;
    expect(d.syncState).toBe("pending");
    expect(d.postId).toBe("p9");
    expect(d.baseUpdatedAt).toBe("2026-11-15T10:00:00.000Z");
    await a.update("d_a2", { syncState: "synced" }, d.updatedAt);
    expect((await a.peek("d_a2"))!.syncState).toBe("synced");
    // The next edit keeps the base time and is pending again.
    await a.save(words("d_a2", { title: "again" }));
    expect((await a.peek("d_a2"))!).toMatchObject({ syncState: "pending", baseUpdatedAt: "2026-11-15T10:00:00.000Z", clientKey: "d_a2" });
  });
  test("a conflict stays a conflict until it is resolved", async () => {
    const a = dd.openDrafts("user-a");
    await a.update("d_a2", { syncState: "conflict" });
    await a.save(words("d_a2", { title: "typing on" }));
    expect((await a.peek("d_a2"))!.syncState).toBe("conflict");
  });
  test("clearing one account leaves the other", async () => {
    await dd.clearDeviceDrafts("user-b");
    expect(await dd.openDrafts("user-b").list()).toEqual([]);
    expect((await dd.openDrafts("user-a").list()).length).toBeGreaterThan(0);
  });
  test("sign-out (forgetBillingCopies, every path calls it) deletes every account's drafts", async () => {
    await dd.openDrafts("user-c").save(words("d_c1"));
    await forget.forgetBillingCopies();
    expect([...dbs.keys()].filter((n) => n.startsWith("outlly-drafts"))).toEqual([]);
    expect(await dd.openDrafts("user-a").list()).toEqual([]);
    expect(await dd.openDrafts("user-c").list()).toEqual([]);
  });
  test("without an account the old helpers keep nothing", async () => {
    await dd.clearDeviceDrafts();
    expect(await dd.listDeviceDrafts()).toEqual([]);
    expect(await dd.saveDeviceDraft(words("d_x"))).toBe(false);
  });
});

describe("review fixes", () => {
  test("pruning never drops a draft Outlly doesn't have yet", async () => {
    const p = dd.openDrafts("user-prune");
    for (let i = 0; i < 10; i++) {
      await p.save(words(`d_u${i}`));
      await Bun.sleep(2);
    }
    expect((await p.list()).length).toBe(10);
    for (let i = 0; i < 10; i++) await p.update(`d_u${i}`, { syncState: "synced" });
    await p.save(words("d_new"));
    const left = await p.list();
    // the newest 8 stay; the synced ones past that go, and the new pending one is kept
    expect(left.length).toBe(8);
    expect(left[0].id).toBe("d_new");
    expect(left.some((d) => d.id === "d_u0")).toBe(false);
  });
  test("a null base is forgotten, not stored as an empty string", async () => {
    const p = dd.openDrafts("user-prune");
    await p.update("d_new", { baseUpdatedAt: "2026-11-15T10:00:00.000Z", postId: "p1" });
    await p.update("d_new", { baseUpdatedAt: null, postId: null });
    const d = (await p.peek("d_new"))!;
    expect("baseUpdatedAt" in d).toBe(false);
    expect(d.postId).toBe(null);
  });
  test("an older version's drafts are kept and counted, and move into an account only when asked", async () => {
    await dd.clearDeviceDrafts();
    const video = new Blob(["v"], { type: "video/mp4" });
    const rec = (id: string, at: number) => ({ id, postId: null, updatedAt: at, title: `Old ${id}`, story: "s", hook: null, targets: { instagram: { enabled: true, title: "", caption: "c", description: "", hashtags: "" } }, filename: "v.mp4", videoKey: id === "l1" ? "v.mp4:1" : null, videoType: "video/mp4", poster: null });
    dbs.set("outlly-drafts", new Map([
      ["drafts", { keyPath: "id", rows: new Map<unknown, unknown>([["l1", rec("l1", 5)], ["l2", rec("l2", 6)], ["bad", { id: "bad" }]]) }],
      ["videos", { rows: new Map<unknown, unknown>([["l1", video]]) }],
    ]));
    expect(await dd.legacyDraftCount()).toBe(2);
    const a = dd.openDrafts("user-legacy");
    await a.save(words("d_mine"));
    expect(dbs.has("outlly-drafts")).toBe(true);
    expect((await a.list()).map((d) => d.id)).toEqual(["d_mine"]);
    expect(await a.adoptLegacy()).toBe(2);
    expect(dbs.has("outlly-drafts")).toBe(false);
    expect(await dd.legacyDraftCount()).toBe(0);
    const l1 = (await a.get("l1"))!;
    expect(l1.draft).toMatchObject({ title: "Old l1", syncState: "local", clientKey: "l1" });
    expect(l1.video?.size).toBe(1);
    expect((await a.list()).map((d) => d.id).sort()).toEqual(["d_mine", "l1", "l2"]);
  });
  test("an empty legacy database is still removed", async () => {
    await dd.clearDeviceDrafts();
    dbs.set("outlly-drafts", new Map([["drafts", { keyPath: "id", rows: new Map() }]]));
    expect(await dd.legacyDraftCount()).toBe(0);
    expect(dbs.has("outlly-drafts")).toBe(false);
  });
  test("sign-out also drops the guided setup's cached steps", async () => {
    ls.set("outly:onboarding:u1", "{}");
    ls.set("outly:onboarding:u1:me", "{}");
    ls.set("outly:theme", "dark");
    await forget.forgetLocalCopies();
    expect([...ls.keys()].filter((k) => k.startsWith("outly:onboarding:"))).toEqual([]);
    expect(ls.get("outly:theme")).toBe("dark");
  });
});

describe("wiring", () => {
  const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  test("a failed sign-out keeps the drafts on this device and says so", () => {
    const s = src("components/shell/SignOutButton.tsx");
    const out = s.slice(s.indexOf("const out = async"), s.indexOf("const stuck"));
    expect(out).toContain("} catch (e) {");
    expect(out).not.toContain("finally");
    expect(out.indexOf("return;")).toBeLessThan(out.indexOf("await forgetLocalCopies();"));
    expect(out).toContain("Your drafts are still on this device.");
    expect(out).toContain("e.status === 401");
    expect(s).toContain("disabled={stuck}");
    expect(s).toContain("const stuck = !online && unsynced > 0;");
  });
  test("sign-out clears local copies and warns about unsynced drafts", () => {
    const s = src("components/shell/SignOutButton.tsx");
    expect(s).toContain("await forgetLocalCopies();");
    expect(s).toContain('d.syncState !== "synced"');
  });
  test("no auth material in the draft store", () => {
    expect(src("lib/client/device-drafts.ts")).not.toMatch(/accessToken|refreshToken|password|sessionId|document\.cookie/);
  });
});

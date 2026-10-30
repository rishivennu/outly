/**
 * 1053: account deletion removes uploaded files as a durable background job. Database rows go in one
 * transaction; each object gets a StorageCleanup row retried with backoff; the person keeps a status link.
 */
import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { CLEANUP_MAX_ATTEMPTS, cleanupDelay, cleanupKeys, deletionMessage, type DeletionView } from "../lib/account-cleanup-core";

let db: typeof import("../lib/db").db;
let account: typeof import("../lib/account");
let cleanup: typeof import("../lib/account-cleanup");
let storage: typeof import("../lib/storage").storage;
let n = 0;
const spies: { mockRestore(): void }[] = [];

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  account = await import("../lib/account");
  cleanup = await import("../lib/account-cleanup");
  ({ storage } = await import("../lib/storage"));
}, 60_000);
afterEach(() => spies.splice(0).forEach((s) => s.mockRestore()));

const mk = (tag: string) => db.user.create({ data: { name: `Del ${tag}`, email: `del-${tag}-${++n}-${Date.now()}@test.dev`, passwordHash: "hashed-secret" } });
const media = (userId: string, storageKey: string, thumbnailKey: string | null) =>
  db.media.create({ data: { userId, originalFilename: "a.mp4", storageKey, thumbnailKey, mimeType: "video/mp4", size: 10 } });
const view = (v: Partial<DeletionView>): DeletionView => ({ status: "running", filesTotal: 3, filesDone: 1, startedAt: "", finishedAt: null, ...v });

describe("pure rules", () => {
  test("cleanupKeys drops empties and duplicates", () => {
    expect(cleanupKeys([{ storageKey: "a", thumbnailKey: "t" }, { storageKey: "b", thumbnailKey: "t" }, { storageKey: " ", thumbnailKey: null }])).toEqual(["a", "t", "b"]);
  });
  test("backoff grows then holds at 12 h", () => {
    expect([1, 2, 3, 4, 5, 6, 8].map(cleanupDelay)).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000, 43_200_000, 43_200_000]);
    expect(cleanupDelay(0)).toBe(60_000);
  });
  test("the message never says done while files remain", () => {
    expect(deletionMessage(view({}))).toContain("1 of 3");
    expect(deletionMessage(view({})).toLowerCase()).not.toContain("everything is deleted");
    expect(deletionMessage(view({ status: "failed" }))).toContain("2 uploaded files");
    expect(deletionMessage(view({ status: "done", filesDone: 3 }))).toContain("Everything is deleted");
    expect(deletionMessage(view({ filesTotal: 0, filesDone: 0 }))).toContain("Everything is deleted");
  });
});

describe("deleteAccount and the cleanup job", () => {
  test("writes a status record and one row per unique file, then removes them", async () => {
    const u = await mk("files");
    await media(u.id, `t1053/${n}/v1.mp4`, `t1053/${n}/thumb.jpg`);
    await media(u.id, `t1053/${n}/v2.mp4`, `t1053/${n}/thumb.jpg`);
    const r = await account.deleteAccount({ id: u.id, actor: null }, u.email);
    expect(r.ok).toBe(true);
    expect(await db.user.count({ where: { id: u.id } })).toBe(0);
    const v = await cleanup.deletionStatus(r.status);
    expect(v).toMatchObject({ status: "done", filesTotal: 3, filesDone: 3 });
    const d = await db.accountDeletion.findUnique({ where: { tokenHash: cleanup.hashDeletionToken(r.status) }, include: { files: true } });
    expect(d!.files.every((f) => f.doneAt && f.attempts === 1)).toBe(true);
    // The raw token is never stored.
    expect(JSON.stringify(d)).not.toContain(r.status);
  });

  test("no files means done at once", async () => {
    const u = await mk("empty");
    const r = await account.deleteAccount({ id: u.id, actor: null }, u.email);
    expect(await cleanup.deletionStatus(r.status)).toMatchObject({ status: "done", filesTotal: 0 });
  });

  test("a failing bucket retries with backoff, is idempotent, and ends as failed after max attempts", async () => {
    const u = await mk("fail");
    await media(u.id, `t1053/${n}/stuck.mp4`, null);
    const remove = spyOn(storage, "remove").mockImplementation(async () => {
      throw new Error("bucket down");
    });
    spies.push(remove);
    const r = await account.deleteAccount({ id: u.id, actor: null }, u.email);
    expect(await db.user.count({ where: { id: u.id } })).toBe(0); // the account goes even if the bucket is down
    const d = await db.accountDeletion.findUnique({ where: { tokenHash: cleanup.hashDeletionToken(r.status) }, include: { files: true } });
    const row = d!.files[0]!;
    expect(row).toMatchObject({ attempts: 1, doneAt: null, lastError: "bucket down" });
    expect(row.nextAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect((await cleanup.deletionStatus(r.status))!.status).toBe("running");

    // Not due yet: a sweep now touches nothing.
    await cleanup.runCleanups({ deletionId: d!.id });
    expect((await db.storageCleanup.findUnique({ where: { id: row.id } }))!.attempts).toBe(1);

    // Jump to the last try.
    await db.storageCleanup.update({ where: { id: row.id }, data: { attempts: CLEANUP_MAX_ATTEMPTS - 1, nextAt: new Date(0) } });
    await cleanup.runCleanups({ deletionId: d!.id });
    expect((await db.storageCleanup.findUnique({ where: { id: row.id } }))!.attempts).toBe(CLEANUP_MAX_ATTEMPTS);
    expect((await cleanup.deletionStatus(r.status))!.status).toBe("failed");

    // Past max attempts the sweeper leaves it alone.
    await db.storageCleanup.update({ where: { id: row.id }, data: { nextAt: new Date(0) } });
    const calls = remove.mock.calls.length;
    await cleanup.runCleanups({ deletionId: d!.id });
    expect(remove.mock.calls.length).toBe(calls);
  });

  test("a recovered bucket finishes the job; a second sweep is a no-op", async () => {
    const u = await mk("recover");
    await media(u.id, `t1053/${n}/late.mp4`, null);
    const remove = spyOn(storage, "remove").mockImplementationOnce(async () => {
      throw new Error("blip");
    });
    spies.push(remove);
    const r = await account.deleteAccount({ id: u.id, actor: null }, u.email);
    const id = (await db.accountDeletion.findUnique({ where: { tokenHash: cleanup.hashDeletionToken(r.status) } }))!.id;
    await db.storageCleanup.updateMany({ where: { deletionId: id }, data: { nextAt: new Date(0) } });
    await cleanup.runCleanups({ deletionId: id });
    expect(await cleanup.deletionStatus(r.status)).toMatchObject({ status: "done", filesDone: 1 });
    const before = remove.mock.calls.length;
    await cleanup.runCleanups({ deletionId: id });
    expect(remove.mock.calls.length).toBe(before);
  });

  test("an unknown token reveals nothing; old finished records are pruned", async () => {
    expect(await cleanup.deletionStatus("x".repeat(43))).toBeNull();
    const u = await mk("prune");
    const r = await account.deleteAccount({ id: u.id, actor: null }, u.email);
    await cleanup.pruneDeletions(new Date(Date.now() + 31 * 864e5));
    expect(await cleanup.deletionStatus(r.status)).toBeNull();
  });
});

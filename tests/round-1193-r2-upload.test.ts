/**
 * R1193: the R2 upload engine. Part sizing, backoff, adaptive parallelism, speed and time left, the file identity
 * check, what the upload card says, and the server half (UploadSession / UploadPart, resume, duplicate completion,
 * Cancel and the sweeper) run end to end against the in-memory S3 stand-in.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import * as realStorage from "../lib/storage";
import { MAX_PARTS, MIN_PART_BYTES, partSizeFor, s3Driver, type StorageDriver } from "../lib/storage";
import { backoffMs, concurrency, fileFingerprint, formatSpeed, limitsForResume, limitsProblem, meter, startConcurrency, type UploadLimits } from "../lib/client/upload";
import { claimFinalize, FINALIZE_STALE_MS, LEGACY_PART_BYTES, legacyPartSize, releaseFinalize, SESSION_TTL_MS, sessionClosed, validParts } from "../lib/media/upload-session";
import { fileStatus, uploadDetail } from "../components/create/UploadCard";
import type { UploadInfo } from "../lib/client/upload";
import { startFakeS3 } from "./helpers/fake-s3";

// Same switch as p2-create-shell (one global, so whichever mock is installed last behaves the same).
const g = globalThis as unknown as { __shellUser?: unknown; __r1193Storage?: StorageDriver; __queueBackend?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__shellUser !== undefined ? g.__shellUser : realGetCurrentUser()) }));
// The routes read `storage` at call time; while this file runs it is an R2 driver on the fake bucket, otherwise the real one.
const proxied = new Proxy(realStorage.storage, { get: (t, k) => Reflect.get(g.__r1193Storage ?? t, k) });
mock.module("../lib/storage", () => ({ ...realStorage, storage: proxied }));

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const MiB = 1024 * 1024;

describe("part size", () => {
  test("16 MiB parts by default, never under the 5 MiB floor", () => {
    expect(partSizeFor(100 * MiB, 16 * MiB)).toBe(16 * MiB);
    expect(partSizeFor(100 * MiB, 1 * MiB)).toBe(MIN_PART_BYTES);
    expect(partSizeFor(160_000 * MiB, 16 * MiB)).toBe(16 * MiB); // exactly 10,000 parts
  });
  test("a huge file grows the part in whole MiB so it stays within 10,000 parts", () => {
    const size = 200 * 1024 ** 3;
    const ps = partSizeFor(size, 16 * MiB);
    expect(ps).toBeGreaterThan(16 * MiB);
    expect(ps % MiB).toBe(0);
    expect(Math.ceil(size / ps)).toBeLessThanOrEqual(MAX_PARTS);
    expect(Math.ceil(size / (ps - MiB))).toBeGreaterThan(MAX_PARTS);
  });
  test("env defaults: 16 MB parts, 15-minute links, bounded", () => {
    const e = src("lib/env.ts");
    expect(e).toContain("UPLOAD_PART_MB: z.coerce.number().int().min(5).max(100).default(16)");
    expect(e).toContain("UPLOAD_URL_TTL_SEC: z.coerce.number().int().min(60).max(21_600).default(900)");
  });
});

describe("backoff", () => {
  test("full jitter: 0 to base x 2^n, capped at 30 s", () => {
    expect(backoffMs(3, () => 0)).toBe(0);
    expect(backoffMs(0, () => 1)).toBe(1000);
    expect(backoffMs(3, () => 1)).toBe(8000);
    expect(backoffMs(2, () => 0.5)).toBe(2000);
    expect(backoffMs(10, () => 1)).toBe(30_000);
    expect(backoffMs(40, () => 1)).toBe(30_000);
    for (let i = 0; i < 50; i++) expect(backoffMs(4)).toBeLessThanOrEqual(16_000);
  });
});

describe("adaptive parallelism", () => {
  test("starts inside its bounds", () => {
    expect(concurrency({ start: 9, max: 6 }).limit).toBe(6);
    expect(concurrency({ start: 0, max: 6 }).limit).toBe(1);
    expect(concurrency({ start: 3, max: 6 }).limit).toBe(3);
  });
  test("tries one more after a clean round and settling, and keeps it only if 8% faster", () => {
    const c = concurrency({ start: 2, max: 4, settleMs: 4000 });
    expect(c.ok(10, 0)).toBe(2); // round not complete yet
    expect(c.ok(10, 5000)).toBe(3); // clean round: try 3
    for (let i = 0; i < 3; i++) c.ok(12, 6000); // too soon after the change
    expect(c.limit).toBe(3);
    for (let i = 0; i < 3; i++) c.ok(12, 10_000); // 12 >= 10 x 1.08: keep it, try 4
    expect(c.limit).toBe(4);
    for (let i = 0; i < 4; i++) c.ok(20, 15_000);
    expect(c.limit).toBe(4); // never above max
  });
  test("steps back when one more was not faster, and stays there", () => {
    const c = concurrency({ start: 4, max: 6, settleMs: 4000 });
    for (let i = 0; i < 4; i++) c.ok(10, 5000);
    expect(c.limit).toBe(5);
    for (let i = 0; i < 5; i++) c.ok(10.5, 10_000); // 10.5 < 10.8: back to 4, ceiling now 4
    expect(c.limit).toBe(4);
    for (let i = 0; i < 4; i++) c.ok(30, 15_000);
    for (let i = 0; i < 4; i++) c.ok(30, 20_000);
    expect(c.limit).toBe(4);
  });
  test("no speed reading yet changes nothing", () => {
    const c = concurrency({ start: 2, max: 4 });
    for (let i = 0; i < 6; i++) c.ok(null, 10_000 * i);
    expect(c.limit).toBe(2);
  });
  test("a failure drops one, pushback (429/503) halves, never below 1", () => {
    const c = concurrency({ start: 6, max: 6 });
    expect(c.fail(false)).toBe(5);
    expect(c.fail(true)).toBe(2);
    expect(c.fail(true)).toBe(1);
    expect(c.fail(false)).toBe(1);
  });
  test("fewer in flight on phones and slow or data-saving connections", () => {
    expect(startConcurrency()).toEqual({ start: 4, max: 6 });
    expect(startConcurrency({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", connection: { effectiveType: "4g" } })).toEqual({ start: 4, max: 6 });
    expect(startConcurrency({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" })).toEqual({ start: 3, max: 4 });
    expect(startConcurrency({ userAgent: "Mozilla/5.0 (Linux; Android 15) Mobile" })).toEqual({ start: 3, max: 4 });
    expect(startConcurrency({ connection: { saveData: true } })).toEqual({ start: 2, max: 3 });
    expect(startConcurrency({ userAgent: "iPhone", connection: { effectiveType: "3g" } })).toEqual({ start: 2, max: 3 });
  });
});

describe("speed and time left", () => {
  test("formatSpeed", () => {
    expect(formatSpeed(0)).toBe("0 KB/s");
    expect(formatSpeed(Number.NaN)).toBe("0 KB/s");
    expect(formatSpeed(18 * MiB)).toBe("18 MB/s");
    expect(formatSpeed(4.2 * MiB)).toBe("4.2 MB/s");
    expect(formatSpeed(1 * MiB)).toBe("1 MB/s");
    expect(formatSpeed(640 * 1024)).toBe("640 KB/s");
    expect(formatSpeed(100)).toBe("1 KB/s");
  });
  test("meter waits for a real reading, then averages over the last 8 s", () => {
    let t = 0;
    const m = meter(() => t);
    expect(m(0, 100)).toEqual({ speed: null, eta: null });
    t = 1000;
    expect(m(10, 100)).toEqual({ speed: null, eta: null }); // under 1.2 s of history
    t = 2000;
    expect(m(20, 100)).toEqual({ speed: 10, eta: 8 });
    t = 12_000;
    expect(m(120, 200)).toEqual({ speed: 10, eta: 8 }); // the 0 s and 1 s points have aged out
    t = 13_000;
    expect(m(20, 200).speed).toBeNull(); // a reading that went backwards (a part restarted) is no speed
  });
});

describe("file identity for a resume", () => {
  const bytes = (n: number, at?: number) => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = i % 251;
    if (at !== undefined) b[at] ^= 0xff;
    return b;
  };
  test("the same bytes give the same id; a changed head or tail does not", async () => {
    const n = 300_000;
    const a = await fileFingerprint(new File([bytes(n)], "v.mp4", { lastModified: 1 }));
    expect(a).toStartWith(`v.mp4:${n}:`);
    expect(await fileFingerprint(new File([bytes(n)], "v.mp4", { lastModified: 999 }))).toBe(a); // a re-picked copy still matches
    expect(await fileFingerprint(new File([bytes(n, n - 1)], "v.mp4"))).not.toBe(a);
    expect(await fileFingerprint(new File([bytes(n, 10)], "v.mp4"))).not.toBe(a);
    expect(await fileFingerprint(new File([bytes(64)], "s.mp4"))).toMatch(/^s\.mp4:64:[0-9a-f]{24}$/);
  });
  test("without Web Crypto it falls back to name and size (and the modified time unless asked for a stable id)", async () => {
    const broken = { name: "v.mp4", size: 5, lastModified: 7, slice: () => { throw new Error("no"); } } as unknown as File;
    expect(await fileFingerprint(broken)).toBe("v.mp4:5:7");
    expect(await fileFingerprint(broken, true)).toBe("v.mp4:5");
  });
});

describe("recorded parts", () => {
  const s = { id: "s", fileSize: 25, chunkSize: 10, totalParts: 3 };
  test("only parts that fit this upload's split, once each, with a bucket-shaped ETag", () => {
    const kept = validParts(s, [
      { n: 1, etag: '"abc123"', size: 10 },
      { n: 3, etag: '"d"', size: 5 },
      { n: 2, etag: '"x"', size: 9 },
      { n: 4, etag: '"x"', size: 10 },
      { n: 0, etag: '"x"', size: 10 },
      { n: 1, etag: '"again"', size: 10 },
      { n: 2, etag: "<script>", size: 10 },
    ]);
    expect(kept.map((p) => p.n)).toEqual([1, 3]);
  });
  test("a session is closed when aborted, failed or past its window", () => {
    const later = new Date(Date.now() + 60_000);
    expect(sessionClosed({ status: "uploading", expiresAt: later })).toBe(false);
    expect(sessionClosed({ status: "finalizing", expiresAt: later })).toBe(false);
    expect(sessionClosed({ status: "aborted", expiresAt: later })).toBe(true);
    expect(sessionClosed({ status: "failed", expiresAt: later })).toBe(true);
    expect(sessionClosed({ status: "uploading", expiresAt: new Date(Date.now() - 1) })).toBe(true);
    expect(SESSION_TTL_MS).toBe(24 * 3600_000);
    expect(FINALIZE_STALE_MS).toBe(2 * 60_000);
  });
});

describe("what the upload card says", () => {
  const info = (x: Partial<UploadInfo> = {}): UploadInfo => ({ phase: "uploading", bytes: 750 * MiB, total: 1024 * MiB, speed: 18 * MiB, partsDone: 47, partsTotal: 63, active: 4, ...x });
  const up = (x: Partial<UploadInfo> = {}, progress = 0.42) => ({ kind: "uploading" as const, progress, info: info(x) });
  test("each phase in plain words", () => {
    expect(fileStatus(up({ phase: "preparing" })).text).toBe("Preparing the upload");
    expect(fileStatus(up({ phase: "resuming" })).text).toBe("Resuming from 42%");
    expect(fileStatus(up({ phase: "reconnecting" })).text).toBe("Reconnecting at 42%. What's up is kept.");
    expect(fileStatus(up({ phase: "reconnecting" }), false).text).toBe("Waiting for a connection at 42%. It picks up on its own.");
    expect(fileStatus(up({ phase: "finalizing" }, 1)).text).toBe("Finalizing the upload");
    expect(fileStatus(up({ phase: "processing" }, 1)).text).toBe("Processing your video");
    expect(fileStatus({ kind: "uploading", progress: 0.42, eta: 30, info: info() }).text).toBe("Uploading 42%, about 30 s left");
    for (const p of ["preparing", "resuming", "reconnecting", "finalizing", "processing", "uploading"] as const) {
      expect(fileStatus(up({ phase: p })).tone).toBe("busy");
      expect(fileStatus(up({ phase: p })).text).not.toContain("Uploaded");
    }
  });
  test("the 1170 wording still holds without phase info", () => {
    expect(fileStatus({ kind: "uploading", progress: 0.42 }).text).toStartWith("Uploading 42%");
    expect(fileStatus({ kind: "paused", progress: 0.5 }).text).toBe("Paused at 50%");
    expect(fileStatus({ kind: "done" })).toEqual({ tone: "ok", text: "Uploaded" });
  });
  test("the detail line: bytes, speed while moving, parts", () => {
    expect(uploadDetail(up())).toBe("750 MB of 1 GB · 18 MB/s · 47 of 63 parts");
    expect(uploadDetail(up({ phase: "reconnecting" }))).toBe("750 MB of 1 GB · 47 of 63 parts");
    expect(uploadDetail(up({ speed: null }))).toBe("750 MB of 1 GB · 47 of 63 parts");
    expect(uploadDetail(up({ bytes: 100 * 1024, partsTotal: 1, partsDone: 0 }))).toBe("0 MB of 1 GB · 18 MB/s");
    expect(uploadDetail(up({ phase: "preparing" }))).toBeNull();
    expect(uploadDetail(up({ phase: "processing" }))).toBeNull();
    expect(uploadDetail({ kind: "uploading", progress: 0.1 })).toBeNull();
    expect(uploadDetail({ kind: "paused", progress: 0.1 })).toBeNull();
    expect(uploadDetail(up({ total: 0 }))).toBeNull();
  });
});

describe("the server half against an R2 stand-in", () => {
  const fake = startFakeS3({ accessKeyId: "ak", secret: "sk", bucket: "b" });
  const r2 = s3Driver({ endpoint: fake.url, bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", region: "auto" }, "r2", 5 * MiB, 900);
  let db: typeof import("../lib/db").db;
  let direct: typeof import("../app/api/media/direct/route");
  let parts: typeof import("../app/api/media/direct/parts/route");
  let complete: typeof import("../app/api/media/direct/complete/route");
  let abort: typeof import("../app/api/media/direct/abort/route");
  let h: typeof import("../lib/queue/handlers");
  const queued: string[] = [];
  let savedQueue: unknown;
  let savedFetch: typeof fetch;
  let n = 0;
  beforeAll(async () => {
    // Other files stub global fetch; the driver and these PUTs must reach the fake bucket for real.
    savedFetch = globalThis.fetch;
    globalThis.fetch = Bun.fetch as typeof fetch;
    savedQueue = g.__queueBackend;
    g.__queueBackend = { add: async (name: string, data: { mediaId: string }) => void queued.push(`${name}:${data.mediaId}`) };
    g.__r1193Storage = r2;
    db = (await import("../lib/db")).db;
    direct = await import("../app/api/media/direct/route");
    parts = await import("../app/api/media/direct/parts/route");
    complete = await import("../app/api/media/direct/complete/route");
    abort = await import("../app/api/media/direct/abort/route");
    h = await import("../lib/queue/handlers");
  }, 60_000);
  afterAll(() => {
    globalThis.fetch = savedFetch;
    g.__queueBackend = savedQueue;
    g.__r1193Storage = undefined;
    g.__shellUser = undefined;
    fake.stop();
  });

  const post = (path: string, body: unknown) =>
    new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" } });
  const call = async (r: { POST: (req: NextRequest, ctx: never) => Promise<Response> }, path: string, body: unknown) => {
    const res = await r.POST(post(path, body), {} as never);
    return { status: res.status, j: (await res.json()) as Record<string, any> };
  };
  async function signIn() {
    const u = await db.user.create({ data: { name: `R2 ${++n}`, email: `r1193-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
    g.__shellUser = { ...u, actor: null, role: "owner", joinedAt: u.createdAt, scope: null };
    return u;
  }
  /** An 11 MiB "MP4": three 5 MiB parts (5, 5, 1), with an ftyp box up front. */
  const SIZE = 11 * MiB;
  const video = () => {
    const b = Buffer.alloc(SIZE, 7);
    b.write("ftypisom", 4, "latin1");
    return b;
  };
  const slice = (b: Buffer, n: number) => b.subarray((n - 1) * 5 * MiB, Math.min(SIZE, n * 5 * MiB));
  async function start(fingerprint = "fp-1") {
    const r = await call(direct, "/api/media/direct", { name: "big.mp4", type: "video/mp4", size: SIZE, fingerprint });
    expect(r.status).toBe(201);
    return r.j as { mediaId: string; uploadId: string; parts: number; partSize: number; sessionId: string; expiresAt: number; ttl: number; mode: string };
  }
  const sign = (up: { mediaId: string; uploadId: string }, x: Record<string, unknown> = {}) =>
    call(parts, "/api/media/direct/parts", { mediaId: up.mediaId, uploadId: up.uploadId, fingerprint: "fp-1", ...x });
  async function put(url: string, body: Buffer) {
    const r = await fetch(url, { method: "PUT", body });
    expect(r.status).toBe(200);
    return r.headers.get("etag")!;
  }

  test("a multipart upload gets a session: upload id, part size, parts, expiry, fingerprint", async () => {
    await signIn();
    const up = await start();
    expect(up.mode).toBe("multipart");
    expect(up.partSize).toBe(5 * MiB);
    expect(up.parts).toBe(3);
    expect(up.ttl).toBe(900);
    const s = await db.uploadSession.findUniqueOrThrow({ where: { mediaId: up.mediaId } });
    expect(s).toMatchObject({ id: up.sessionId, uploadId: up.uploadId, chunkSize: 5 * MiB, totalParts: 3, fileSize: SIZE, completedParts: 0, status: "uploading", fingerprint: "fp-1" });
    expect(Math.abs(s.expiresAt.getTime() - Date.now() - SESSION_TTL_MS)).toBeLessThan(60_000);
    expect(fake.uploads.has(up.uploadId)).toBe(true);
  });

  test("a file that fits in one part is a single 15-minute PUT, with no session", async () => {
    await signIn();
    const r = await call(direct, "/api/media/direct", { name: "small.mp4", type: "video/mp4", size: 4 * MiB });
    expect(r.status).toBe(201);
    expect(r.j.mode).toBe("put");
    expect(r.j.uploadUrl).toContain("X-Amz-Expires=900");
    expect(await db.uploadSession.findUnique({ where: { mediaId: r.j.mediaId } })).toBeNull();
  });

  test("resume end to end: short links, landed parts recorded, missing parts refused, then one stitch", async () => {
    await signIn();
    const data = video();
    const up = await start();
    const a = await sign(up, { parts: [1, 2, 3] });
    expect(a.status).toBe(200);
    expect(a.j).toMatchObject({ partSize: 5 * MiB, total: 3, ttl: 900 });
    expect(Object.keys(a.j.urls)).toEqual(["1", "2", "3"]);
    for (const u of Object.values(a.j.urls) as string[]) expect(u).toContain("X-Amz-Expires=900");
    const e1 = await put(a.j.urls[1], slice(data, 1));
    const e2 = await put(a.j.urls[2], slice(data, 2));

    // The next sign call carries what landed; the session counts it.
    const b = await sign(up, { parts: [3], done: [{ n: 1, etag: e1, size: 5 * MiB }] });
    expect(b.status).toBe(200);
    expect((await db.uploadSession.findUniqueOrThrow({ where: { mediaId: up.mediaId } })).completedParts).toBe(1);

    // Finishing early is refused, and the session goes back to uploading so the browser can finish.
    const early = await call(complete, "/api/media/direct/complete", { mediaId: up.mediaId, uploadId: up.uploadId, done: [{ n: 2, etag: e2, size: 5 * MiB }] });
    expect(early.status).toBe(409);
    expect(early.j.code).toBe("PARTS_MISSING");
    let s = await db.uploadSession.findUniqueOrThrow({ where: { mediaId: up.mediaId } });
    expect(s.status).toBe("uploading");
    expect(s.completedParts).toBe(2);

    // A resume asks the bucket what it already has.
    const c = await sign(up, { parts: [3], list: true });
    expect(c.j.uploaded).toEqual([{ n: 1, size: 5 * MiB }, { n: 2, size: 5 * MiB }]);
    await put(c.j.urls[3], slice(data, 3));

    const done = await call(complete, "/api/media/direct/complete", { mediaId: up.mediaId, uploadId: up.uploadId });
    expect(done.status).toBe(200);
    expect(done.j.media.status).toBe("processing");
    expect(queued.filter((q) => q === `VIDEO_PROCESS:${up.mediaId}`)).toHaveLength(1);
    s = await db.uploadSession.findUniqueOrThrow({ where: { mediaId: up.mediaId } });
    expect(s.status).toBe("completed");
    expect(s.completedParts).toBe(3);
    const key = (await db.media.findUniqueOrThrow({ where: { id: up.mediaId } })).storageKey;
    expect(fake.objects.get(key)?.body.equals(data)).toBe(true);

    // A retried complete is a no-op that answers the same.
    const again = await call(complete, "/api/media/direct/complete", { mediaId: up.mediaId, uploadId: up.uploadId });
    expect(again.status).toBe(200);
    expect(queued.filter((q) => q === `VIDEO_PROCESS:${up.mediaId}`)).toHaveLength(1);
  });

  test("two completes at once: one stitch, one queued job", async () => {
    await signIn();
    const data = video();
    const up = await start();
    const a = await sign(up, { parts: [1, 2, 3] });
    for (const k of [1, 2, 3]) await put(a.j.urls[k], slice(data, k));
    const both = await Promise.all([0, 1].map(() => call(complete, "/api/media/direct/complete", { mediaId: up.mediaId, uploadId: up.uploadId })));
    for (const r of both) expect(r.status === 200 || (r.status === 409 && r.j.code === "FINALIZING")).toBe(true);
    expect(both.some((r) => r.status === 200)).toBe(true);
    expect(queued.filter((q) => q === `VIDEO_PROCESS:${up.mediaId}`)).toHaveLength(1);
  });

  test("a stuck finalizing is waited on, then taken over once it is stale", async () => {
    await signIn();
    const data = video();
    const up = await start();
    const a = await sign(up, { parts: [1, 2, 3] });
    for (const k of [1, 2, 3]) await put(a.j.urls[k], slice(data, k));
    await db.uploadSession.update({ where: { mediaId: up.mediaId }, data: { status: "finalizing" } });
    const wait = await call(complete, "/api/media/direct/complete", { mediaId: up.mediaId, uploadId: up.uploadId });
    expect(wait.status).toBe(409);
    expect(wait.j.code).toBe("FINALIZING");
    const s = await db.uploadSession.findUniqueOrThrow({ where: { mediaId: up.mediaId } });
    expect(await claimFinalize(s.id)).toBe(false); // fresh: someone is on it
    expect(await claimFinalize(s.id, Date.now() + FINALIZE_STALE_MS + 60_000)).toBe(true); // stale: taken over
    expect(await claimFinalize(s.id)).toBe(false); // and now held again
    await releaseFinalize(s.id);
    expect((await db.uploadSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("uploading");
    const ok = await call(complete, "/api/media/direct/complete", { mediaId: up.mediaId, uploadId: up.uploadId });
    expect(ok.status).toBe(200);
    expect(ok.j.media.status).toBe("processing");
  });

  test("a resume is refused for another upload id, a different file or an expired session", async () => {
    await signIn();
    const up = await start();
    const wrong = await sign({ ...up, uploadId: "someone-elses" }, { parts: [1] });
    expect(wrong.status).toBe(409);
    expect(wrong.j.code).toBe("UPLOAD_MISMATCH");
    const changed = await sign(up, { parts: [1], fingerprint: "fp-2" });
    expect(changed.status).toBe(409);
    expect(changed.j.code).toBe("FILE_CHANGED");
    expect((await sign(up, { parts: [1], fingerprint: undefined })).status).toBe(200);
    await db.uploadSession.update({ where: { mediaId: up.mediaId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const gone = await sign(up, { parts: [1] });
    expect(gone.status).toBe(410);
    expect(gone.j.code).toBe("EXPIRED");
    const late = await call(complete, "/api/media/direct/complete", { mediaId: up.mediaId, uploadId: up.uploadId });
    expect(late.status).toBe(410);
  });

  test("parts that don't fit the split are not recorded", async () => {
    await signIn();
    const up = await start();
    await sign(up, { parts: [], done: [{ n: 1, etag: '"a"', size: 123 }, { n: 9, etag: '"b"', size: 5 * MiB }, { n: 3, etag: '"c"', size: MiB }] });
    const s = await db.uploadSession.findUniqueOrThrow({ where: { mediaId: up.mediaId }, include: { parts: true } });
    expect(s.parts.map((p) => p.partNumber)).toEqual([3]);
    expect(s.completedParts).toBe(1);
    // the same part reported twice keeps one row with the newer tag
    await sign(up, { parts: [], done: [{ n: 3, etag: '"d"', size: MiB }] });
    const p = await db.uploadPart.findMany({ where: { sessionId: s.id } });
    expect(p.map((x) => [x.partNumber, x.etag])).toEqual([[3, '"d"']]);
  });

  test("Cancel drops the bucket's parts, frees the reservation, and is safe to repeat", async () => {
    const u = await signIn();
    const up = await start();
    const a = await sign(up, { parts: [1] });
    await put(a.j.urls[1], slice(video(), 1));
    const r = await call(abort, "/api/media/direct/abort", { mediaId: up.mediaId });
    expect(r.status).toBe(200);
    expect(r.j.status).toBe("cancelled");
    expect(fake.uploads.has(up.uploadId)).toBe(false);
    expect((await db.media.findUniqueOrThrow({ where: { id: up.mediaId } })).status).toBe("failed");
    expect((await db.uploadSession.findUniqueOrThrow({ where: { mediaId: up.mediaId } })).status).toBe("aborted");
    const twice = await call(abort, "/api/media/direct/abort", { mediaId: up.mediaId });
    expect(twice.j).toEqual({ ok: true, status: "failed" });
    // after a Cancel the upload can't be finished or signed
    expect((await call(complete, "/api/media/direct/complete", { mediaId: up.mediaId, uploadId: up.uploadId })).j.media.status).toBe("failed");
    expect((await sign(up, { parts: [2] })).j.code).toBe("NOT_UPLOADING");
    expect(u.id).toBeTruthy();
  });

  test("someone else's upload can't be cancelled", async () => {
    await signIn();
    const up = await start();
    await signIn();
    const r = await call(abort, "/api/media/direct/abort", { mediaId: up.mediaId });
    expect(r.status).toBe(404);
    expect((await db.media.findUniqueOrThrow({ where: { id: up.mediaId } })).status).toBe("uploading");
    expect(fake.uploads.has(up.uploadId)).toBe(true);
  });

  test("the sweeper aborts an abandoned multipart upload and closes its session", async () => {
    await signIn();
    const up = await start();
    const old = new Date("2001-01-01T00:00:00Z");
    await db.media.update({ where: { id: up.mediaId }, data: { createdAt: old } });
    // `now` puts only this row past the stale window, so rows from other tests are never touched.
    await h.sweepDirectUploads(old.getTime() + h.STALE_DIRECT_UPLOAD_MS + 60_000);
    expect((await db.media.findUniqueOrThrow({ where: { id: up.mediaId } })).status).toBe("failed");
    expect((await db.uploadSession.findUniqueOrThrow({ where: { mediaId: up.mediaId } })).status).toBe("aborted");
    expect(fake.uploads.has(up.uploadId)).toBe(false);
  });

  // Found in review: an upload started before R1193 has no session, and the part size moved from 10 to 16 MiB.
  test("an upload from before R1193 (no session) is signed and stitched at the old 10 MiB split", async () => {
    await signIn();
    const data = video();
    const up = await start();
    await db.uploadSession.delete({ where: { mediaId: up.mediaId } });
    const a = await sign(up, { parts: [1, 2] });
    expect(a.status).toBe(200);
    expect(a.j.partSize).toBe(LEGACY_PART_BYTES);
    expect(a.j.total).toBe(2);
    expect(a.j.uploaded).toBeUndefined();
    await put(a.j.urls[1], data.subarray(0, 10 * MiB));
    await put(a.j.urls[2], data.subarray(10 * MiB));
    const ok = await call(complete, "/api/media/direct/complete", { mediaId: up.mediaId, uploadId: up.uploadId });
    expect(ok.status).toBe(200);
    expect(ok.j.media.status).toBe("processing");
  });

  test("once part 1 is in the bucket, a session-less upload is held to the size it was really cut with", async () => {
    await signIn();
    const data = video();
    const up = await start();
    const a = await sign(up, { parts: [1] });
    await put(a.j.urls[1], slice(data, 1)); // cut at 5 MiB, as a deployment with UPLOAD_PART_MB=5 did
    await db.uploadSession.delete({ where: { mediaId: up.mediaId } });
    const b = await sign(up, { parts: [2, 3], list: true });
    expect(b.j.partSize).toBe(5 * MiB);
    expect(b.j.total).toBe(3);
    expect(b.j.uploaded).toEqual([{ n: 1, size: 5 * MiB }]);
    for (const k of [2, 3]) await put(b.j.urls[k], slice(data, k));
    const ok = await call(complete, "/api/media/direct/complete", { mediaId: up.mediaId, uploadId: up.uploadId });
    expect(ok.status).toBe(200);
  });

  test("Cancel landing while the parts are stitched leaves no file behind", async () => {
    await signIn();
    const data = video();
    const up = await start();
    const a = await sign(up, { parts: [1, 2, 3] });
    for (const k of [1, 2, 3]) await put(a.j.urls[k], slice(data, k));
    const m = await db.media.findUniqueOrThrow({ where: { id: up.mediaId } });
    const mp = r2.multipart!;
    // The bucket has already accepted the stitch when Cancel lands: Cancel's abort and remove find nothing to drop
    // (the file doesn't exist yet), its row writes go through, and then the stitch makes the file.
    g.__r1193Storage = {
      ...r2,
      multipart: {
        ...mp,
        complete: async (...x: Parameters<typeof mp.complete>) => {
          await db.media.update({ where: { id: up.mediaId }, data: { status: "failed" } });
          await db.uploadSession.update({ where: { mediaId: up.mediaId }, data: { status: "aborted" } });
          await mp.complete(...x);
        },
      },
    } as StorageDriver;
    try {
      const r = await call(complete, "/api/media/direct/complete", { mediaId: up.mediaId, uploadId: up.uploadId });
      expect(r.status).toBe(409);
      expect(r.j.code).toBe("CANCELLED");
    } finally {
      g.__r1193Storage = r2;
    }
    expect(await r2.stat(m.storageKey)).toBeNull();
    expect((await db.media.findUniqueOrThrow({ where: { id: up.mediaId } })).status).toBe("failed");
    expect(queued.filter((q) => q === `VIDEO_PROCESS:${up.mediaId}`)).toHaveLength(0);
  });
});

describe("found in review", () => {
  test("legacy part size: part 1 of a file that needs more than one part, else the old 10 MiB default", () => {
    expect(LEGACY_PART_BYTES).toBe(10 * MiB);
    expect(legacyPartSize(undefined, 50 * MiB)).toBe(10 * MiB);
    expect(legacyPartSize([], 50 * MiB)).toBe(10 * MiB);
    expect(legacyPartSize([{ n: 1, size: 8 * MiB }, { n: 2, size: 8 * MiB }], 50 * MiB)).toBe(8 * MiB);
    expect(legacyPartSize([{ n: 3, size: 8 * MiB }], 50 * MiB)).toBe(10 * MiB); // part 1 not there yet
    expect(legacyPartSize([{ n: 1, size: 50 * MiB }], 50 * MiB)).toBe(10 * MiB); // a whole-file part says nothing
  });

  test("the browser waits out a crashed stitch instead of giving up before it can be taken over", () => {
    const s = src("lib/client/upload.ts");
    const m = s.match(/code === "FINALIZING" && waits\+\+ < (\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1]) * 1500).toBeGreaterThan(FINALIZE_STALE_MS);
  });
});

describe("source pins", () => {
  test("complete claims the session before stitching and the row before queueing", () => {
    const s = src("app/api/media/direct/complete/route.ts");
    expect(s.indexOf("claimFinalize(")).toBeGreaterThan(-1);
    expect(s.indexOf("claimFinalize(")).toBeLessThan(s.indexOf("mp.complete("));
    expect(s.lastIndexOf("db.media.updateMany")).toBeLessThan(s.indexOf('enqueue("VIDEO_PROCESS"'));
    expect(s).toContain("if (claimed.count === 1) await enqueue(");
  });
  test("the browser keeps the ETag and drops a dead upload on Cancel", () => {
    const u = src("lib/client/upload.ts");
    expect(u).toContain('getResponseHeader("ETag")');
    expect(u).toContain("keepalive");
    expect(u).toContain("/api/media/direct/abort");
    expect(src("components/create/UploadCard.tsx")).toContain("Cancel upload");
  });
  test("both schemas carry the new tables", () => {
    for (const f of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) {
      const s = src(f);
      expect(s).toContain("model UploadSession {");
      expect(s).toContain("model UploadPart {");
    }
  });
  test("the transcribe card sits under the video from md up and stays in the panel on phones", () => {
    const w = src("components/create/CreateWorkspace.tsx");
    expect(w).toContain('<TranscribeRun className="mt-3 hidden md:block" />');
    expect(w).toContain("roomBelow={capTranscribing}");
    expect(src("components/create/CaptionBurner.tsx")).toContain('className="mt-4 md:hidden"');
    expect(src("components/create/captions/CaptionRun.tsx")).toContain("export function TranscribeRun");
  });
  test("the deploy doc lists the link lifetime", () => expect(src("docs/DEPLOYMENT.md")).toContain("UPLOAD_URL_TTL_SEC"));
});

describe("found in the browser pass", () => {
  const MB = 1048576;
  // The Free plan in the dev pass: 50 MB, with this 34 MB file's own "uploading" row already holding its space.
  const lim: UploadLimits = { direct: true, maxBytes: 200 * MB, planName: "Free", storage: { usedBytes: 34 * MB, limitBytes: 50 * MB, remainingBytes: 16 * MB, over: false, label: "34 MB of 50 MB" } };
  const file = { name: "clip.mp4", type: "video/mp4", size: 34 * MB };
  test("a fresh check of the same file is refused by its own reservation, which is why a resume skips it", () => {
    expect(limitsProblem(file, lim)?.kind).toBe("storage");
    expect(limitsProblem(file, limitsForResume(lim, file.size))).toBeNull();
  });
  test("the space handed back is only this file's: a resume that really doesn't fit is still refused", () => {
    const full: UploadLimits = { ...lim, storage: { usedBytes: 60 * MB, limitBytes: 50 * MB, remainingBytes: 0, over: true, label: "60 MB of 50 MB" } };
    const r = limitsForResume(full, file.size);
    expect(r.storage).toMatchObject({ usedBytes: 26 * MB, remainingBytes: 24 * MB, over: false });
    expect(limitsProblem(file, r)?.kind).toBe("storage");
  });
  test("never below zero, and a plan without a storage cap is left alone", () => {
    expect(limitsForResume({ ...lim, storage: { usedBytes: 10 * MB, limitBytes: 50 * MB, remainingBytes: 40 * MB, over: false, label: "" } }, file.size).storage).toMatchObject({ usedBytes: 0, remainingBytes: 50 * MB });
    const open: UploadLimits = { direct: true, maxBytes: 200 * MB };
    expect(limitsForResume(open, file.size)).toBe(open);
    // no usedBytes from an older server: worked out from what is left
    expect(limitsForResume({ ...lim, storage: { limitBytes: 50 * MB, remainingBytes: 16 * MB, over: false, label: "" } }, file.size).storage?.remainingBytes).toBe(50 * MB);
  });
  test("the saved upload is looked up before the limits check, and only then checked with its space handed back", () => {
    const up = src("lib/client/upload.ts");
    const body = up.slice(up.indexOf("export async function uploadVideo"));
    expect(body.indexOf("let saved = cfg.direct ? readSaved(slot, fp) : null;")).toBeGreaterThan(0);
    expect(body.indexOf("let saved = cfg.direct ? readSaved(slot, fp) : null;")).toBeLessThan(body.indexOf("const bad = limitsProblem(file, saved ? limitsForResume(cfg, file.size) : cfg);"));
    expect(body.match(/readSaved\(slot, fp\)/g)?.length).toBe(1);
  });
  test("Pause stops the progress reports: the parts still unwinding can't put the card back to Uploading", () => {
    const up = src("lib/client/upload.ts");
    const rep = up.slice(up.indexOf("function reporter("), up.indexOf("type Rep = ReturnType<typeof reporter>;"));
    expect(rep).toContain("if (signal?.aborted) return;");
    expect(up).toContain("const rep = reporter(file, onProgress, signal);");
    expect(src("components/create/CreateWorkspace.tsx")).toContain("if (!ctrl.signal.aborted) setUpload({ kind: \"uploading\", progress: p, eta, info });");
  });
  test("nothing to pause once the parts are being stitched, nothing to cancel once it is processing", () => {
    const card = src("components/create/UploadCard.tsx");
    expect(card).toContain('const stitching = phase === "finalizing" || phase === "processing";');
    expect(card).toContain("{busy && !stitching && onPause && (");
    expect(card).toContain('{((busy && phase !== "processing") || upload.kind === "paused") && onCancel && (');
  });
  test("Cancel on a paused upload still asks to stop the upload", () => {
    const ws = src("components/create/CreateWorkspace.tsx");
    expect(ws).toContain('title={upload.kind === "uploading" || upload.kind === "paused" ? "Stop this upload?" : "Remove this video?"}');
    expect(ws).toContain('confirmLabel={upload.kind === "uploading" || upload.kind === "paused" ? "Stop upload" : "Remove video"}');
  });
  test("the assistant is a div with a role, since an aside can't be a dialog (axe aria-allowed-role on phone)", () => {
    const ws = src("components/create/CreateWorkspace.tsx");
    expect(ws).toContain('role={sheet ? "dialog" : "complementary"}');
    expect(ws).not.toContain("<aside");
    expect(ws).toContain("const drawerRef = useRef<HTMLDivElement>(null);");
  });
});

/**
 * R1329: crash reports from the Android app. POST /api/app/crash stores what a phone saved to disk, groups one bug
 * across phones by fingerprint, raises one admin event a day per new crash and prunes after 90 days. Same harness as
 * round-1294 (throwaway database, next/headers on the shared cookie jar).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { ALERT_WINDOW_MS, CRASH_EVENT, CrashBody, MAX_STACK, capStack, clampCrashedAt, fingerprintOf, groupCrashes, keyFrames, normalizeMessage, shortException, whereOf, type CrashRow } from "../lib/crash/core";

type Jar = Map<string, { value: string; opts: Record<string, unknown> }>;
const jar: Jar = ((globalThis as { __testCookieJar?: Jar }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

const APP = { "x-outlly-client": "android/3.6.2+17", "x-outlly-install": "r1329-install-0001" };
const EXC = "com.outlly.test.R1329BoomException";
const STACK = (line: number, extra = "") =>
  `${EXC}: Boom ${line}${extra}\n\tat com.outlly.app.ui.create.CreateViewModel.pick(CreateViewModel.kt:${line})\n\tat com.outlly.app.ui.create.CreateViewModel.takeShared(CreateViewModel.kt:333)\n\tat kotlinx.coroutines.flow.FlowKt.collect(Flow.kt:${line + 9})\n\tat android.os.Handler.handleCallback(Handler.java:942)`;
const report = (o: Partial<Record<string, unknown>> = {}) => ({ crashedAt: "2026-11-25T06:30:00.000Z", version: "3.6.2", build: 17, sdk: 33, device: "samsung SM-N981B", exception: EXC, message: "Boom 540", stack: STACK(540), thread: "main", screen: "create", ...o });

let db: typeof import("../lib/db").db;
let auth: typeof import("../lib/auth");
let server: typeof import("../lib/crash/server");
let SESSION_COOKIE = "";
const R: Record<string, any> = {};
const users: string[] = [];
let n = 0;

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  auth = await import("../lib/auth");
  server = await import("../lib/crash/server");
  SESSION_COOKIE = (await import("../lib/session-cookie")).SESSION_COOKIE;
  R.crash = await import("../app/api/app/crash/route");
}, 60_000);

afterAll(async () => {
  jar.clear();
  await db.appCrash.deleteMany({ where: { OR: [{ userId: { in: users } }, { exception: { startsWith: "com.outlly.test.R1329" } }] } });
  await db.adminEvent.deleteMany({ where: { kind: CRASH_EVENT, title: { contains: "R1329" } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
});

const uniq = (tag: string) => `r1329-${tag}-${Date.now()}-${++n}@test.dev`;
async function mkUser(tag: string) {
  const u = await db.user.create({ data: { name: `R1329 ${tag}`, email: uniq(tag), passwordHash: await auth.hashPassword("old-password-1") } });
  users.push(u.id);
  return u;
}
async function signInAs(id: string) {
  jar.clear();
  await auth.createSession(id);
  return jar.get(SESSION_COOKIE)!.value;
}
function req(path: string, o: { method?: string; body?: unknown; headers?: Record<string, string>; ip?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost", "x-forwarded-for": o.ip ?? "10.13.29.1", ...(o.body !== undefined ? { "content-type": "application/json" } : {}), ...o.headers };
  const s = jar.get(SESSION_COOKIE)?.value;
  if (s) headers.cookie = `${SESSION_COOKIE}=${s}`;
  return new NextRequest(`http://localhost${path}`, { method: o.method ?? "POST", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
}
const call = async (h: (r: NextRequest, c: never) => Promise<Response>, r: NextRequest) => {
  const res = await h(r, { params: {} } as never);
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
};
const events = () => db.adminEvent.count({ where: { kind: CRASH_EVENT, title: { contains: "R1329" } } });

describe("1. core: fingerprint, frames, caps", () => {
  test("the same bug on two phones is one fingerprint: line numbers and numbers in the message do not count", () => {
    const a = fingerprintOf(report());
    const b = fingerprintOf(report({ message: "Boom 913", stack: STACK(913) }));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
  test("a different exception or a different top frame is a different fingerprint", () => {
    expect(fingerprintOf(report({ exception: "java.lang.IllegalStateException" }))).not.toBe(fingerprintOf(report()));
    expect(fingerprintOf(report({ stack: STACK(540).replace("CreateViewModel.pick", "HomeViewModel.load") }))).not.toBe(fingerprintOf(report()));
  });
  test("key frames prefer the app's own code and fall back to any frames", () => {
    expect(keyFrames(STACK(1))).toEqual(["com.outlly.app.ui.create.CreateViewModel.pick", "com.outlly.app.ui.create.CreateViewModel.takeShared"]);
    expect(keyFrames("x\n\tat a.b.C.d(SourceFile:1)\n\tat e.f.G.h(SourceFile:2)")).toEqual(["a.b.C.d", "e.f.G.h"]);
    expect(keyFrames("no frames here")).toEqual([]);
  });
  test("message normalisation and the short names the table shows", () => {
    expect(normalizeMessage("Index 5 out of bounds for length 3 at 0x7f3a id 123e4567-e89b-12d3-a456-426614174000")).toBe("Index # out of bounds for length # at # id #");
    expect(shortException("kotlin.KotlinNullPointerException")).toBe("KotlinNullPointerException");
    expect(whereOf(STACK(1))).toBe("CreateViewModel.pick");
    expect(whereOf("\tat android.os.Handler.handleCallback(Handler.java:942)")).toBe("Handler.handleCallback");
  });
  test("stacks are cut at MAX_STACK and a phone clock in the future becomes now", () => {
    const cut = capStack("x".repeat(MAX_STACK + 500));
    expect(cut.length).toBeLessThan(MAX_STACK + 60);
    expect(cut.endsWith("characters)")).toBe(true);
    expect(capStack("short")).toBe("short");
    const now = new Date("2026-11-25T07:00:00Z");
    expect(clampCrashedAt("2026-11-26T07:00:00Z", now).getTime()).toBe(now.getTime());
    expect(clampCrashedAt("2026-11-20T07:00:00Z", now).toISOString()).toBe("2026-11-20T07:00:00.000Z");
    expect(clampCrashedAt("garbage", now).getTime()).toBe(now.getTime());
    expect(clampCrashedAt("1970-01-01T00:00:05Z", now).getTime()).toBe(now.getTime());
    expect(clampCrashedAt("2026-08-28T07:00:00Z", now).toISOString()).toBe("2026-08-28T07:00:00.000Z");
  });
  test("body shape: 1 to 10 reports, a real version, a non-empty stack", () => {
    expect(CrashBody.safeParse({ reports: [report()] }).success).toBe(true);
    expect(CrashBody.safeParse({ reports: [] }).success).toBe(false);
    expect(CrashBody.safeParse({ reports: Array.from({ length: 11 }, () => report()) }).success).toBe(false);
    expect(CrashBody.safeParse({ reports: [report({ version: "3.6" })] }).success).toBe(false);
    expect(CrashBody.safeParse({ reports: [report({ stack: "" })] }).success).toBe(false);
    expect(CrashBody.safeParse({ reports: [report({ crashedAt: "yesterday" })] }).success).toBe(false);
  });
  test("grouping: count, distinct people, versions by count, latest sample first", () => {
    const row = (o: Partial<CrashRow>): CrashRow => ({ id: "x", userId: "u1", platform: "android", version: "3.6.2", build: 17, sdk: 33, device: null, fingerprint: "f1", exception: EXC, message: null, stack: STACK(1), thread: null, screen: null, crashedAt: new Date("2026-11-25T01:00:00Z"), ...o });
    const g = groupCrashes([
      row({ id: "a" }),
      row({ id: "b", userId: "u2", version: "3.6.1", crashedAt: new Date("2026-11-25T03:00:00Z") }),
      row({ id: "c", userId: "u2", crashedAt: new Date("2026-11-24T01:00:00Z") }),
      row({ id: "d", fingerprint: "f2", exception: "java.lang.IllegalStateException", crashedAt: new Date("2026-11-25T05:00:00Z") }),
    ]);
    expect(g.map((x) => x.fingerprint)).toEqual(["f1", "f2"]);
    expect(g[0].count).toBe(3);
    expect(g[0].people).toBe(2);
    expect(g[0].versions).toEqual([{ version: "3.6.2", count: 2 }, { version: "3.6.1", count: 1 }]);
    expect(g[0].sample.id).toBe("b");
    expect(g[0].firstAt.toISOString()).toBe("2026-11-24T01:00:00.000Z");
    expect(g[0].lastAt.toISOString()).toBe("2026-11-25T03:00:00.000Z");
    expect(g[0].exception).toBe("R1329BoomException");
    expect(g[0].where).toBe("CreateViewModel.pick");
  });
});

describe("2. POST /api/app/crash", () => {
  test("signed out: 401", async () => {
    jar.clear();
    const r = await call(R.crash.POST, req("/api/app/crash", { body: { reports: [report()] }, headers: APP }));
    expect(r.status).toBe(401);
  });
  test("stores the reports with platform, install id, fingerprint and one admin event for the new crash", async () => {
    const u = await mkUser("post");
    await signInAs(u.id);
    const before = await events();
    const r = await call(R.crash.POST, req("/api/app/crash", { body: { reports: [report(), report({ message: "Boom 913", stack: STACK(913), crashedAt: "2026-11-25T06:40:00.000Z" })] }, headers: APP }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, stored: 2, dropped: 0 });
    expect(r.body.alerted).toHaveLength(1);
    const rows = await db.appCrash.findMany({ where: { userId: u.id }, orderBy: { crashedAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ platform: "android", version: "3.6.2", build: 17, sdk: 33, installId: "r1329-install-0001", exception: EXC, screen: "create", thread: "main" });
    expect(rows[0].fingerprint).toBe(rows[1].fingerprint);
    expect(rows[0].crashedAt.toISOString()).toBe("2026-11-25T06:30:00.000Z");
    expect(await events()).toBe(before + 1);
    const ev = await db.adminEvent.findFirst({ where: { kind: CRASH_EVENT, title: { contains: "R1329" } }, orderBy: { createdAt: "desc" } });
    expect(ev?.title).toBe("Android app crashed: R1329BoomException");
    expect(ev?.body).toBe("CreateViewModel.pick · v3.6.2 · samsung SM-N981B");
    expect(ev?.href).toBe("/admin/app-analytics?tab=crashes");
  });
  test("the same crash again within a day stores but does not alert again; a new one does", async () => {
    const u = await mkUser("again");
    await signInAs(u.id);
    const before = await events();
    const r1 = await call(R.crash.POST, req("/api/app/crash", { body: { reports: [report({ message: "Boom 7", stack: STACK(7) })] }, headers: APP }));
    expect(r1.body.stored).toBe(1);
    expect(await events()).toBe(before); // first test raised this fingerprint minutes ago
    const r2 = await call(R.crash.POST, req("/api/app/crash", { body: { reports: [report({ exception: "com.outlly.test.R1329OtherException", message: "other", stack: STACK(1).replace(EXC, "com.outlly.test.R1329OtherException") })] }, headers: APP }));
    expect(r2.body.alerted).toHaveLength(1);
    expect(await events()).toBe(before + 1);
  });
  test("eleven reports: 400 VALIDATION; a same-origin caller with no client header is still an android report", async () => {
    const u = await mkUser("eleven");
    await signInAs(u.id);
    const r = await call(R.crash.POST, req("/api/app/crash", { body: { reports: Array.from({ length: 11 }, () => report()) }, headers: APP }));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION");
    const ok = await call(R.crash.POST, req("/api/app/crash", { body: { reports: [report()] }, headers: { origin: "http://localhost" } }));
    expect(ok.status).toBe(200);
    expect((await db.appCrash.findFirst({ where: { userId: u.id } }))?.platform).toBe("android");
  });
  test("the per-day cap drops the overflow and says so", async () => {
    const u = await mkUser("cap");
    const now = new Date("2026-11-25T10:00:00Z");
    const r = await server.recordCrashes({ userId: u.id, installId: null, platform: "android", reports: [report(), report(), report()] as never, now, cap: 2 });
    expect(r).toMatchObject({ stored: 2, dropped: 1 });
    const again = await server.recordCrashes({ userId: u.id, installId: null, platform: "android", reports: [report()] as never, now, cap: 2 });
    expect(again).toMatchObject({ stored: 0, dropped: 1, alerted: [] });
    expect(await db.appCrash.count({ where: { userId: u.id } })).toBe(2);
  });
});

describe("3. groups and housekeeping", () => {
  test("crashGroups reads the range on the phone's day and filters by platform", async () => {
    const u = await mkUser("groups");
    const now = new Date("2026-11-25T10:00:00Z");
    await server.recordCrashes({ userId: u.id, installId: null, platform: "ios", reports: [report({ exception: "com.outlly.test.R1329IosException", crashedAt: "2026-11-25T01:00:00Z" })] as never, now });
    const all = await server.crashGroups({ from: "2026-11-25", to: "2026-11-25", platform: "all" });
    expect(all.some((g) => g.exception === "R1329IosException" && g.platform === "ios")).toBe(true);
    expect(all.some((g) => g.exception === "R1329BoomException")).toBe(true);
    const ios = await server.crashGroups({ from: "2026-11-25", to: "2026-11-25", platform: "ios" });
    expect(ios.every((g) => g.platform === "ios")).toBe(true);
    const none = await server.crashGroups({ from: "2026-01-01", to: "2026-01-02", platform: "all" });
    expect(none.some((g) => g.exception.startsWith("R1329"))).toBe(false);
  });
  test("sweepCrashes prunes rows older than 90 days and keeps the rest", async () => {
    const u = await mkUser("sweep");
    const now = new Date("2026-11-25T10:00:00Z");
    const old = await db.appCrash.create({ data: { userId: u.id, platform: "android", version: "3.0.0", fingerprint: "r1329old", exception: "com.outlly.test.R1329OldException", stack: "x", crashedAt: new Date(now.getTime() - 100 * 86_400_000), createdAt: new Date(now.getTime() - 91 * 86_400_000) } });
    const fresh = await db.appCrash.create({ data: { userId: u.id, platform: "android", version: "3.0.0", fingerprint: "r1329fresh", exception: "com.outlly.test.R1329FreshException", stack: "x", crashedAt: now, createdAt: new Date(now.getTime() - 89 * 86_400_000) } });
    const r = await server.sweepCrashes(now);
    expect(r.pruned).toBeGreaterThanOrEqual(1);
    expect(await db.appCrash.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.appCrash.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });
  test("the alert window is a day", () => {
    expect(ALERT_WINDOW_MS).toBe(86_400_000);
  });
});

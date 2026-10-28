/**
 * 1028 smarter retries + sweeper heartbeat: the retry schedule and its jitter, the platform's own wait hints,
 * Meta's HTTP 400 throttles, and the "sweeper has gone quiet" check behind the admin warning.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { httpFailure, retryAfterMs } from "../lib/social/types";

let h: typeof import("../lib/queue/handlers");
let health: typeof import("../lib/queue/health");
let db: typeof import("../lib/db").db;
beforeAll(async () => {
  h = await import("../lib/queue/handlers");
  health = await import("../lib/queue/health");
  ({ db } = await import("../lib/db"));
}, 60_000);

describe("retryDelay", () => {
  test("follows the schedule exactly with no jitter", () => {
    expect(h.RETRY_DELAYS_MS.map((_, i) => h.retryDelay(i, {}, () => 0.5))).toEqual([2_000, 10_000, 30_000, 120_000, 300_000]);
  });
  test("jitter stays within +-15%", () => {
    expect(h.retryDelay(2, {}, () => 0)).toBe(25_500);
    expect(h.retryDelay(2, {}, () => 0.999999)).toBeLessThanOrEqual(34_500);
    expect(h.retryDelay(2, {}, () => 0.999999)).toBeGreaterThan(34_000);
  });
  test("never shorter than what the platform asked for", () => {
    expect(h.retryDelay(0, { retryAfterMs: 90_000 }, () => 0.5)).toBe(90_000);
    expect(h.retryDelay(4, { retryAfterMs: 1_000 }, () => 0.5)).toBe(300_000);
  });
});

describe("statusDelay", () => {
  test("ramps from 3 s to a 30 s cap", () => {
    expect(h.statusDelay(0)).toBe(3000);
    expect(h.statusDelay(1)).toBe(4500);
    expect(h.statusDelay(20)).toBe(30_000);
  });
  test("without Redis a long platform wait is capped so the timer isn't dropped", () => {
    expect(h.statusDelay(0, 5 * 60_000)).toBe(40_000);
  });
});

describe("retryAfterMs reads the platform's wait hint", () => {
  const now = Date.UTC(2026, 9, 28, 12, 0, 0);
  const hdr = (o: Record<string, string>) => new Headers(o);
  test("Retry-After in seconds", () => expect(retryAfterMs(hdr({ "retry-after": "30" }), now)).toBe(30_000));
  test("Retry-After as an HTTP date", () => expect(retryAfterMs(hdr({ "retry-after": new Date(now + 90_000).toUTCString() }), now)).toBe(90_000));
  test("a Retry-After date in the past is zero, not negative", () => expect(retryAfterMs(hdr({ "retry-after": new Date(now - 60_000).toUTCString() }), now)).toBe(0));
  test("X's x-rate-limit-reset (epoch seconds)", () => expect(retryAfterMs(hdr({ "x-rate-limit-reset": String(now / 1000 + 120) }), now)).toBe(120_000));
  test("Meta's estimated_time_to_regain_access (minutes), the largest one wins", () => {
    const buc = JSON.stringify({ "123": [{ type: "instagram", call_count: 100, estimated_time_to_regain_access: 3 }, { type: "pages", estimated_time_to_regain_access: 7 }] });
    expect(retryAfterMs(hdr({ "x-business-use-case-usage": buc }), now)).toBe(7 * 60_000);
  });
  test("a 13-digit x-rate-limit-reset is read as milliseconds", () => expect(retryAfterMs(hdr({ "x-rate-limit-reset": String(now + 60_000) }), now)).toBe(60_000));
  test("no hint is undefined", () => expect(retryAfterMs(hdr({ "content-type": "application/json" }), now)).toBeUndefined());
  test("junk is ignored", () => expect(retryAfterMs(hdr({ "retry-after": "soon", "x-rate-limit-reset": "12" }), now)).toBeUndefined());
});

describe("httpFailure: Meta throttles and transient faults", () => {
  const meta = (code: number, extra = "") => JSON.stringify({ error: { message: "Application request limit reached", type: "OAuthException", code, fbtrace_id: "Abc" } }).replace("}}", `${extra}}}`);
  const res = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers });

  for (const code of [4, 17, 32, 613, 80001, 80014]) {
    test(`Meta code ${code} on a 400 is RATE_LIMITED and retryable`, async () => {
      const e = await httpFailure(res(400, meta(code)), "ig publish");
      expect(e.code).toBe("RATE_LIMITED");
      expect(e.retryable).toBe(true);
    });
  }
  test("a 403 Meta throttle is not mistaken for an expired token", async () => {
    const e = await httpFailure(res(403, meta(4)), "fb publish");
    expect(e.code).toBe("RATE_LIMITED");
  });
  test("the wait hint rides along on the error", async () => {
    const e = await httpFailure(res(400, meta(17), { "x-app-usage": '{"call_count":100,"estimated_time_to_regain_access":2}' }), "ig");
    expect(e.retryAfterMs).toBe(120_000);
  });
  test("X's code 32 (bad auth) is still AUTH_EXPIRED, not a throttle", async () => {
    const e = await httpFailure(res(401, JSON.stringify({ errors: [{ code: 32, message: "Could not authenticate you." }] })), "x");
    expect(e.code).toBe("AUTH_EXPIRED");
  });
  test("a non-Meta 400 with code 4 is still media rejected", async () => {
    const e = await httpFailure(res(400, JSON.stringify({ error: { code: 4, message: "bad video" } })), "yt");
    expect(e.code).toBe("MEDIA_REJECTED");
  });
  test("Meta is_transient is PLATFORM_DOWN and retryable", async () => {
    const e = await httpFailure(res(400, meta(2, ',"is_transient":true')), "ig");
    expect(e.code).toBe("PLATFORM_DOWN");
    expect(e.retryable).toBe(true);
  });
  test("Meta token error 190 is still AUTH_EXPIRED", async () => {
    const e = await httpFailure(res(400, meta(190)), "ig");
    expect(e.code).toBe("AUTH_EXPIRED");
  });
  test("429 carries Retry-After", async () => {
    const e = await httpFailure(res(429, "slow down", { "retry-after": "45" }), "x");
    expect(e.retryAfterMs).toBe(45_000);
  });
});

describe("sweeper heartbeat", () => {
  test("expectedSource: Redis -> worker, Vercel -> cron, else in-process", () => {
    expect(health.expectedSource({ REDIS_URL: "redis://x", VERCEL: "1" })).toBe("worker");
    expect(health.expectedSource({ VERCEL: "1" })).toBe("cron");
    expect(health.expectedSource({})).toBe("inproc");
  });
  test("never ran is stale; a fresh sweep is healthy; quiet for over 3 minutes is stale again", async () => {
    await db.setting.deleteMany({ where: { key: "sweeper:last:cron" } });
    const t0 = Date.now();
    expect(await health.sweeperHealth(t0, "cron")).toMatchObject({ source: "cron", lastAt: null, stale: true });
    await health.recordSweep("cron", t0);
    expect(await health.sweeperHealth(t0 + 60_000, "cron")).toMatchObject({ lastAt: t0, stale: false });
    expect((await health.sweeperHealth(t0 + health.SWEEP_STALE_MS + 1, "cron")).stale).toBe(true);
  });
  test("sources are tracked separately, so a warm in-process tick can't hide a missing pinger", async () => {
    await db.setting.deleteMany({ where: { key: { in: ["sweeper:last:cron", "sweeper:last:inproc"] } } });
    await health.recordSweep("inproc");
    expect((await health.sweeperHealth(Date.now(), "cron")).stale).toBe(true);
    expect((await health.sweeperHealth(Date.now(), "inproc")).stale).toBe(false);
  });
  test("late posts: overdue scheduled posts count, ones waiting for approval do not", async () => {
    const before = (await health.sweeperHealth(Date.now(), "cron")).latePosts;
    const u = await db.user.create({ data: { name: "H", email: `h28-${Date.now()}@test.dev`, passwordHash: "x" } });
    const m = await db.media.create({ data: { userId: u.id, storageKey: "k/h.mp4", originalFilename: "a.mp4", mimeType: "video/mp4", size: 1, status: "ready" } });
    const past = new Date(Date.now() - 10 * 60_000);
    await db.post.create({ data: { userId: u.id, mediaId: m.id, status: "scheduled", scheduledAt: past } });
    await db.post.create({ data: { userId: u.id, mediaId: m.id, status: "scheduled", scheduledAt: past, requireApproval: true } });
    await db.post.create({ data: { userId: u.id, mediaId: m.id, status: "scheduled", scheduledAt: new Date(Date.now() + 3600_000) } });
    expect((await health.sweeperHealth(Date.now(), "cron")).latePosts).toBe(before + 1);
  });
});

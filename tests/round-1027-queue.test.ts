/**
 * 1027 queue hardening: stuck targets are recovered, a settled target is never overwritten, token refresh is
 * single-flight and race-safe, the sweeper refreshes only near expiry, plus the billing and caption fixes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

type Job = { name: string; data: any; opts?: { delayMs?: number; jobId?: string } };
const g = globalThis as unknown as { __queueBackend?: unknown };
let jobs: Job[] = [];
let savedBackend: unknown;

let db: typeof import("../lib/db").db;
let h: typeof import("../lib/queue/handlers");
let acc: typeof import("../lib/live/account");
let keys: typeof import("../lib/social/keys");
let svc: typeof import("../lib/billing/service");
let enc: (s: string) => string;
let dec: (s: string) => string;
let n = 0;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  savedBackend = g.__queueBackend;
  g.__queueBackend = { add: async (name: string, data: unknown, opts?: Job["opts"]) => void jobs.push({ name, data, opts }) };
  ({ db } = await import("../lib/db"));
  h = await import("../lib/queue/handlers");
  acc = await import("../lib/live/account");
  keys = await import("../lib/social/keys");
  svc = await import("../lib/billing/service");
  ({ encrypt: enc, decrypt: dec } = await import("../lib/crypto"));
}, 60_000);

afterEach(() => {
  globalThis.fetch = realFetch;
  keys.__setKeys(undefined);
});
afterAll(() => {
  g.__queueBackend = savedBackend;
});

async function target(platformStatus: string, extra: Record<string, unknown> = {}, acctExtra: Record<string, unknown> = {}) {
  const u = await db.user.create({ data: { name: `Q ${++n}`, email: `q27-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: u.id, storageKey: `sample/q${n}.mp4`, originalFilename: "a.mp4", mimeType: "video/mp4", size: 10, status: "ready" } });
  const acct = await db.socialAccount.create({ data: { userId: u.id, platform: "x", platformUserId: `real-q${n}`, username: "@me", accessToken: enc("tok"), refreshToken: enc("rt"), status: "connected", ...acctExtra } });
  const post = await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "publishing", title: "Clip" } });
  const t = await db.postTarget.create({ data: { postId: post.id, platform: "x", socialAccountId: acct.id, platformStatus, ...extra } });
  return { u, acct, post, t };
}
const row = (id: string) => db.postTarget.findUniqueOrThrow({ where: { id } });
const mine = (id: string) => jobs.filter((j) => j.data?.targetId === id);
const LATER = () => Date.now() + 20 * 60_000; // the sweep "runs" 20 minutes from now

describe("stuck targets are handed back to the queue", () => {
  test("uploading with no progress for 15 min restarts the upload and counts the restart", async () => {
    jobs = [];
    const { t } = await target("uploading");
    await h.requeueStuckTargets(120_000, LATER());
    expect(mine(t.id).map((j) => j.name)).toEqual(["SOCIAL_UPLOAD"]);
    expect((await row(t.id)).attempts).toBe(1);
  });

  test("an upload that is still moving is left alone", async () => {
    jobs = [];
    const { t } = await target("uploading");
    await h.requeueStuckTargets(120_000, Date.now() + 60_000);
    expect(mine(t.id)).toEqual([]);
  });

  test("an upload that keeps dying is failed instead of looping", async () => {
    jobs = [];
    const { t } = await target("uploading", { attempts: 6 });
    await h.requeueStuckTargets(120_000, LATER());
    expect(mine(t.id)).toEqual([]);
    const r = await row(t.id);
    expect(r.platformStatus).toBe("failed");
    expect(r.errorCode).toBe("PLATFORM_DOWN");
  });

  test("processing before the publish call re-runs the publish", async () => {
    jobs = [];
    const { t } = await target("processing", { uploadRef: "media-1" });
    await h.requeueStuckTargets(120_000, LATER());
    expect(mine(t.id).map((j) => j.name)).toEqual(["SOCIAL_PUBLISH"]);
  });

  test("processing after the publish call only checks status, never publishes twice", async () => {
    jobs = [];
    const { t } = await target("processing", { uploadRef: "media-2", publishRequestedAt: new Date() });
    await h.requeueStuckTargets(120_000, LATER());
    expect(mine(t.id).map((j) => j.name)).toEqual(["SOCIAL_STATUS_CHECK"]);
    expect(mine(t.id)[0].data.poll).toBe(0);
  });

  test("processing for hours after publish gives up so the creator can retry", async () => {
    jobs = [];
    const { t } = await target("processing", { uploadRef: "media-3", publishRequestedAt: new Date(Date.now() - 4 * 3600_000) });
    await h.requeueStuckTargets(120_000, LATER());
    const r = await row(t.id);
    expect(r.platformStatus).toBe("failed");
    expect(r.errorMessage).toMatch(/hadn't confirmed/);
  });

  test("two sweepers at once requeue a stuck target once", async () => {
    jobs = [];
    const { t } = await target("uploading");
    const at = LATER();
    await Promise.all([h.requeueStuckTargets(120_000, at), h.requeueStuckTargets(120_000, at)]);
    expect(mine(t.id).length).toBe(1);
    expect((await row(t.id)).attempts).toBe(1);
  });
});

describe("a settled target is never overwritten", () => {
  test("a late failure can't turn a published target into failed", async () => {
    const { t, post } = await target("published", { platformPostId: "p1", publishedAt: new Date() });
    expect(await h.setTarget(t.id, post.id, "failed", { errorCode: "UNKNOWN" })).toBe(false);
    expect((await row(t.id)).platformStatus).toBe("published");
  });

  test("a late failure can't replace the creator's Stop", async () => {
    const { t, post } = await target("failed", { errorCode: "CANCELED" });
    expect(await h.setTarget(t.id, post.id, "failed", { errorCode: "NETWORK" })).toBe(false);
    expect((await row(t.id)).errorCode).toBe("CANCELED");
  });

  test("a platform confirmation still lands after a Stop (the truth wins)", async () => {
    const { t, post } = await target("failed", { errorCode: "CANCELED" });
    expect(await h.setTarget(t.id, post.id, "published", { platformPostId: "p2", errorCode: null })).toBe(true);
    expect((await row(t.id)).platformStatus).toBe("published");
  });
});

describe("token refresh", () => {
  const soon = () => new Date(Date.now() + 60_000);
  const ok = (token: string) => new Response(JSON.stringify({ access_token: token, refresh_token: `${token}-rt`, expires_in: 7200 }));

  test("two callers at once share one refresh", async () => {
    keys.__setKeys({ x: { clientId: "cid", clientSecret: "sec" } } as never);
    const { acct } = await target("queued", {}, { tokenExpiresAt: soon() });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return ok("new-1");
    }) as unknown as typeof fetch;
    const [a, b] = await Promise.all([acc.freshAccount(acct), acc.freshAccount(acct)]);
    expect(calls).toBe(1);
    expect(dec(a.accessToken)).toBe("new-1");
    expect(dec(b.accessToken)).toBe("new-1");
  });

  test("a row another instance already refreshed is used, not refreshed again", async () => {
    keys.__setKeys({ x: { clientId: "cid", clientSecret: "sec" } } as never);
    const { acct } = await target("queued", {}, { tokenExpiresAt: soon() });
    await db.socialAccount.update({ where: { id: acct.id }, data: { accessToken: enc("other"), tokenExpiresAt: new Date(Date.now() + 2 * 3600_000) } });
    let calls = 0;
    globalThis.fetch = (async () => (calls++, ok("x"))) as unknown as typeof fetch;
    const r = await acc.freshAccount(acct); // stale copy says "expiring"
    expect(calls).toBe(0);
    expect(dec(r.accessToken)).toBe("other");
  });

  test("losing a rotation race uses the winner's token and keeps the account connected", async () => {
    keys.__setKeys({ x: { clientId: "cid", clientSecret: "sec" } } as never);
    const { acct } = await target("queued", {}, { tokenExpiresAt: soon() });
    globalThis.fetch = (async () => {
      await db.socialAccount.update({ where: { id: acct.id }, data: { accessToken: enc("winner") } });
      return new Response(JSON.stringify({ error: "invalid_request", error_description: "Value passed for the token was invalid." }), { status: 400 });
    }) as unknown as typeof fetch;
    const r = await acc.freshAccount(acct);
    expect(dec(r.accessToken)).toBe("winner");
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id: acct.id } })).status).toBe("connected");
  });

  test("a refused refresh is AUTH_EXPIRED and asks for a reconnect (it used to read as 'media rejected')", async () => {
    keys.__setKeys({ x: { clientId: "cid", clientSecret: "sec" } } as never);
    const { acct } = await target("queued", {}, { tokenExpiresAt: soon() });
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
    const e = await acc.freshAccount(acct).then(() => null, (err) => err as { code?: string });
    expect(e?.code).toBe("AUTH_EXPIRED");
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id: acct.id } })).status).toBe("needs_reconnect");
  });

  test("a network blip during refresh is retryable and leaves the account alone", async () => {
    keys.__setKeys({ x: { clientId: "cid", clientSecret: "sec" } } as never);
    const { acct } = await target("queued", {}, { tokenExpiresAt: soon() });
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const e = await acc.freshAccount(acct).then(() => null, (err) => err as { code?: string; retryable?: boolean });
    expect(e?.retryable).toBe(true);
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id: acct.id } })).status).toBe("connected");
  });

  test("the sweeper refreshes only accounts near expiry, once per 10-minute window", async () => {
    const near = await target("queued", {}, { tokenExpiresAt: new Date(Date.now() + 10 * 60_000) });
    const far = await target("queued", {}, { tokenExpiresAt: new Date(Date.now() + 5 * 3600_000) });
    jobs = [];
    await h.sweepDuePosts();
    const refresh = jobs.filter((j) => j.name === "TOKEN_REFRESH");
    expect(refresh.some((j) => j.data.accountId === near.acct.id)).toBe(true);
    expect(refresh.some((j) => j.data.accountId === far.acct.id)).toBe(false);
    const id = refresh.find((j) => j.data.accountId === near.acct.id)!.opts!.jobId!;
    expect(id).toMatch(new RegExp(`^refresh-${near.acct.id}-\\d+$`));
  });
});

describe("billing carry-over", () => {
  const now = new Date("2026-10-27T00:00:00Z");
  const end = (days: number) => new Date(now.getTime() + days * 86_400_000);
  const DAY = 86_400_000;

  test("upgrading keeps the paid time left, converted at the new price", () => {
    const ms = svc.carryOverMs({ priceMinor: 49900, currency: "INR", interval: "month", currentPeriodEnd: end(15), sample: false }, { priceMinor: 149900, currency: "INR", interval: "month", sample: false }, now);
    expect(Math.round(ms / DAY)).toBe(5); // 15 days of Creator ~ 5 days of Studio
  });

  test("monthly to yearly on the same plan keeps every day left", () => {
    const ms = svc.carryOverMs({ priceMinor: 49900, currency: "INR", interval: "month", currentPeriodEnd: end(20), sample: false }, { priceMinor: 548900, currency: "INR", interval: "year", sample: false }, now);
    expect(Math.round(ms / DAY)).toBe(20);
  });

  test("a downgrade keeps its days but never multiplies them", () => {
    const ms = svc.carryOverMs({ priceMinor: 149900, currency: "INR", interval: "month", currentPeriodEnd: end(10), sample: false }, { priceMinor: 49900, currency: "INR", interval: "month", sample: false }, now);
    expect(Math.round(ms / DAY)).toBe(10);
  });

  test("nothing carries over from a free period, a sample, another currency or an ended period", () => {
    const next = { priceMinor: 49900, currency: "INR", interval: "month", sample: false };
    expect(svc.carryOverMs({ priceMinor: 0, currency: "INR", interval: "month", currentPeriodEnd: end(30), sample: false }, next, now)).toBe(0);
    expect(svc.carryOverMs({ priceMinor: 49900, currency: "INR", interval: "month", currentPeriodEnd: end(30), sample: true }, next, now)).toBe(0);
    expect(svc.carryOverMs({ priceMinor: 599, currency: "USD", interval: "month", currentPeriodEnd: end(30), sample: false }, next, now)).toBe(0);
    expect(svc.carryOverMs({ priceMinor: 49900, currency: "INR", interval: "month", currentPeriodEnd: end(-1), sample: false }, next, now)).toBe(0);
    expect(svc.carryOverMs(null, next, now)).toBe(0);
  });
});

describe("AI caption slot", () => {
  test("release() after a failed transcription gives the video slot back", async () => {
    const ent = await import("../lib/billing/entitlements");
    const u = await db.user.create({ data: { name: "Cap", email: `cap27-${Date.now()}@test.dev`, passwordHash: "x" } });
    const before = (await ent.captionUsage(u.id)).used;
    const slot = await ent.assertCaptionVideo(u.id, "fail.mp4:60");
    expect((await ent.captionUsage(u.id)).used).toBe(before + 1);
    await slot.release();
    expect((await ent.captionUsage(u.id)).used).toBe(before);
  });
});

describe("help chat for visitors", () => {
  test("ai:false answers from the help centre without calling the model", async () => {
    const { env } = await import("../lib/env");
    const e = env as unknown as Record<string, string>;
    const key = e.GEMINI_API_KEY;
    e.GEMINI_API_KEY = "fake-key";
    let calls = 0;
    globalThis.fetch = (async () => (calls++, new Response("{}"))) as unknown as typeof fetch;
    try {
      const bot = await import("../lib/support/bot");
      const r = await bot.answer("how do I reset my password", [], "en", { signedIn: false, ai: false });
      expect(calls).toBe(0);
      expect(r.answer.length).toBeGreaterThan(0);
    } finally {
      e.GEMINI_API_KEY = key;
    }
  });
});

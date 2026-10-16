/**
 * 10-16 backend round, against the throwaway test database: time zones on signup, the daily AI cap,
 * the launch claim, the data export (no secrets) and account deletion.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let env: typeof import("../lib/env").env;
let quota: typeof import("../lib/ai-quota");
let account: typeof import("../lib/account");
let services: typeof import("../lib/services");
let provider: typeof import("../lib/auth-provider");
let encrypt: typeof import("../lib/crypto").encrypt;
let prune: typeof import("../lib/retention/prune");

type Job = { name: string; data: unknown; opts?: { jobId?: string } };
const g = globalThis as unknown as { __queueBackend?: unknown };
let jobs: Job[] = [];
let previousBackend: unknown;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  ({ env } = await import("../lib/env"));
  quota = await import("../lib/ai-quota");
  account = await import("../lib/account");
  services = await import("../lib/services");
  provider = await import("../lib/auth-provider");
  ({ encrypt } = await import("../lib/crypto"));
  prune = await import("../lib/retention/prune");
  previousBackend = g.__queueBackend;
  g.__queueBackend = { add: async (name: string, data: unknown, opts?: Job["opts"]) => void jobs.push({ name, data, opts }) };
}, 60_000);

afterAll(() => {
  g.__queueBackend = previousBackend;
});

let n = 0;
const mk = (tag: string, extra: Record<string, unknown> = {}) =>
  db.user.create({ data: { name: `B ${tag}`, email: `b-${tag}-${++n}-${Date.now()}@test.dev`, passwordHash: "hashed-secret", ...extra } });

describe("validTimezone", () => {
  test("keeps a zone we can format with", () => {
    expect(provider.validTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(provider.validTimezone("  Europe/Berlin  ")).toBe("Europe/Berlin");
    expect(provider.validTimezone("UTC")).toBe("UTC");
  });
  test("refuses anything else instead of storing it", () => {
    for (const bad of ["", "   ", "Not/AZone", "'; drop table", "x".repeat(65), null, undefined]) expect(provider.validTimezone(bad)).toBeNull();
  });
  test("signup stores a valid zone and ignores a bad one", async () => {
    const good = await provider.signUp("Zoe", `tz-good-${Date.now()}@test.dev`, "password123", "Europe/Berlin");
    expect((await db.user.findUniqueOrThrow({ where: { id: good.id } })).timezone).toBe("Europe/Berlin");
    const bad = await provider.signUp("Zed", `tz-bad-${Date.now()}@test.dev`, "password123", "Mars/Olympus");
    expect((await db.user.findUniqueOrThrow({ where: { id: bad.id } })).timezone).toBe("Asia/Kolkata");
  });
});

describe("daily AI cap", () => {
  test("counts per person per UTC day and then answers 429 AI_QUOTA", async () => {
    const u = await mk("quota");
    const was = env.AI_DAILY_LIMIT;
    env.AI_DAILY_LIMIT = 2;
    try {
      expect(await quota.chargeAi(u.id)).toMatchObject({ used: 1, left: 1 });
      expect(await quota.chargeAi(u.id)).toMatchObject({ used: 2, left: 0 });
      const e = await quota.chargeAi(u.id).then(() => null, (err) => err);
      expect(e.status).toBe(429);
      expect(e.code).toBe("AI_QUOTA");
      expect(e.message).toBe("You've used today's AI help. It resets at midnight UTC.");
      expect(await quota.aiQuota(u.id)).toMatchObject({ used: 3, limit: 2, left: 0 });
    } finally {
      env.AI_DAILY_LIMIT = was;
    }
  });
  test("support chat has its own counter, and tomorrow starts fresh", async () => {
    const u = await mk("quota-support");
    const [wasAi, wasSupport] = [env.AI_DAILY_LIMIT, env.AI_SUPPORT_DAILY_LIMIT];
    env.AI_DAILY_LIMIT = 1;
    env.AI_SUPPORT_DAILY_LIMIT = 1;
    try {
      await quota.chargeAi(u.id, "ai");
      await quota.chargeAi(u.id, "support"); // not blocked by the writing-help counter
      expect((await quota.chargeAi(u.id, "support").then(() => null, (e) => e)).code).toBe("AI_QUOTA");
      const tomorrow = new Date(Date.now() + 864e5);
      expect(await quota.chargeAi(u.id, "support", tomorrow)).toMatchObject({ used: 1 });
      expect(quota.utcDay(new Date("2026-10-16T23:30:00Z"))).toBe("2026-10-16");
    } finally {
      env.AI_DAILY_LIMIT = wasAi;
      env.AI_SUPPORT_DAILY_LIMIT = wasSupport;
    }
  });
  test("a limit of 0 means no cap", async () => {
    const u = await mk("quota-off");
    const was = env.AI_DAILY_LIMIT;
    env.AI_DAILY_LIMIT = 0;
    try {
      for (let i = 0; i < 5; i++) await quota.chargeAi(u.id);
      expect(await db.aiUsage.count({ where: { userId: u.id } })).toBe(0);
    } finally {
      env.AI_DAILY_LIMIT = was;
    }
  });
});

async function launchable(tag: string) {
  const user = await mk(tag);
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `b/${user.id}.mp4`, mimeType: "video/mp4", size: 1000, duration: 10, width: 1080, height: 1920, status: "ready" } });
  const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, status: "draft" } });
  const acct = await db.socialAccount.create({ data: { userId: user.id, platform: "x", platformUserId: `real-x-${user.id}`, username: "u", accessToken: encrypt("tok"), status: "connected" } });
  await db.postTarget.create({ data: { postId: post.id, platform: "x", socialAccountId: acct.id, caption: "hi" } });
  return { user, post };
}

describe("launch claim", () => {
  test("a second launch of the same post is refused with 409", async () => {
    jobs = [];
    const f = await launchable("launch");
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    const e = await services.launchPost(f.user.id, f.post.id, "now", null, "smooth").then(() => null, (err) => err);
    expect(e.status).toBe(409);
    expect(jobs.filter((j) => j.name === "SOCIAL_UPLOAD").length).toBe(1);
  });
  test("two simultaneous launches: exactly one wins", async () => {
    jobs = [];
    const f = await launchable("launch-race");
    const out = await Promise.allSettled([
      services.launchPost(f.user.id, f.post.id, "now", null, "smooth"),
      services.launchPost(f.user.id, f.post.id, "now", null, "smooth"),
    ]);
    expect(out.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(jobs.filter((j) => j.name === "SOCIAL_UPLOAD").length).toBe(1);
    expect((await db.post.findUniqueOrThrow({ where: { id: f.post.id } })).status).toBe("publishing");
  });
});

describe("data export", () => {
  test("carries the creator's work and none of their secrets", async () => {
    const u = await mk("export", { totpSecret: "ENCRYPTED-TOTP-SECRET", recoveryCodes: '["hashed-recovery"]' });
    const media = await db.media.create({ data: { userId: u.id, originalFilename: "clip.mp4", storageKey: `x/${u.id}.mp4`, mimeType: "video/mp4", size: 2048, status: "ready" } });
    const post = await db.post.create({ data: { userId: u.id, mediaId: media.id, title: "My post", status: "draft" } });
    const acct = await db.socialAccount.create({ data: { userId: u.id, platform: "x", platformUserId: `px-${u.id}`, username: "mollie", accessToken: encrypt("super-secret-token"), refreshToken: encrypt("super-secret-refresh"), status: "connected" } });
    await db.postTarget.create({ data: { postId: post.id, platform: "x", socialAccountId: acct.id, caption: "hello world" } });
    await db.idea.create({ data: { userId: u.id, text: "film the bread run" } });
    await db.snippet.create({ data: { userId: u.id, kind: "caption", name: "Opener", body: "Here is the thing" } });

    const data = await account.exportUser(u.id);
    expect(data.profile.email).toBe(u.email);
    expect(data.posts[0].targets[0].caption).toBe("hello world");
    expect(data.accounts[0]).toEqual({ platform: "x", username: "mollie", displayName: null, status: "connected", createdAt: data.accounts[0].createdAt });
    expect(data.media[0].originalFilename).toBe("clip.mp4");
    expect(data.ideas.length).toBe(1);
    expect(data.snippets.length).toBe(1);

    const raw = JSON.stringify(data);
    for (const secret of ["passwordHash", "hashed-secret", "totpSecret", "ENCRYPTED-TOTP-SECRET", "recoveryCodes", "hashed-recovery", "accessToken", "refreshToken", encrypt("x").slice(0, 4)])
      expect(raw.includes(secret)).toBe(false);
  });
});

describe("account deletion", () => {
  test("refuses unless the confirmation matches the signed-in email", async () => {
    const u = await mk("delete-wrong");
    const me = { id: u.id, actor: null };
    const e = await account.deleteAccount(me, "someone-else@test.dev").then(() => null, (err) => err);
    expect(e.status).toBe(400);
    expect(e.code).toBe("CONFIRM");
    expect(await db.user.count({ where: { id: u.id } })).toBe(1);
  });
  test("a teammate inside someone else's studio can never delete it", async () => {
    const owner = await mk("delete-owner");
    const mate = await mk("delete-mate");
    const e = await account.deleteAccount({ id: owner.id, actor: { id: mate.id, name: "M", email: mate.email } }, owner.email).then(() => null, (err) => err);
    expect(e.status).toBe(403);
    expect(e.code).toBe("NOT_OWNER");
    expect(await db.user.count({ where: { id: owner.id } })).toBe(1);
  });
  test("the right email (any case) deletes the studio and everything under it", async () => {
    const u = await mk("delete-ok");
    const media = await db.media.create({ data: { userId: u.id, originalFilename: "a.mp4", storageKey: `gone/${u.id}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
    const post = await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "draft" } });
    await db.postTarget.create({ data: { postId: post.id, platform: "x", caption: "bye" } });
    await db.idea.create({ data: { userId: u.id, text: "an idea" } });
    expect(await account.deleteAccount({ id: u.id, actor: null }, u.email.toUpperCase())).toEqual({ ok: true });
    expect(await db.user.count({ where: { id: u.id } })).toBe(0);
    expect(await db.post.count({ where: { id: post.id } })).toBe(0);
    expect(await db.postTarget.count({ where: { postId: post.id } })).toBe(0);
    expect(await db.idea.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.media.count({ where: { id: media.id } })).toBe(0);
  });
});

describe("retention prune", () => {
  test("drops what is past its window and keeps the rest", async () => {
    const old = new Date(Date.now() - 200 * 864e5);
    const recent = new Date(Date.now() - 2 * 864e5);
    const stale = await db.emailLog.create({ data: { to: "a@test.dev", subject: "old", html: "", kind: "test", provider: "mock", status: "mocked", createdAt: old } });
    const fresh = await db.emailLog.create({ data: { to: "b@test.dev", subject: "new", html: "", kind: "test", provider: "mock", status: "mocked", createdAt: recent } });
    const oldCode = await db.otpCode.create({ data: { email: "a@test.dev", purpose: "login", codeHash: "h", expiresAt: old, createdAt: old } });
    const newCode = await db.otpCode.create({ data: { email: "b@test.dev", purpose: "login", codeHash: "h", expiresAt: new Date(Date.now() + 6e5) } });
    const out = await prune.pruneOldData();
    expect(out.emailLogs).toBeGreaterThanOrEqual(1);
    expect(await db.emailLog.count({ where: { id: stale.id } })).toBe(0);
    expect(await db.emailLog.count({ where: { id: fresh.id } })).toBe(1);
    expect(await db.otpCode.count({ where: { id: oldCode.id } })).toBe(0);
    expect(await db.otpCode.count({ where: { id: newCode.id } })).toBe(1);
  });
});

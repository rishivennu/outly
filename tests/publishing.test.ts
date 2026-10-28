/**
 * End-to-end publishing state machine against a real (throwaway SQLite) database.
 * The platform is a scripted fake; the queue is captured so each job runs explicitly and in order.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as realRegistry from "../lib/social/registry";
import { PublisherError, type RemoteState, type SocialPublisher } from "../lib/social/types";

/* ---------- fake platform ---------- */
type Step<T> = T | Error | (() => T | Promise<T>);
class FakePublisher implements SocialPublisher {
  readonly platform = "x" as const;
  calls: string[] = [];
  uploads: Step<string>[] = [];
  publishes: Step<RemoteState>[] = [];
  statuses: Step<RemoteState>[] = [];
  existing: { platformPostId: string; url?: string } | null = null;
  issues: { level: "error" | "warning"; message: string }[] = [];
  private async take<T>(q: Step<T>[], name: string): Promise<T> {
    this.calls.push(name);
    const s = q.shift();
    if (s === undefined) throw new Error(`fake: no scripted ${name}`);
    if (s instanceof Error) throw s;
    return typeof s === "function" ? (s as () => T)() : s;
  }
  async connect() { return { url: "", state: "" }; }
  async completeConnect(): Promise<never> { throw new Error("n/a"); }
  async refreshToken() { this.calls.push("refresh"); return { accessToken: "fresh-token", expiresAt: new Date(Date.now() + 3600_000) }; }
  validateMedia() { return this.issues; }
  upload() { return this.take(this.uploads, "upload"); }
  publish() { return this.take(this.publishes, "publish"); }
  getStatus() { return this.take(this.statuses, "status"); }
  async delete() {}
  async findExisting() { this.calls.push("findExisting"); return this.existing; }
}

const g = globalThis as unknown as { __fake?: FakePublisher; __queueBackend?: unknown };
const realFor = realRegistry.publisherForAccount;
mock.module("../lib/social/registry", () => ({
  ...realRegistry,
  publisherForAccount: (p: Parameters<typeof realFor>[0], a: Parameters<typeof realFor>[1]) => g.__fake ?? realFor(p, a),
}));

type Job = { name: string; data: any; opts?: { delayMs?: number; jobId?: string } };
let jobs: Job[] = [];
g.__queueBackend = { add: async (name: string, data: unknown, opts?: Job["opts"]) => void jobs.push({ name, data, opts }) };

let db: typeof import("../lib/db").db;
let runJob: typeof import("../lib/queue/handlers").runJob;
let requeueStuckTargets: typeof import("../lib/queue/handlers").requeueStuckTargets;
let QUEUED_STALE_MS: number;
let services: typeof import("../lib/services");
let encrypt: typeof import("../lib/crypto").encrypt;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  ({ runJob, requeueStuckTargets, QUEUED_STALE_MS } = await import("../lib/queue/handlers"));
  services = await import("../lib/services");
  ({ encrypt } = await import("../lib/crypto"));
});

// The registry mock is process-wide; hand the real behaviour back to other test files.
afterAll(() => {
  g.__fake = undefined;
  delete g.__queueBackend;
});

let fake: FakePublisher;
beforeEach(() => {
  jobs = [];
  fake = new FakePublisher();
  g.__fake = fake;
});

/** Run queued jobs until the queue is empty (or a cap), like a worker would. */
async function drain(max = 20) {
  for (let i = 0; i < max && jobs.length; i++) {
    const j = jobs.shift()!;
    await runJob(j.name as any, j.data);
  }
}

let n = 0;
async function fixture(opts: { platformUserId?: string; accountStatus?: string; platforms?: ("x" | "youtube" | "instagram")[] } = {}) {
  n++;
  const user = await db.user.create({ data: { name: "T", email: `t${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `k/${n}.mp4`, mimeType: "video/mp4", size: 1000, duration: 10, width: 1080, height: 1920, status: "ready" } });
  const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, status: "draft" } });
  const targets = [];
  for (const platform of opts.platforms ?? ["x"]) {
    const acct = await db.socialAccount.create({
      data: { userId: user.id, platform, platformUserId: opts.platformUserId ?? `real-${platform}-${n}`, username: "u", accessToken: encrypt("tok"), status: opts.accountStatus ?? "connected" },
    });
    targets.push(await db.postTarget.create({ data: { postId: post.id, platform, socialAccountId: acct.id, caption: "hi" } }));
  }
  return { user, post, target: targets[0], targets };
}
const target = (id: string) => db.postTarget.findUniqueOrThrow({ where: { id } });
const post = (id: string) => db.post.findUniqueOrThrow({ where: { id } });

describe("publishing pipeline", () => {
  test("sending a partial post again never re-publishes the destination that is already live", async () => {
    const f = await fixture({ platforms: ["x", "youtube"] });
    fake.uploads.push("m-x", "m-yt");
    fake.publishes.push({ state: "published", platformPostId: "live-1", url: "https://x.com/u/status/live-1" }, new PublisherError("MEDIA_REJECTED", "Too long", "Too long", false));
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    await drain();
    expect((await post(f.post.id)).status).toBe("partial");
    const [liveId, failedId] = f.targets.map((t) => t.id);
    expect((await target(liveId)).platformStatus).toBe("published");

    // "Fix it" -> send again: only the failed destination goes out
    fake.calls = [];
    fake.uploads.push("m-yt-2");
    fake.publishes.push({ state: "published", platformPostId: "yt-1" });
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    expect(jobs.map((j) => j.data.targetId)).toEqual([failedId]);
    await drain();
    expect(fake.calls).toEqual(["upload", "publish"]);
    const live = await target(liveId);
    expect(live.platformStatus).toBe("published");
    expect(live.platformPostId).toBe("live-1");
    expect((await post(f.post.id)).status).toBe("published");

    // Nothing left to send: refused, nothing queued
    await expect(services.launchPost(f.user.id, f.post.id, "now", null, "smooth")).rejects.toThrow();
    expect(jobs.length).toBe(0);
  });

  test("happy path: published only after the platform confirms", async () => {
    const f = await fixture();
    fake.uploads.push("media-1");
    fake.publishes.push({ state: "processing", ref: "proc-1" });
    fake.statuses.push({ state: "processing", ref: "proc-1" }, { state: "published", platformPostId: "123", url: "https://x.com/u/status/123" });

    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    expect((await target(f.target.id)).platformStatus).toBe("queued");

    await runJob("SOCIAL_UPLOAD", jobs.shift()!.data); // upload
    expect((await target(f.target.id)).uploadRef).toBe("media-1");
    await runJob("SOCIAL_PUBLISH", jobs.shift()!.data); // publish -> processing
    let t = await target(f.target.id);
    expect(t.platformStatus).toBe("processing");
    expect(t.publishRequestedAt).not.toBeNull();
    expect((await post(f.post.id)).status).toBe("publishing");

    await drain();
    t = await target(f.target.id);
    expect(t.platformStatus).toBe("published");
    expect(t.platformPostId).toBe("123");
    expect(t.platformUrl).toBe("https://x.com/u/status/123");
    expect(t.practice).toBe(false);
    const p = await post(f.post.id);
    expect(p.status).toBe("published");
    expect(p.publishedAt).not.toBeNull();
    expect(fake.calls).toEqual(["upload", "publish", "status", "status"]);
  });

  test("transient network failure retries with backoff, then fails honestly", async () => {
    const f = await fixture();
    for (let i = 0; i < 6; i++) fake.uploads.push(new TypeError("fetch failed"));
    const realRandom = Math.random;
    Math.random = () => 0.5; // no jitter, so the schedule is exact
    try {
      await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
      const delays: number[] = [];
      const run = async () => {
        for (let i = 0; i < 6 && jobs.length; i++) {
          const j = jobs.shift()!;
          if (j.opts?.delayMs) delays.push(j.opts.delayMs);
          await runJob(j.name as any, j.data);
        }
      };
      await run();
      // Short waits are timers; without Redis the 2 and 5 minute waits are parked for the sweeper.
      expect(delays).toEqual([2000, 10000, 30000]);
      let t = await target(f.target.id);
      expect(t.platformStatus).toBe("queued");
      expect(t.attempts).toBe(4);
      // Not yet: the sweeper leaves it alone until the 2 minutes are up...
      expect(await requeueStuckTargets(QUEUED_STALE_MS, Date.now() + 60_000)).toBe(0);
      expect(jobs).toEqual([]);
      // ...then hands it back.
      expect(await requeueStuckTargets(QUEUED_STALE_MS, Date.now() + 2 * 60_000 + 1000)).toBe(1);
      await run();
      t = await target(f.target.id);
      expect(t.platformStatus).toBe("queued");
      expect(t.attempts).toBe(5);
      expect(await requeueStuckTargets(QUEUED_STALE_MS, Date.now() + 4 * 60_000)).toBe(0);
      expect(await requeueStuckTargets(QUEUED_STALE_MS, Date.now() + 5 * 60_000 + 1000)).toBe(1);
      await run();
      expect(fake.calls.filter((c) => c === "upload").length).toBe(6);
    } finally {
      Math.random = realRandom;
    }
    const t = await target(f.target.id);
    expect(t.platformStatus).toBe("failed");
    expect(t.errorCode).toBe("NETWORK");
    expect(t.platformUrl).toBeNull();
    expect((await post(f.post.id)).status).toBe("failed");
  });

  test("a platform's Retry-After is honoured as the minimum wait", async () => {
    const f = await fixture();
    const throttled = new PublisherError("RATE_LIMITED", "Rate limited", "HTTP 429");
    throttled.retryAfterMs = 25_000;
    fake.uploads.push(throttled, "m");
    fake.publishes.push({ state: "published", platformPostId: "p1", url: "https://x.com/u/status/p1" });
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    const delays: number[] = [];
    for (let i = 0; i < 6 && jobs.length; i++) {
      const j = jobs.shift()!;
      if (j.opts?.delayMs) delays.push(j.opts.delayMs);
      await runJob(j.name as any, j.data);
    }
    expect(delays).toEqual([25_000]); // not the 2 s first step
    expect((await target(f.target.id)).platformStatus).toBe("published");
  });

  test("a platform asking for a very long pause fails now, saying so, instead of hanging", async () => {
    const f = await fixture();
    const quota = new PublisherError("RATE_LIMITED", "Rate limited", "HTTP 429 daily quota");
    quota.retryAfterMs = 6 * 3600_000;
    fake.uploads.push(quota);
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    await drain();
    const t = await target(f.target.id);
    expect(t.platformStatus).toBe("failed");
    expect(t.errorCode).toBe("RATE_LIMITED");
    expect(t.errorMessage).toContain("wait 360 minutes");
    expect(jobs).toEqual([]);
  });

  test("Stop while a long retry wait is parked wins over the sweeper", async () => {
    const f = await fixture();
    const slow = new PublisherError("PLATFORM_DOWN", "Down", "HTTP 503");
    slow.retryAfterMs = 5 * 60_000;
    fake.uploads.push(slow);
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    await drain();
    expect((await target(f.target.id)).platformStatus).toBe("queued");
    await db.postTarget.update({ where: { id: f.target.id }, data: { platformStatus: "failed", errorCode: "CANCELED" } });
    expect(await requeueStuckTargets(QUEUED_STALE_MS, Date.now() + 6 * 60_000)).toBe(0);
  });

  test("expired token fails only that platform and flags the account for reconnection", async () => {
    const f = await fixture({ platforms: ["x", "youtube"] });
    const [xT, ytT] = f.targets;
    // Two independent fakes so each platform has its own script.
    const xFake = fake;
    const ytFake = new FakePublisher();
    xFake.uploads.push("m");
    xFake.publishes.push(new PublisherError("AUTH_EXPIRED", "expired", "HTTP 401", false));
    ytFake.uploads.push("v");
    ytFake.publishes.push({ state: "published", platformPostId: "yt1", url: "https://youtube.com/shorts/yt1" });

    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    for (let i = 0; i < 10 && jobs.length; i++) {
      const j = jobs.shift()!;
      g.__fake = j.data.platform === "x" ? xFake : ytFake;
      await runJob(j.name as any, j.data);
    }
    expect((await target(xT.id)).platformStatus).toBe("failed");
    expect((await target(xT.id)).errorCode).toBe("AUTH_EXPIRED");
    expect((await target(ytT.id)).platformStatus).toBe("published");
    expect((await post(f.post.id)).status).toBe("partial");
    const acct = await db.socialAccount.findUniqueOrThrow({ where: { id: xT.socialAccountId! } });
    expect(acct.status).toBe("needs_reconnect");

    // Retry refuses until reconnected, and only touches the failed platform.
    await expect(services.retryTarget(f.user.id, xT.id)).rejects.toThrow(/Reconnect/);
    await expect(services.retryTarget(f.user.id, ytT.id)).rejects.toThrow(/Nothing to retry/);
  });

  test("retry after a lost publish response reconciles instead of posting twice", async () => {
    const f = await fixture();
    fake.uploads.push("media-9");
    fake.publishes.push(new PublisherError("UNKNOWN", "timeout", "socket hang up", false));
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    await drain();
    let t = await target(f.target.id);
    expect(t.platformStatus).toBe("failed");
    expect(t.publishRequestedAt).not.toBeNull();
    expect(t.uploadRef).toBe("media-9");

    // It actually went live. Retry must find it, not call publish again, not re-upload.
    fake.calls = [];
    fake.existing = { platformPostId: "777", url: "https://x.com/u/status/777" };
    await services.retryTarget(f.user.id, f.target.id);
    await drain();
    t = await target(f.target.id);
    expect(t.platformStatus).toBe("published");
    expect(t.platformPostId).toBe("777");
    expect(fake.calls).toEqual(["findExisting"]);
  });

  test("DUPLICATE from the platform is resolved to the existing post", async () => {
    const f = await fixture();
    fake.uploads.push("m");
    fake.publishes.push(new PublisherError("DUPLICATE", "dup", "HTTP 403 duplicate", false));
    fake.existing = { platformPostId: "dup-1" };
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    await drain();
    const t = await target(f.target.id);
    expect(t.platformStatus).toBe("published");
    expect(t.platformPostId).toBe("dup-1");
  });

  test("DUPLICATE with nothing found stays failed (never a fake success)", async () => {
    const f = await fixture();
    fake.uploads.push("m");
    fake.publishes.push(new PublisherError("DUPLICATE", "dup", "HTTP 403 duplicate", false));
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    await drain();
    const t = await target(f.target.id);
    expect(t.platformStatus).toBe("failed");
    expect(t.errorCode).toBe("DUPLICATE");
    expect(t.platformPostId).toBeNull();
  });

  test("platform-side processing failure is surfaced as failed", async () => {
    const f = await fixture();
    fake.uploads.push("m");
    fake.publishes.push({ state: "processing", ref: "r" });
    fake.statuses.push({ state: "failed", code: "FORBIDDEN", message: "Locked to private" });
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    await drain();
    const t = await target(f.target.id);
    expect(t.platformStatus).toBe("failed");
    expect(t.errorCode).toBe("FORBIDDEN");
  });

  test("invalid media is rejected before anything is uploaded", async () => {
    const f = await fixture();
    fake.issues = [{ level: "error", message: "X needs an MP4 or MOV." }];
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    await drain();
    const t = await target(f.target.id);
    expect(t.platformStatus).toBe("failed");
    expect(t.errorCode).toBe("MEDIA_REJECTED");
    expect(fake.calls).toEqual([]);
  });

  test("retry after MEDIA_REJECTED starts fresh; other retries keep the upload", async () => {
    const f = await fixture();
    await db.postTarget.update({ where: { id: f.target.id }, data: { platformStatus: "failed", errorCode: "MEDIA_REJECTED", uploadRef: "old", publishRequestedAt: new Date() } });
    await services.retryTarget(f.user.id, f.target.id);
    let t = await target(f.target.id);
    expect(t.uploadRef).toBeNull();
    expect(t.publishRequestedAt).toBeNull();
    expect(t.platformStatus).toBe("queued");

    jobs = [];
    await db.postTarget.update({ where: { id: f.target.id }, data: { platformStatus: "failed", errorCode: "RATE_LIMITED", uploadRef: "keep-me" } });
    await services.retryTarget(f.user.id, f.target.id);
    t = await target(f.target.id);
    expect(t.uploadRef).toBe("keep-me");
    // The upload step must skip straight to publish.
    fake.publishes.push({ state: "published", platformPostId: "p" });
    await drain();
    expect(fake.calls).toEqual(["publish"]);
  });

  test("YouTube resumable session refs are resumed, not treated as finished uploads", async () => {
    const f = await fixture();
    await db.postTarget.update({ where: { id: f.target.id }, data: { platformStatus: "queued", uploadRef: "session:https://upload/abc" } });
    fake.uploads.push("video-id");
    fake.publishes.push({ state: "published", platformPostId: "v" });
    await runJob("SOCIAL_UPLOAD", { targetId: f.target.id, platform: "x", simulate: "smooth" } as any);
    await drain();
    expect(fake.calls).toEqual(["upload", "publish"]);
  });

  test("disconnected account fails with NOT_CONNECTED and never calls the platform", async () => {
    const f = await fixture({ accountStatus: "disconnected" });
    await db.postTarget.update({ where: { id: f.target.id }, data: { platformStatus: "queued" } });
    await runJob("SOCIAL_UPLOAD", { targetId: f.target.id, platform: "x", simulate: "smooth" } as any);
    const t = await target(f.target.id);
    expect(t.platformStatus).toBe("failed");
    expect(t.errorCode).toBe("NOT_CONNECTED");
    expect(fake.calls).toEqual([]);
  });

  test("real account without platform credentials fails instead of silently mocking", async () => {
    g.__fake = undefined; // use the real registry
    const f = await fixture({ platformUserId: "real-id-1" });
    await db.postTarget.update({ where: { id: f.target.id }, data: { platformStatus: "queued" } });
    await runJob("SOCIAL_UPLOAD", { targetId: f.target.id, platform: "x", simulate: "smooth" } as any);
    const t = await target(f.target.id);
    expect(t.platformStatus).toBe("failed");
    expect(t.errorCode).toBe("NOT_CONNECTED");
    expect(t.errorMessage).toMatch(/X_CLIENT_ID/);
  });

  test("practice account is marked practice and never gets a real link", async () => {
    g.__fake = undefined; // real registry -> MockPublisher for mock- ids
    const f = await fixture({ platformUserId: "mock-x-001" });
    await db.postTarget.update({ where: { id: f.target.id }, data: { platformStatus: "queued" } });
    await runJob("SOCIAL_UPLOAD", { targetId: f.target.id, platform: "x", simulate: "smooth" } as any);
    const t = await target(f.target.id);
    expect(t.practice).toBe(true);
    expect(t.platformUrl).toBeNull();
  }, 20_000);

  test("scheduled post is claimed once even if the job fires twice", async () => {
    const f = await fixture();
    await db.post.update({ where: { id: f.post.id }, data: { status: "scheduled", scheduledAt: new Date(Date.now() - 1000) } });
    await Promise.all([runJob("SCHEDULED_POST", { postId: f.post.id }), runJob("SCHEDULED_POST", { postId: f.post.id })]);
    expect(jobs.filter((j) => j.name === "SOCIAL_UPLOAD")).toHaveLength(1);
    expect((await target(f.target.id)).platformStatus).toBe("queued");
  });

  test("schedule rejects times in the past and stores UTC instants", async () => {
    const f = await fixture();
    await expect(services.launchPost(f.user.id, f.post.id, "schedule", new Date(Date.now() - 5000), "smooth")).rejects.toThrow(/at least a minute/);
    const when = new Date(Date.UTC(2031, 0, 2, 3, 4, 0));
    await services.launchPost(f.user.id, f.post.id, "schedule", when, "smooth");
    const p = await post(f.post.id);
    expect(p.status).toBe("scheduled");
    expect(p.scheduledAt!.toISOString()).toBe("2031-01-02T03:04:00.000Z");
    expect(jobs[0].name).toBe("SCHEDULED_POST");
  });

  test("launch is refused while already publishing (no double send)", async () => {
    const f = await fixture();
    await db.post.update({ where: { id: f.post.id }, data: { status: "publishing" } });
    await expect(services.launchPost(f.user.id, f.post.id, "now", null, "smooth")).rejects.toThrow(/already on its way/);
  });

  test("users cannot touch each other's posts", async () => {
    const a = await fixture();
    const b = await fixture();
    await expect(services.launchPost(b.user.id, a.post.id, "now", null, "smooth")).rejects.toThrow(/couldn't find/);
    await expect(services.retryTarget(b.user.id, a.target.id)).rejects.toThrow(/couldn't find/);
  });

  test("client views never leak tokens", async () => {
    const f = await fixture();
    const acct = await db.socialAccount.findFirstOrThrow({ where: { userId: f.user.id } });
    const view = JSON.stringify(services.accountView(acct));
    expect(view).not.toContain(acct.accessToken);
    expect(view).not.toMatch(/accessToken|refreshToken/);
  });
});

describe("stopping uploads", () => {
  test("stop all while queued: nothing reaches the platform", async () => {
    const f = await fixture({ platforms: ["x", "youtube"] });
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    expect(await services.cancelTargets(f.user.id, f.post.id)).toBe(2);
    await drain();
    expect(fake.calls).not.toContain("upload");
    for (const t of f.targets) {
      const row = await target(t.id);
      expect(row.platformStatus).toBe("failed");
      expect(row.errorCode).toBe("CANCELED");
    }
    expect((await post(f.post.id)).status).toBe("failed");
  });

  test("stop one: the other keeps going", async () => {
    const f = await fixture({ platforms: ["x", "youtube"] });
    fake.uploads.push("media-1");
    fake.publishes.push({ state: "published", platformPostId: "9", url: "https://x.com/u/status/9" });
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    expect(await services.cancelTargets(f.user.id, f.post.id, [f.targets[1].id])).toBe(1);
    await drain();
    expect((await target(f.targets[0].id)).platformStatus).toBe("published");
    expect((await target(f.targets[1].id)).errorCode).toBe("CANCELED");
    expect((await post(f.post.id)).status).toBe("partial");
  });

  test("stopped mid-upload: the upload finishes but is never published", async () => {
    const f = await fixture();
    fake.uploads.push(async () => {
      await services.cancelTargets(f.user.id, f.post.id, [f.target.id]);
      return "media-1";
    });
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    await drain();
    expect(fake.calls).not.toContain("publish");
    expect(jobs.some((j) => j.name === "SOCIAL_PUBLISH")).toBe(false);
    const row = await target(f.target.id);
    expect(row.platformStatus).toBe("failed");
    expect(row.errorCode).toBe("CANCELED");
  });

  test("too late once the platform has it, and a stopped one can be sent again", async () => {
    const f = await fixture();
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    await db.postTarget.update({ where: { id: f.target.id }, data: { platformStatus: "processing" } });
    expect(await services.cancelTargets(f.user.id, f.post.id)).toBe(0);
    await db.postTarget.update({ where: { id: f.target.id }, data: { platformStatus: "queued" } });
    expect(await services.cancelTargets(f.user.id, f.post.id)).toBe(1);
    jobs = [];
    await services.retryTarget(f.user.id, f.target.id);
    expect((await target(f.target.id)).platformStatus).toBe("queued");
    expect(jobs.some((j) => j.name === "SOCIAL_UPLOAD")).toBe(true);
  });

  test("someone else's post can't be stopped", async () => {
    const f = await fixture();
    const other = await db.user.create({ data: { name: "O", email: `o${Date.now()}@test.dev`, passwordHash: "x" } });
    await expect(services.cancelTargets(other.id, f.post.id)).rejects.toThrow();
  });
});

describe("stop and stale-job guards", () => {
  test("a stale publish job never re-posts a target that is already live", async () => {
    const f = await fixture();
    fake.uploads.push("media-1");
    fake.publishes.push({ state: "published", platformPostId: "1", url: "https://x.com/u/status/1" });
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    await drain();
    expect((await target(f.target.id)).platformStatus).toBe("published");
    const calls = fake.calls.length;
    await runJob("SOCIAL_PUBLISH", { targetId: f.target.id, simulate: "smooth" } as any);
    expect(fake.calls.length).toBe(calls);
    expect((await target(f.target.id)).platformStatus).toBe("published");
    expect((await post(f.post.id)).status).toBe("published");
  });

  test("a booked post can't be stopped one destination at a time", async () => {
    const f = await fixture({ platforms: ["x", "youtube"] });
    await services.launchPost(f.user.id, f.post.id, "schedule", new Date(Date.now() + 3600_000), "smooth");
    await expect(services.cancelTargets(f.user.id, f.post.id, [f.targets[0].id])).rejects.toThrow(/Unschedule/);
    expect((await post(f.post.id)).status).toBe("scheduled");
  });
});

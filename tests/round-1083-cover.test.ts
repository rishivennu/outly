/**
 * 1083: the creator's own cover image. Which platforms take it, the size rules, the status line, and the
 * publishing side against the throwaway database with a scripted platform: Instagram/LinkedIn get it with
 * the upload, YouTube/Facebook once live (SET_COVER), and a refusal never touches the post.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as realRegistry from "../lib/social/registry";
import { PublisherError, type PublishContext, type RemoteState, type SocialPublisher } from "../lib/social/types";
import { COVER_AFTER_LIVE, COVER_MAX_BYTES, COVER_SUPPORT, PLATFORMS, supportsCover, type Platform } from "../lib/domain";
import { coverLine, coverSize } from "../lib/client/cover";

describe("cover rules", () => {
  test("YouTube, Instagram, Facebook and LinkedIn take an uploaded cover; the rest don't", () => {
    expect(PLATFORMS.filter((p) => supportsCover(p)).sort()).toEqual(["facebook", "instagram", "linkedin", "youtube"]);
    expect(COVER_SUPPORT.tiktok).toBe("frame");
    expect(COVER_SUPPORT.x).toBe("none");
    expect(COVER_SUPPORT.threads).toBe("none");
    expect([...COVER_AFTER_LIVE].sort()).toEqual(["facebook", "youtube"]);
    expect(COVER_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
  test("cover size is never upscaled and keeps its shape", () => {
    expect(coverSize(1080, 1920)).toEqual({ w: 1080, h: 1920 });
    expect(coverSize(2160, 3840)).toEqual({ w: 1080, h: 1920 });
    expect(coverSize(4000, 3000)).toEqual({ w: 1920, h: 1440 });
    expect(coverSize(640, 360)).toEqual({ w: 640, h: 360 });
  });
  test("status line: only on live posts that had a cover, on platforms that take one", () => {
    expect(coverLine({ platform: "youtube", status: "published" }, false)).toBeNull();
    expect(coverLine({ platform: "youtube", status: "uploading" }, true)).toBeNull();
    expect(coverLine({ platform: "tiktok", status: "published" }, true)).toBeNull();
    expect(coverLine({ platform: "instagram", status: "published", coverSet: true }, true)).toEqual({ text: "Your cover is on it", tone: "ok" });
    expect(coverLine({ platform: "youtube", status: "published" }, true)?.tone).toBe("wait");
    expect(coverLine({ platform: "youtube", status: "published", coverError: "Verify." }, true)).toEqual({ text: "Cover didn't go on: Verify.", tone: "bad" });
  });
});

/* ---------------- publishing, against the test database ---------------- */

type Step<T> = T | Error;
class FakePublisher implements SocialPublisher {
  constructor(readonly platform: Platform) {}
  calls: string[] = [];
  seen: PublishContext[] = [];
  covers: { postId: string; bytes: number }[] = [];
  coverSteps: Step<void>[] = [];
  uploads: Step<string>[] = [];
  publishes: Step<RemoteState>[] = [];
  async connect() { return { url: "", state: "" }; }
  async completeConnect(): Promise<never> { throw new Error("n/a"); }
  async refreshToken() { return { accessToken: "fresh", expiresAt: new Date(Date.now() + 3600_000) }; }
  validateMedia() { return []; }
  async upload(ctx: PublishContext) {
    this.seen.push(ctx);
    if (ctx.cover) { await ctx.cover.bytes(); await ctx.noteCover?.(null); }
    const s = this.uploads.shift()!; if (s instanceof Error) throw s; return s;
  }
  async publish() { const s = this.publishes.shift()!; if (s instanceof Error) throw s; return s; }
  async getStatus(): Promise<RemoteState> { throw new Error("n/a"); }
  async delete() {}
  async findExisting() { return null; }
  async setCover(_a: unknown, postId: string, jpeg: Buffer) {
    this.calls.push("cover");
    const s = this.coverSteps.shift();
    if (s instanceof Error) throw s;
    this.covers.push({ postId, bytes: jpeg.length });
  }
}

const g = globalThis as unknown as { __fake?: SocialPublisher; __queueBackend?: unknown };
const realFor = realRegistry.publisherForAccount;
mock.module("../lib/social/registry", () => ({
  ...realRegistry,
  publisherForAccount: (p: Parameters<typeof realFor>[0], a: Parameters<typeof realFor>[1]) => g.__fake ?? realFor(p, a),
}));

type Job = { name: string; data: any; opts?: { delayMs?: number; jobId?: string } };
let jobs: Job[] = [];
let previousBackend: unknown;
let db: typeof import("../lib/db").db;
let runJob: typeof import("../lib/queue/handlers").runJob;
let setCover: typeof import("../lib/queue/handlers").setCover;
let coverRefusal: typeof import("../lib/queue/handlers").coverRefusal;
let services: typeof import("../lib/services");
let storage: typeof import("../lib/storage").storage;
let encrypt: typeof import("../lib/crypto").encrypt;
let fake: FakePublisher;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 1)]);

beforeAll(async () => {
  previousBackend = g.__queueBackend;
  g.__queueBackend = { add: async (name: string, data: unknown, opts?: Job["opts"]) => void jobs.push({ name, data, opts }) };
  ({ db } = await import("../lib/db"));
  ({ runJob, setCover, coverRefusal } = await import("../lib/queue/handlers"));
  services = await import("../lib/services");
  ({ storage } = await import("../lib/storage"));
  ({ encrypt } = await import("../lib/crypto"));
}, 60_000);
afterAll(() => {
  g.__fake = undefined;
  g.__queueBackend = previousBackend;
});
beforeEach(() => {
  jobs = [];
});

let n = 0;
async function fixture(platform: Platform, opts: { cover?: boolean; live?: boolean } = {}) {
  n++;
  fake = new FakePublisher(platform);
  g.__fake = fake;
  const user = await db.user.create({ data: { name: "CV", email: `cv${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `cv/${n}.mp4`, mimeType: "video/mp4", size: 1000, duration: 10, width: 1080, height: 1920, status: "ready" } });
  let coverKey: string | null = null;
  if (opts.cover !== false) {
    coverKey = `covers/${user.id}/cv-${n}.jpg`;
    await storage.put(coverKey, JPEG, "image/jpeg");
  }
  const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, status: opts.live ? "published" : "draft", coverKey } });
  const acct = await db.socialAccount.create({ data: { userId: user.id, platform, platformUserId: `real-${platform}-${n}`, username: "u", accessToken: encrypt("tok"), status: "connected" } });
  const target = await db.postTarget.create({
    data: {
      postId: post.id, platform, socialAccountId: acct.id, title: "T", caption: "hi",
      ...(opts.live ? { platformStatus: "published", platformPostId: `${platform}-777`, publishedAt: new Date() } : {}),
    },
  });
  return { user, post, target };
}
const target = (id: string) => db.postTarget.findUniqueOrThrow({ where: { id } });

async function launch(f: Awaited<ReturnType<typeof fixture>>, postId: string) {
  fake.uploads.push("up-1");
  fake.publishes.push({ state: "published", platformPostId: postId, url: "https://example.com/p" });
  await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
  await runJob("SOCIAL_UPLOAD", jobs.shift()!.data);
  await runJob("SOCIAL_PUBLISH", jobs.shift()!.data);
}

describe("cover with the upload (Instagram)", () => {
  test("goes in with the upload and is marked on", async () => {
    const f = await fixture("instagram");
    await launch(f, "ig-1");
    expect(fake.seen[0].cover).toBeTruthy();
    expect((await fake.seen[0].cover!.url()).length).toBeGreaterThan(0);
    const t = await target(f.target.id);
    expect(t.platformStatus).toBe("published");
    expect(t.coverSetAt).not.toBeNull();
    expect(jobs.find((j) => j.name === "SET_COVER")).toBeUndefined(); // no second call afterwards
    const view = await services.postView(await services.ownedPost(f.user.id, f.post.id));
    expect(view.coverUrl).toBeTruthy();
    expect(coverLine(view.targets[0], !!view.coverUrl)?.tone).toBe("ok");
  });
  test("no cover: nothing extra is sent", async () => {
    const f = await fixture("instagram", { cover: false });
    await launch(f, "ig-2");
    expect(fake.seen[0].cover).toBeNull();
    expect((await target(f.target.id)).coverSetAt).toBeNull();
  });
});

describe("cover after live (YouTube)", () => {
  test("not sent with the upload; set a moment after the post is live", async () => {
    const f = await fixture("youtube");
    await launch(f, "yt-1");
    expect(fake.seen[0].cover).toBeNull();
    const job = jobs.find((j) => j.name === "SET_COVER");
    expect(job?.opts).toEqual({ delayMs: 3000, jobId: `cv-${f.target.id}` });
    await runJob("SET_COVER", job!.data);
    expect(fake.covers).toEqual([{ postId: "yt-1", bytes: JPEG.length }]);
    expect((await target(f.target.id)).coverSetAt).not.toBeNull();
  });
  test("a second run never sets it twice", async () => {
    const f = await fixture("youtube", { live: true });
    await setCover({ targetId: f.target.id, platform: "youtube" });
    await setCover({ targetId: f.target.id, platform: "youtube" });
    expect(fake.covers).toHaveLength(1);
  });
  test("an unverified channel: the post stays live and the reason is kept in plain words", async () => {
    const f = await fixture("youtube", { live: true });
    fake.coverSteps.push(new PublisherError("FORBIDDEN", "Custom thumbnails need a verified channel"));
    await setCover({ targetId: f.target.id, platform: "youtube" });
    const t = await target(f.target.id);
    expect(t.platformStatus).toBe("published");
    expect(t.coverSetAt).toBeNull();
    expect(t.coverError).toBe(coverRefusal("youtube"));
    expect(t.coverError).toContain("verified");
    expect(jobs).toHaveLength(0); // a refusal isn't retried
    const acct = await db.socialAccount.findFirstOrThrow({ where: { userId: f.user.id } });
    expect(acct.status).toBe("connected"); // and never flags the account
  });
  test("a platform hiccup is retried, spaced out", async () => {
    const f = await fixture("youtube", { live: true });
    fake.coverSteps.push(new PublisherError("PLATFORM_DOWN", "503"));
    await setCover({ targetId: f.target.id, platform: "youtube" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.attempt).toBe(1);
    expect(jobs[0].opts?.delayMs).toBe(15_000);
    await runJob("SET_COVER", jobs.shift()!.data);
    expect((await target(f.target.id)).coverSetAt).not.toBeNull();
  });
  test("no cover on the post: no job", async () => {
    const f = await fixture("youtube", { cover: false });
    await launch(f, "yt-3");
    expect(jobs.find((j) => j.name === "SET_COVER")).toBeUndefined();
    expect(fake.calls).not.toContain("cover");
  });
});

describe("Instagram publisher", () => {
  test("refuses the container with the cover: tries once without and says why", async () => {
    const { InstagramPublisher } = await import("../lib/social/instagram");
    const sent: Record<string, string>[] = [];
    const realFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      sent.push(Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))));
      call++;
      return call === 1
        ? new Response(JSON.stringify({ error: { message: "Invalid cover", type: "OAuthException", code: 100 } }), { status: 400 })
        : new Response(JSON.stringify({ id: "container-1" }), { status: 200 });
    }) as typeof fetch;
    const notes: (string | null)[] = [];
    try {
      const ref = await new InstagramPublisher().upload({
        account: { id: "a", platformUserId: "1", username: "u", accessToken: "t" },
        media: { id: "m", mimeType: "video/mp4", size: 1, publicUrl: async () => "https://x/v.mp4", open: async () => { throw new Error("n/a"); }, readAll: async () => Buffer.alloc(0) },
        content: { caption: "hi" },
        attempt: 0,
        cover: { url: async () => "https://x/c.jpg", bytes: async () => JPEG },
        noteCover: async (e) => void notes.push(e),
      });
      expect(ref).toBe("container-1");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent[0].cover_url).toBe("https://x/c.jpg");
    expect(sent[1].cover_url).toBeUndefined();
    expect(notes).toEqual(["Instagram couldn't use the cover image, so it picked a frame from the video."]);
  });
});

/**
 * 10-16 UX round, feature 2: auto first comment. Editor rules (limits, payload), then the job against the
 * throwaway database with a scripted platform: posts once after live, never twice, retries politely,
 * and a failure is kept on the target without touching the post.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as realRegistry from "../lib/social/registry";
import { PublisherError, type RemoteState, type SocialPublisher } from "../lib/social/types";
import { checksFor, type Draft } from "../lib/client/checks";
import { targetPayload } from "../components/create/publish";
import { FIRST_COMMENT_LIMIT, PLATFORMS, supportsFirstComment, type Platform } from "../lib/domain";
import { firstCommentLine } from "../lib/client/first-comment";
import { targetDraftSchema } from "../lib/validation";

const draft = (over: Partial<Draft> = {}): Draft => ({ enabled: true, title: "A title", caption: "hi", description: "desc", hashtags: "", firstComment: "", note: "", reviewed: false, ...over });

describe("editor rules", () => {
  test("only Instagram, YouTube and X take a first comment", () => {
    expect(PLATFORMS.filter((p) => supportsFirstComment(p)).sort()).toEqual(["instagram", "x", "youtube"]);
    expect(supportsFirstComment("tiktok")).toBe(false);
  });
  test("over the platform limit blocks, at the limit does not", () => {
    for (const p of ["instagram", "youtube", "x"] as const) {
      const lim = FIRST_COMMENT_LIMIT[p]!;
      expect(checksFor(p, draft({ firstComment: "a".repeat(lim) }), null).some((c) => c.level === "error")).toBe(false);
      const over = checksFor(p, draft({ firstComment: "a".repeat(lim + 3) }), null);
      expect(over.some((c) => c.level === "error" && c.text.startsWith("First comment is 3 characters over"))).toBe(true);
    }
  });
  test("an unsupported platform ignores the field entirely", () => {
    expect(checksFor("tiktok", draft({ firstComment: "a".repeat(20000) }), null).some((c) => c.level === "error")).toBe(false);
  });
  test("payload trims, and sends null for an empty comment", () => {
    const drafts = Object.fromEntries(PLATFORMS.map((p) => [p, draft({ enabled: p === "instagram" || p === "x", firstComment: p === "instagram" ? "  #tags here \n" : "   " })])) as Record<Platform, Draft>;
    const out = targetPayload(drafts);
    expect(out.find((t) => t.platform === "instagram")?.firstComment).toBe("#tags here");
    expect(out.find((t) => t.platform === "x")?.firstComment).toBeNull();
  });
  test("schema keeps YouTube-length comments so autosave never fails mid-typing", () => {
    expect(targetDraftSchema.safeParse({ platform: "youtube", firstComment: "a".repeat(10000) }).success).toBe(true);
    expect(targetDraftSchema.safeParse({ platform: "youtube", firstComment: "a".repeat(10001) }).success).toBe(false);
  });
  test("status line says what happened, in plain words", () => {
    expect(firstCommentLine({ platform: "instagram", status: "published", firstCommentState: null })).toBeNull();
    expect(firstCommentLine({ platform: "instagram", status: "published", firstCommentState: "posted" })?.text).toBe("First comment posted");
    expect(firstCommentLine({ platform: "x", status: "published", firstCommentState: "posted" })?.text).toBe("First reply posted");
    expect(firstCommentLine({ platform: "youtube", status: "queued", firstCommentState: "waiting" })?.tone).toBe("wait");
    const bad = firstCommentLine({ platform: "youtube", status: "published", firstCommentState: "failed", firstCommentError: "Comments are off." });
    expect(bad).toEqual({ text: "First comment didn't go up: Comments are off.", tone: "bad" });
  });
});

/* ---------------- the job, against the test database ---------------- */

type Step<T> = T | Error;
class FakePublisher implements SocialPublisher {
  readonly platform = "instagram" as const;
  calls: string[] = [];
  comments: { postId: string; text: string }[] = [];
  commentSteps: Step<{ id: string }>[] = [];
  uploads: Step<string>[] = [];
  publishes: Step<RemoteState>[] = [];
  async connect() { return { url: "", state: "" }; }
  async completeConnect(): Promise<never> { throw new Error("n/a"); }
  async refreshToken() { this.calls.push("refresh"); return { accessToken: "fresh", expiresAt: new Date(Date.now() + 3600_000) }; }
  validateMedia() { return []; }
  async upload() { const s = this.uploads.shift()!; if (s instanceof Error) throw s; return s; }
  async publish() { const s = this.publishes.shift()!; if (s instanceof Error) throw s; return s; }
  async getStatus(): Promise<RemoteState> { throw new Error("n/a"); }
  async delete() {}
  async findExisting() { return null; }
  async postComment(_a: unknown, postId: string, text: string) {
    this.calls.push("comment");
    const s = this.commentSteps.shift() ?? { id: `c-${this.comments.length + 1}` };
    if (s instanceof Error) throw s;
    this.comments.push({ postId, text });
    return s;
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
let firstComment: typeof import("../lib/queue/handlers").firstComment;
let services: typeof import("../lib/services");
let encrypt: typeof import("../lib/crypto").encrypt;
let fake: FakePublisher;

beforeAll(async () => {
  previousBackend = g.__queueBackend;
  g.__queueBackend = { add: async (name: string, data: unknown, opts?: Job["opts"]) => void jobs.push({ name, data, opts }) };
  ({ db } = await import("../lib/db"));
  ({ runJob, firstComment } = await import("../lib/queue/handlers"));
  services = await import("../lib/services");
  ({ encrypt } = await import("../lib/crypto"));
}, 60_000);
afterAll(() => {
  g.__fake = undefined;
  g.__queueBackend = previousBackend;
});
beforeEach(() => {
  jobs = [];
  fake = new FakePublisher();
  g.__fake = fake;
});

async function drain(max = 20) {
  for (let i = 0; i < max && jobs.length; i++) {
    const j = jobs.shift()!;
    await runJob(j.name as any, j.data);
  }
}

let n = 0;
async function fixture(opts: { comment?: string | null; accountStatus?: string; live?: boolean } = {}) {
  n++;
  const user = await db.user.create({ data: { name: "FC", email: `fc${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `fc/${n}.mp4`, mimeType: "video/mp4", size: 1000, duration: 10, width: 1080, height: 1920, status: "ready" } });
  const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, status: opts.live ? "published" : "draft" } });
  const acct = await db.socialAccount.create({ data: { userId: user.id, platform: "instagram", platformUserId: `real-ig-${n}`, username: "u", accessToken: encrypt("tok"), status: opts.accountStatus ?? "connected" } });
  const target = await db.postTarget.create({
    data: {
      postId: post.id, platform: "instagram", socialAccountId: acct.id, caption: "hi",
      firstComment: opts.comment === undefined ? "#one #two" : opts.comment,
      ...(opts.live ? { platformStatus: "published", platformPostId: "ig-777", publishedAt: new Date() } : {}),
    },
  });
  return { user, post, target, acct };
}
const target = (id: string) => db.postTarget.findUniqueOrThrow({ where: { id } });

describe("first comment job", () => {
  test("goes up once, a few seconds after the platform confirms live", async () => {
    const f = await fixture();
    fake.uploads.push("media-1");
    fake.publishes.push({ state: "published", platformPostId: "ig-1", url: "https://instagram.com/p/1" });
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    await runJob("SOCIAL_UPLOAD", jobs.shift()!.data);
    await runJob("SOCIAL_PUBLISH", jobs.shift()!.data);
    expect((await target(f.target.id)).platformStatus).toBe("published");
    const fc = jobs.find((j) => j.name === "FIRST_COMMENT");
    expect(fc?.opts).toEqual({ delayMs: 5000, jobId: `fc-${f.target.id}` });
    expect(fake.calls).not.toContain("comment"); // not inline with the publish
    await drain();
    expect(fake.comments).toEqual([{ postId: "ig-1", text: "#one #two" }]);
    const t = await target(f.target.id);
    expect(t.firstCommentId).toBe("c-1");
    expect(t.firstCommentError).toBeNull();
    const view = services.targetView(await target(f.target.id));
    expect(view.firstCommentState).toBe("posted");
  });

  test("a second run of the same job never posts twice", async () => {
    const f = await fixture({ live: true });
    await firstComment({ targetId: f.target.id, platform: "instagram" });
    await firstComment({ targetId: f.target.id, platform: "instagram" });
    expect(fake.comments).toHaveLength(1);
  });

  test("no comment written: no job, nothing posted", async () => {
    const f = await fixture({ comment: null });
    fake.uploads.push("media-1");
    fake.publishes.push({ state: "published", platformPostId: "ig-2" });
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    const seen: string[] = [];
    for (let i = 0; i < 10 && jobs.length; i++) {
      const j = jobs.shift()!;
      seen.push(j.name);
      await runJob(j.name as any, j.data);
    }
    expect((await target(f.target.id)).platformStatus).toBe("published");
    expect(seen).not.toContain("FIRST_COMMENT");
    
    expect(fake.calls).not.toContain("comment");
  });

  test("not live yet: the job waits it out and does nothing", async () => {
    const f = await fixture();
    await firstComment({ targetId: f.target.id, platform: "instagram" });
    expect(fake.calls).toHaveLength(0);
    expect((await target(f.target.id)).firstCommentError).toBeNull();
  });

  test("a brand-new post that refuses comments for a moment gets retried, spaced out", async () => {
    const f = await fixture({ live: true });
    fake.commentSteps.push(new PublisherError("MEDIA_REJECTED", "still processing"));
    await firstComment({ targetId: f.target.id, platform: "instagram" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.attempt).toBe(1);
    expect(jobs[0].opts?.delayMs).toBe(15_000);
    await drain();
    expect((await target(f.target.id)).firstCommentId).toBe("c-1");
  });

  test("gives up after four tries and says so, post untouched", async () => {
    const f = await fixture({ live: true });
    for (let i = 0; i < 4; i++) fake.commentSteps.push(new PublisherError("NETWORK", "down"));
    await firstComment({ targetId: f.target.id, platform: "instagram" });
    await drain();
    expect(fake.calls.filter((c) => c === "comment")).toHaveLength(4);
    const t = await target(f.target.id);
    expect(t.firstCommentId).toBeNull();
    expect(t.firstCommentError).toMatch(/didn't go up/);
    expect(t.platformStatus).toBe("published");
    expect(services.targetView(t).firstCommentState).toBe("failed");
  });

  test("comments switched off: one try, a plain reason", async () => {
    const f = await fixture({ live: true });
    fake.commentSteps.push(new PublisherError("FORBIDDEN", "nope"));
    await firstComment({ targetId: f.target.id, platform: "instagram" });
    expect(jobs).toHaveLength(0);
    expect((await target(f.target.id)).firstCommentError).toMatch(/comments may be off/);
  });

  test("disconnected account: no call, the reason is stored", async () => {
    const f = await fixture({ live: true, accountStatus: "expired" });
    await firstComment({ targetId: f.target.id, platform: "instagram" });
    expect(fake.calls).toHaveLength(0);
    expect((await target(f.target.id)).firstCommentError).toMatch(/disconnected/);
  });
});

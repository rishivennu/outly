/**
 * Review-before-publish: the link is a credential (hash only), carries exactly one decision,
 * expires, and gates publishing without ever publishing something nobody approved.
 */
import { beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let review: typeof import("../lib/review");
let services: typeof import("../lib/services");
let runJob: typeof import("../lib/queue/handlers").runJob;

const g = globalThis as unknown as { __queueBackend?: unknown };
let jobs: { name: string; data: any }[] = [];
g.__queueBackend = { add: async (name: string, data: unknown) => void jobs.push({ name, data }) };

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  review = await import("../lib/review");
  services = await import("../lib/services");
  ({ runJob } = await import("../lib/queue/handlers"));
});

let n = 0;
async function fixture(opts: { requireApproval?: boolean } = {}) {
  n++;
  const user = await db.user.create({ data: { name: "Rev", email: `rev${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `rev/${n}.mp4`, mimeType: "video/mp4", size: 1000, duration: 10, width: 1080, height: 1920, status: "ready" } });
  const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, status: "draft", requireApproval: !!opts.requireApproval, title: "Draft one" } });
  const acct = await db.socialAccount.create({ data: { userId: user.id, platform: "x", platformUserId: `mock-x-${n}`, username: "@u", accessToken: "plain-not-used", status: "connected" } });
  const target = await db.postTarget.create({ data: { postId: post.id, platform: "x", socialAccountId: acct.id, caption: "hi" } });
  return { user, post, target };
}

describe("review tokens", () => {
  test("the raw token is never stored, only its SHA-256 hash", async () => {
    const f = await fixture();
    const { token, review: r, url } = await review.createReviewRequest(f.user.id, f.post.id);
    expect(token.length).toBeGreaterThan(30);
    expect(r.tokenHash).toBe(review.hashReviewToken(token));
    expect(r.tokenHash).not.toBe(token);
    expect(r.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(url).toContain(token);
    const rows = await db.reviewRequest.findMany({ where: { postId: f.post.id } });
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test("lookup works by token and fails for a wrong one", async () => {
    const f = await fixture();
    const { token } = await review.createReviewRequest(f.user.id, f.post.id);
    expect((await review.findByToken(token))!.postId).toBe(f.post.id);
    expect(await review.findByToken(token.slice(0, -2) + "zz")).toBeNull();
    expect(await review.findByToken("short")).toBeNull();
  });

  test("the link expires after seven days", async () => {
    const f = await fixture();
    const { review: r } = await review.createReviewRequest(f.user.id, f.post.id);
    expect(review.isExpired(r)).toBe(false);
    expect(review.canDecide(r)).toBe(true);
    const days = (r.expiresAt.getTime() - r.createdAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(7);
    expect(review.isExpired(r, new Date(Date.now() + review.REVIEW_TTL_MS + 1000))).toBe(true);
  });

  test("an expired token cannot decide", async () => {
    const f = await fixture();
    const { token, review: r } = await review.createReviewRequest(f.user.id, f.post.id);
    await db.reviewRequest.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(review.decideReview(token, { reviewerName: "Ann", decision: "approved" })).rejects.toThrow(/expired/i);
  });

  test("one decision per token; the second attempt is refused", async () => {
    const f = await fixture();
    const { token } = await review.createReviewRequest(f.user.id, f.post.id);
    const decided = await review.decideReview(token, { reviewerName: "  Ann  ", decision: "approved" });
    expect(decided.status).toBe("approved");
    expect(decided.reviewerName).toBe("Ann");
    expect(decided.decidedAt).not.toBeNull();
    await expect(review.decideReview(token, { reviewerName: "Bob", decision: "changes_requested", note: "nope" })).rejects.toThrow(/already been used/);
    expect((await db.reviewRequest.findUniqueOrThrow({ where: { id: decided.id } })).reviewerName).toBe("Ann");
  });

  test("two simultaneous decisions produce exactly one verdict", async () => {
    const f = await fixture();
    const { token } = await review.createReviewRequest(f.user.id, f.post.id);
    const results = await Promise.allSettled([
      review.decideReview(token, { reviewerName: "A", decision: "approved" }),
      review.decideReview(token, { reviewerName: "B", decision: "changes_requested", note: "tighten the hook" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  test("requesting changes needs a note", async () => {
    const f = await fixture();
    const { token } = await review.createReviewRequest(f.user.id, f.post.id);
    await expect(review.decideReview(token, { reviewerName: "Ann", decision: "changes_requested", note: "  " })).rejects.toThrow(/what to change/i);
    const ok = await review.decideReview(token, { reviewerName: "Ann", decision: "changes_requested", note: "Trim the intro" });
    expect(ok.note).toBe("Trim the intro");
  });

  test("the reviewer package carries the copy and the creator's name, not the account", async () => {
    const f = await fixture();
    const { token } = await review.createReviewRequest(f.user.id, f.post.id);
    const pkg = (await review.reviewPackage(token))!;
    expect(pkg.creatorName).toBe("Rev");
    expect(pkg.open).toBe(true);
    expect(pkg.post.targets[0].caption).toBe("hi");
    expect(JSON.stringify(pkg)).not.toContain("accessToken");
    expect(await review.reviewPackage("nope-nope-nope-nope-nope")).toBeNull();
  });

  test("a review link cannot be made for a post that already went out", async () => {
    const f = await fixture();
    await db.post.update({ where: { id: f.post.id }, data: { status: "published" } });
    await expect(review.createReviewRequest(f.user.id, f.post.id)).rejects.toThrow(/already gone out/);
  });

  test("another user cannot create a review link for your post", async () => {
    const mine = await fixture();
    const other = await fixture();
    await expect(review.createReviewRequest(other.user.id, mine.post.id)).rejects.toThrow(/couldn't find/);
  });
});

describe("NEEDS_APPROVAL gate", () => {
  test("publishing now is refused with the typed code until approved", async () => {
    const f = await fixture({ requireApproval: true });
    jobs = [];
    const err = await services.launchPost(f.user.id, f.post.id, "now", null, "smooth").catch((e) => e);
    expect(err.code).toBe("NEEDS_APPROVAL");
    expect(err.status).toBe(409);
    expect(jobs).toHaveLength(0);
    expect((await db.post.findUniqueOrThrow({ where: { id: f.post.id } })).status).toBe("draft");

    const { token } = await review.createReviewRequest(f.user.id, f.post.id);
    await review.decideReview(token, { reviewerName: "Ann", decision: "approved" });
    await services.launchPost(f.user.id, f.post.id, "now", null, "smooth");
    expect((await db.post.findUniqueOrThrow({ where: { id: f.post.id } })).status).toBe("publishing");
  });

  test("scheduling is refused too, so nothing is parked that cannot go out", async () => {
    const f = await fixture({ requireApproval: true });
    await expect(services.launchPost(f.user.id, f.post.id, "schedule", new Date(Date.now() + 3_600_000), "smooth")).rejects.toThrow(/approval/);
  });

  test("changes_requested is not approval", async () => {
    const f = await fixture({ requireApproval: true });
    const { token } = await review.createReviewRequest(f.user.id, f.post.id);
    await review.decideReview(token, { reviewerName: "Ann", decision: "changes_requested", note: "redo the hook" });
    expect(await review.isApproved(await db.post.findUniqueOrThrow({ where: { id: f.post.id } }))).toBe(false);
    await expect(services.launchPost(f.user.id, f.post.id, "now", null, "smooth")).rejects.toThrow(/approval/);
  });

  test("the gate is off unless the post asks for it", async () => {
    const f = await fixture();
    expect(await review.isApproved(await db.post.findUniqueOrThrow({ where: { id: f.post.id } }))).toBe(true);
  });

  test("the scheduler skips an unapproved post and leaves it scheduled", async () => {
    const f = await fixture({ requireApproval: true });
    await db.post.update({ where: { id: f.post.id }, data: { status: "scheduled", scheduledAt: new Date(Date.now() - 1000) } });
    jobs = [];
    await runJob("SCHEDULED_POST", { postId: f.post.id });
    expect(jobs).toHaveLength(0);
    const p = await db.post.findUniqueOrThrow({ where: { id: f.post.id } });
    expect(p.status).toBe("scheduled");
    expect((await db.postTarget.findUniqueOrThrow({ where: { id: f.target.id } })).platformStatus).toBe("pending");

    // Approve, and the next sweep sends it.
    const { token } = await review.createReviewRequest(f.user.id, f.post.id);
    await db.post.update({ where: { id: f.post.id }, data: { status: "scheduled" } });
    await review.decideReview(token, { reviewerName: "Ann", decision: "approved" });
    await runJob("SCHEDULED_POST", { postId: f.post.id });
    expect(jobs.filter((j) => j.name === "SOCIAL_UPLOAD")).toHaveLength(1);
  });

  test("postView exposes the review state the creator sees", async () => {
    const f = await fixture({ requireApproval: true });
    const { token } = await review.createReviewRequest(f.user.id, f.post.id);
    await review.decideReview(token, { reviewerName: "Ann", decision: "approved" });
    const view = await services.postView(await services.ownedPost(f.user.id, f.post.id));
    expect(view.requireApproval).toBe(true);
    expect(view.approved).toBe(true);
    expect(view.review!.reviewerName).toBe("Ann");
    expect(view.review!.status).toBe("approved");
  });
});

/**
 * Content / publishing audit (content teammate).
 * Each test here failed before the fix in the same commit and passes after.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Add = { name: string; data: any; opts?: { jobId?: string; delayMs?: number } };

/**
 * A BullMQ-shaped backend: a custom jobId is remembered after the job finishes (removeOnComplete keeps it),
 * so adding the same id again is silently ignored. That is exactly what prod does with Redis.
 */
function bullLike() {
  const seen = new Set<string>();
  const adds: Add[] = [];
  return {
    adds,
    backend: {
      add: async (name: string, data: unknown, opts?: Add["opts"]) => {
        if (opts?.jobId) {
          if (seen.has(opts.jobId)) return;
          seen.add(opts.jobId);
        }
        adds.push({ name, data, opts });
      },
    },
  };
}

const g = globalThis as unknown as { __queueBackend?: unknown };
let saved: unknown;
let db: typeof import("../lib/db").db;
let handlers: typeof import("../lib/queue/handlers");
let bulk: typeof import("../lib/posts/bulk-server");
let dup: typeof import("../lib/posts/duplicate");
let encrypt: typeof import("../lib/crypto").encrypt;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  handlers = await import("../lib/queue/handlers");
  bulk = await import("../lib/posts/bulk-server");
  dup = await import("../lib/posts/duplicate");
  ({ encrypt } = await import("../lib/crypto"));
  saved = g.__queueBackend;
}, 60_000);

afterAll(() => {
  g.__queueBackend = saved;
});

let n = 0;
async function fixture(opts: { platform?: string; status?: string } = {}) {
  n++;
  const user = await db.user.create({ data: { name: "C", email: `audit-content-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `k/ac${n}.mp4`, mimeType: "video/mp4", size: 1000, duration: 10, width: 1080, height: 1920, status: "ready" } });
  const account = await db.socialAccount.create({
    data: { userId: user.id, platform: opts.platform ?? "instagram", platformUserId: `real-ac-${n}`, username: "u", accessToken: encrypt("tok"), status: opts.status ?? "connected" },
  });
  return { user, media, account };
}

describe("scheduled posts: the sweeper must keep handing a due post back to the queue", () => {
  test("a post waiting for approval is re-queued on a later sweep (job ids are bucketed, not fixed)", async () => {
    const f = await fixture();
    const past = new Date(Date.now() - 10 * 60_000);
    const post = await db.post.create({ data: { userId: f.user.id, mediaId: f.media.id, status: "scheduled", scheduledAt: past, requireApproval: true } });
    await db.postTarget.create({ data: { postId: post.id, platform: "instagram", socialAccountId: f.account.id, platformStatus: "pending", caption: "hi" } });

    const q = bullLike();
    g.__queueBackend = q.backend;
    const t0 = Date.now();
    await handlers.sweepDuePosts(t0);
    const first = q.adds.filter((a) => a.name === "SCHEDULED_POST" && a.data.postId === post.id);
    expect(first.length).toBe(1);

    // The job runs and bows out: nobody has approved it yet, so it stays "scheduled".
    await handlers.runJob("SCHEDULED_POST", { postId: post.id });
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("scheduled");

    // A reviewer approves. The next sweep must queue it again, or it never goes out.
    await db.post.update({ where: { id: post.id }, data: { requireApproval: false } });
    await handlers.sweepDuePosts(t0 + 61_000);
    const again = q.adds.filter((a) => a.name === "SCHEDULED_POST" && a.data.postId === post.id);
    expect(again.length).toBe(2);
    expect(again[0].opts?.jobId).not.toBe(again[1].opts?.jobId);

    await handlers.runJob("SCHEDULED_POST", { postId: post.id });
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("publishing");
  });

  test("overlapping sweeps can enqueue twice, but the post is still claimed and uploaded exactly once", async () => {
    const f = await fixture();
    const post = await db.post.create({ data: { userId: f.user.id, mediaId: f.media.id, status: "scheduled", scheduledAt: new Date(Date.now() - 60_000) } });
    await db.postTarget.create({ data: { postId: post.id, platform: "instagram", socialAccountId: f.account.id, platformStatus: "pending", caption: "hi" } });
    const q = bullLike();
    g.__queueBackend = q.backend;
    const t0 = Date.now();
    await handlers.sweepDuePosts(t0);
    await handlers.sweepDuePosts(t0 + 15_000);
    // Bucketed ids dedup inside a minute, but two sweeps either side of a bucket edge legitimately enqueue
    // twice. What has to hold is that the duplicate is a no-op: the claim inside scheduledPost decides.
    const sched = q.adds.filter((a) => a.name === "SCHEDULED_POST" && a.data.postId === post.id);
    expect(sched.length).toBeGreaterThanOrEqual(1);
    expect(sched.length).toBeLessThanOrEqual(2);
    for (const _ of sched) await handlers.runJob("SCHEDULED_POST", { postId: post.id });
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("publishing");
    expect(q.adds.filter((a) => a.name === "SOCIAL_UPLOAD").length).toBe(1);
  });
});

describe("roles: an editor can't publish, whichever door they use", () => {
  test("bookBatch refuses an editor", async () => {
    const f = await fixture();
    const body = { platforms: ["instagram" as const], items: [{ mediaId: f.media.id, scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString() }] };
    g.__queueBackend = bullLike().backend;
    await expect(bulk.bookBatch(f.user.id, body, { role: "editor" })).rejects.toThrow(/can't publish/i);
    expect(await db.post.count({ where: { userId: f.user.id } })).toBe(0);
    // A manager (and the owner) still can.
    const ok = await bulk.bookBatch(f.user.id, body, { role: "manager" });
    expect(ok.posts.length).toBe(1);
    expect(ok.posts[0].status).toBe("scheduled");
  });
});

describe("duplicate keeps everything that decides where a post goes", () => {
  test("the copy keeps its account, its first comment and its approval gate", async () => {
    const f = await fixture();
    const post = await db.post.create({ data: { userId: f.user.id, mediaId: f.media.id, status: "draft", title: "Launch day", requireApproval: true } });
    await db.postTarget.create({
      data: { postId: post.id, platform: "instagram", socialAccountId: f.account.id, caption: "hi", hashtags: "#a", firstComment: "first!" },
    });
    const copy = await dup.duplicatePost(f.user.id, post.id);
    expect(copy.requireApproval).toBe(true);
    expect(copy.targets.length).toBe(1);
    expect(copy.targets[0].firstComment).toBe("first!");
    const row = await db.postTarget.findFirstOrThrow({ where: { postId: copy.id } });
    expect(row.socialAccountId).toBe(f.account.id);
    // Nothing from the original is moved or shared: the copy is a separate draft.
    expect(copy.id).not.toBe(post.id);
    expect((await db.postTarget.findFirstOrThrow({ where: { postId: post.id } })).firstComment).toBe("first!");
  });
});

describe("caption limits count what the platform will actually receive", () => {
  test("hashtags count towards the caption limit on every platform that appends them", async () => {
    const { checksFor, blocking } = await import("../lib/client/checks");
    const base = { enabled: true, title: "", caption: "", description: "", hashtags: "", firstComment: "", note: "", reviewed: true };
    // Threads: 500 characters. 480 of caption plus 40 of hashtags is over, and the publisher would clip it.
    const threads = { ...base, caption: "a".repeat(480), hashtags: "#" + "b".repeat(39) };
    expect(blocking(checksFor("threads", threads, null))).toBe(true);
    // TikTok: 2200.
    const tiktok = { ...base, caption: "a".repeat(2190), hashtags: "#" + "b".repeat(30) };
    expect(blocking(checksFor("tiktok", tiktok, null))).toBe(true);
    // LinkedIn uses the caption plus the hashtags too.
    const linkedin = { ...base, caption: "a".repeat(2990), hashtags: "#" + "b".repeat(30) };
    expect(blocking(checksFor("linkedin", linkedin, null))).toBe(true);
    // YouTube sends description + hashtags.
    const youtube = { ...base, title: "T", description: "a".repeat(4990), hashtags: "#" + "b".repeat(30) };
    expect(blocking(checksFor("youtube", youtube, null))).toBe(true);
    // X has no hashtag field, so nothing changes there.
    const x = { ...base, caption: "a".repeat(279), hashtags: "#ignored" };
    expect(blocking(checksFor("x", x, null))).toBe(false);
    // Comfortably inside the limit stays fine everywhere.
    for (const p of ["instagram", "threads", "tiktok", "linkedin", "facebook"] as const) {
      expect(blocking(checksFor(p, { ...base, caption: "short", hashtags: "#a #b" }, null))).toBe(false);
    }
  });
});

describe("editor seats: the UI never invites a reply or a retry it will refuse", () => {
  const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

  test("the comments composer is read-only for editors, the way the messages one is", () => {
    expect(src("app/(studio)/inbox/page.tsx")).toContain('readOnly={user.role === "editor"}');
    const v = src("components/inbox/InboxView.tsx");
    expect(v).toContain("readOnly={readOnly}");
    expect(v).toContain("Editors can read comments. The workspace owner or a manager answers them.");
    expect(v).toContain("if (readOnly || !text.trim() || busy) return;"); // the form sends nothing
    expect(v).toContain('placeholder={readOnly ? "Editors can\'t reply" : `Reply to ${first}…`}');
    expect(v).toContain("disabled={busy || readOnly || !text.trim()}"); // send
    expect(v).toContain("disabled={thinking || readOnly}"); // reply ideas
  });

  test("a failed destination offers no retry button to an editor", () => {
    const v = src("components/create/PublishingView.tsx");
    expect(v).toContain('const canRetry = useUser().workspace?.role !== "editor";');
    expect(v).toContain("canRetry={canRetry}");
    expect(v).toContain('bad && h?.kind !== "reconnect" && canRetry ?');
    expect(v).toContain("Editors can&apos;t send posts.");
    // Both retry buttons sit behind canRetry: the round one in its condition, the pill in a guard.
    expect(v.split("onClick={onRetry}").length - 1).toBe(2);
    expect(v).toContain('{canRetry && (\n                <button type="button" onClick={onRetry}');
  });
});

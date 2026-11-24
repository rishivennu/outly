/**
 * R1323: Shorts Clipper, phase 5c: a rendered clip goes out through Create and reads its post's numbers back.
 * The pure core (the composer prefill, the honest performance line, per-metric availability), the service over the
 * database (clipForCreate refuses an unrendered clip, attach is idempotent and tenant-safe, a published post turns
 * the clip published once with one learning event, performance never invents a zero), and the wiring (schema takes
 * clipId, the posts route links it, Create accepts ?clip=, the clip row offers Post this clip).
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CLIP_METRICS, clipPrefill, performanceLine, platformPerformance } from "../lib/clipper/publish-core";
import { savePostSchema } from "../lib/validation";

mock.module("next/headers", () => ({
  cookies: () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));

let db: typeof import("../lib/db").db;
let publish: typeof import("../lib/clipper/publish");
let jobs: typeof import("../lib/clipper/jobs");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  publish = await import("../lib/clipper/publish");
  jobs = await import("../lib/clipper/jobs");
}, 60_000);

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function seed(o: { rendered?: boolean } = {}) {
  const t = tag();
  const user = await db.user.create({ data: { email: `r1323-${t}@test.dev`, name: "Clip Poster", passwordHash: "x" } });
  const source = await db.media.create({ data: { userId: user.id, originalFilename: "talk.mp4", storageKey: `r1323/${t}.mp4`, mimeType: "video/mp4", size: 1000, duration: 120, width: 1920, height: 1080, status: "ready" } });
  const job = await db.clipJob.create({ data: { ownerId: user.id, mediaId: source.id, status: "ready", stage: "review", settings: JSON.stringify({ platforms: ["instagram", "youtube"] }), durationSec: 120, executor: "browser" } });
  const rendered = o.rendered === false ? null : await db.media.create({ data: { userId: user.id, originalFilename: "clip.mp4", storageKey: `r1323/${t}-clip.mp4`, mimeType: "video/mp4", size: 500, duration: 30, width: 1080, height: 1920, status: "ready" } });
  const clip = await db.generatedClip.create({
    data: { jobId: job.id, ownerId: user.id, start: 40, end: 70, title: "Why nobody tells you this", hook: "The biggest mistake I see", caption: "Everyone plans tasks. Nobody plans energy.", hashtags: "#planning #focus", status: "approved", ...(rendered ? { renderStatus: "rendered", mediaId: rendered.id, renderedAt: new Date() } : {}) },
  });
  return { user, source, job, rendered, clip };
}

/* ------------------------------------------------------------------ core */

describe("R1323 publish-core", () => {
  test("clipPrefill hands Create the caption, the hashtags on their own line, the hook and the job's platforms", () => {
    const p = clipPrefill({ id: "c1", title: "T", hook: " Hook ", caption: " Cap ", hashtags: "#a #b" }, ["instagram"]);
    expect(p).toEqual({ story: "Cap\n\n#a #b", hook: "Hook", title: "T", platforms: ["instagram"], clipId: "c1" });
    // No words at all: the title stands in, so the box is never empty.
    expect(clipPrefill({ id: "c2", title: "Only a title", hook: null, caption: null, hashtags: "" }, []).story).toBe("Only a title");
    expect(clipPrefill({ id: "c3", title: "x", hook: "", caption: "c", hashtags: null }, []).hook).toBeNull();
  });

  test("platformPerformance: a metric a platform never reports is unavailable, never 0; a real zero stays zero", () => {
    const t = { platform: "youtube", platformStatus: "published", publishedAt: new Date("2026-01-01T00:00:00Z"), metricsCheckedAt: null };
    const none = platformPerformance(t, "video", null);
    expect(none.metrics.map((m) => m.key)).toEqual([...CLIP_METRICS]);
    expect(none.metrics.every((m) => m.value === null && m.availability === "unavailable")).toBe(true);
    const some = platformPerformance(t, "video", { views: 120, likes: 0, comments: 3, shares: 1, saves: 0 });
    expect(some.metrics.find((m) => m.key === "views")).toEqual({ key: "views", value: 120, availability: "available" });
    expect(some.metrics.find((m) => m.key === "likes")).toEqual({ key: "likes", value: 0, availability: "zero" });
    // YouTube never reports saves: the stored 0 is not a number the platform gave.
    expect(some.metrics.find((m) => m.key === "saves")).toEqual({ key: "saves", value: null, availability: "unavailable" });
    expect(some.publishedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("performanceLine says only what is known", () => {
    expect(performanceLine(null, [])).toBe("Not posted yet");
    expect(performanceLine({ status: "draft", scheduledAt: null, publishedAt: null }, [])).toBe("Draft in Create");
    expect(performanceLine({ status: "scheduled", scheduledAt: "2026-02-01T10:00:00Z", publishedAt: null }, [])).toContain("Scheduled for");
    expect(performanceLine({ status: "failed", scheduledAt: null, publishedAt: null }, [])).toContain("failed");
    const pub = { status: "published", scheduledAt: null, publishedAt: "2026-01-01T00:00:00Z" };
    const yt = (raw: Record<string, number> | null, checked = false) => platformPerformance({ platform: "youtube", platformStatus: "published", publishedAt: new Date(), metricsCheckedAt: checked ? new Date() : null }, "video", raw);
    expect(performanceLine(pub, [])).toBe("Published");
    expect(performanceLine(pub, [yt(null)])).toBe("Published. Numbers arrive after the first sync.");
    expect(performanceLine(pub, [yt(null, true)])).toContain("not reported");
    expect(performanceLine(pub, [yt({ views: 1200 })])).toBe("Published. 1,200 views.");
    expect(performanceLine(pub, [yt({ views: 1 })])).toBe("Published. 1 view.");
    // Two destinations, one with numbers: the line says so instead of adding a made-up 0.
    const ig = platformPerformance({ platform: "instagram", platformStatus: "published", publishedAt: new Date(), metricsCheckedAt: null }, "video", null);
    expect(performanceLine(pub, [yt({ views: 10 }), ig])).toBe("Published. 10 views on 1 of 2 destinations.");
    expect(performanceLine(pub, [yt({ views: 10 }), ig])).not.toMatch(/\b0 views/);
  });

  test("review: a summed 0 for a metric the platform reports late is unavailable, not zero; a partial post names what failed", () => {
    const yt = platformPerformance({ platform: "youtube", platformStatus: "published", publishedAt: new Date(), metricsCheckedAt: new Date() }, "video", { views: 50, likes: 2, comments: 0, shares: 0, saves: 0 });
    expect(yt.metrics.find((m) => m.key === "shares")).toEqual({ key: "shares", value: null, availability: "unavailable" });
    expect(yt.metrics.find((m) => m.key === "comments")).toEqual({ key: "comments", value: 0, availability: "zero" });
    const ig = platformPerformance({ platform: "instagram", platformStatus: "published", publishedAt: new Date(), metricsCheckedAt: new Date() }, "video", { views: 9, likes: 0, comments: 0, shares: 0, saves: 0 });
    expect(ig.metrics.find((m) => m.key === "shares")).toEqual({ key: "shares", value: 0, availability: "zero" });
    const partial = { status: "partial", scheduledAt: null, publishedAt: "2026-01-01T00:00:00Z" };
    const failed = platformPerformance({ platform: "threads", platformStatus: "failed", publishedAt: null, metricsCheckedAt: null }, "video", null);
    expect(performanceLine(partial, [yt, failed])).toBe("Published. 50 views. Threads failed; open the post in Create to retry.");
    expect(performanceLine(partial, [failed])).toBe("Published. Threads failed; open the post in Create to retry.");
    expect(performanceLine({ ...partial, status: "published" }, [yt, failed])).toBe("Published. 50 views.");
  });
});

/* ------------------------------------------------------------------ service */

describe("R1323 publish service", () => {
  test("clipForCreate: the rendered Media, the words and the job's platforms; 409 until rendered", async () => {
    const s = await seed();
    const r = await publish.clipForCreate(s.user.id, s.clip.id);
    expect(r.media.id).toBe(s.rendered!.id);
    expect(r.prefill).toEqual({ story: "Everyone plans tasks. Nobody plans energy.\n\n#planning #focus", hook: "The biggest mistake I see", title: "Why nobody tells you this", platforms: ["instagram", "youtube"], clipId: s.clip.id });
    expect(r.clip.post).toBeNull();
    const un = await seed({ rendered: false });
    await expect(publish.clipForCreate(un.user.id, un.clip.id)).rejects.toMatchObject({ status: 409, code: "NOT_RENDERED" });
    // Someone else's clip is a 404, not a 409 that confirms it exists.
    await expect(publish.clipForCreate(un.user.id, s.clip.id)).rejects.toMatchObject({ status: 404 });
    // A binned render is not offered.
    await db.media.update({ where: { id: s.rendered!.id }, data: { deletedAt: new Date() } });
    await expect(publish.clipForCreate(s.user.id, s.clip.id)).rejects.toMatchObject({ status: 404, code: "NO_MEDIA" });
  });

  test("attachClipToPost links once, is idempotent, and ignores foreign or second posts", async () => {
    const s = await seed();
    const post = await db.post.create({ data: { userId: s.user.id, mediaId: s.rendered!.id, title: "From a clip" } });
    const post2 = await db.post.create({ data: { userId: s.user.id, mediaId: s.rendered!.id, title: "Another" } });
    expect(await publish.attachClipToPost(s.user.id, s.clip.id, post.id)).toEqual({ ok: true });
    expect(await publish.attachClipToPost(s.user.id, s.clip.id, post.id)).toEqual({ ok: true }); // same again: fine
    expect(await publish.attachClipToPost(s.user.id, s.clip.id, post2.id)).toEqual({ ok: false, reason: "already_linked" });
    expect((await db.generatedClip.findUniqueOrThrow({ where: { id: s.clip.id } })).postId).toBe(post.id);
    expect(await db.clipEvent.count({ where: { clipId: s.clip.id, type: "post_created" } })).toBe(1);
    expect(await db.learningEvent.count({ where: { ownerId: s.user.id, type: "clip_post_created", subjectId: s.clip.id } })).toBe(1);
    // Another owner can neither claim the clip nor hang it on their post.
    const other = await seed();
    expect(await publish.attachClipToPost(other.user.id, s.clip.id, post.id)).toEqual({ ok: false, reason: "not_found" });
    const theirPost = await db.post.create({ data: { userId: other.user.id, mediaId: other.rendered!.id } });
    expect(await publish.attachClipToPost(s.user.id, other.clip.id, theirPost.id)).toEqual({ ok: false, reason: "not_found" });
    expect(await publish.attachClipToPost(s.user.id, other.clip.id, post.id)).toEqual({ ok: false, reason: "not_found" });
    // The detail now carries the post summary.
    const d = await jobs.jobDetail(s.user.id, s.job.id);
    expect(d.clips[0].post).toMatchObject({ id: post.id, status: "draft" });
  });

  test("a post that went out turns its clip published, once, with one learning event; performance never invents a zero", async () => {
    const s = await seed();
    const post = await db.post.create({ data: { userId: s.user.id, mediaId: s.rendered!.id, status: "draft" } });
    await publish.attachClipToPost(s.user.id, s.clip.id, post.id);
    let perf = await publish.clipPerformance(s.user.id, s.clip.id);
    expect(perf.line).toBe("Draft in Create");
    expect(perf.clip.status).toBe("approved");
    const when = new Date("2026-03-01T09:00:00Z");
    await db.post.update({ where: { id: post.id }, data: { status: "published", publishedAt: when } });
    const yt = await db.postTarget.create({ data: { postId: post.id, platform: "youtube", platformStatus: "published", publishedAt: when, metricsCheckedAt: when } });
    await db.postTarget.create({ data: { postId: post.id, platform: "instagram", platformStatus: "published", publishedAt: when } });
    await db.targetMetric.create({ data: { targetId: yt.id, views: 340, likes: 12, comments: 0, shares: 2, saves: 0 } });
    perf = await publish.clipPerformance(s.user.id, s.clip.id);
    expect(perf.clip.status).toBe("published");
    expect(perf.post?.publishedAt).toBe(when.toISOString());
    expect(perf.line).toBe("Published. 340 views on 1 of 2 destinations.");
    const ig = perf.platforms.find((p) => p.platform === "instagram")!;
    expect(ig.metrics.every((m) => m.value === null)).toBe(true); // never read: not 0
    const y = perf.platforms.find((p) => p.platform === "youtube")!;
    expect(y.metrics.find((m) => m.key === "comments")).toEqual({ key: "comments", value: 0, availability: "zero" });
    expect(y.metrics.find((m) => m.key === "saves")?.value).toBeNull();
    // Reading again changes nothing more: one event, one learning row, dated when the post went out.
    await publish.clipPerformance(s.user.id, s.clip.id);
    await jobs.jobDetail(s.user.id, s.job.id);
    expect(await db.clipEvent.count({ where: { clipId: s.clip.id, type: "published" } })).toBe(1);
    const learned = await db.learningEvent.findMany({ where: { ownerId: s.user.id, type: "clip_published" } });
    expect(learned).toHaveLength(1);
    expect(learned[0].at.toISOString()).toBe(when.toISOString());
    expect(JSON.parse(learned[0].data!)).toMatchObject({ postId: post.id, jobId: s.job.id, length: 30 });
    // A published clip is not discarded by the editor path.
    await expect(jobs.discardClip(s.user.id, s.clip.id, { id: s.user.id, role: "owner" })).rejects.toMatchObject({ status: 409 });
  });

  test("review: numbers are the sum of the delta rows, taken-down destinations are left out, a partial post promotes too", async () => {
    const s = await seed();
    const when = new Date("2026-03-02T09:00:00Z");
    const post = await db.post.create({ data: { userId: s.user.id, mediaId: s.rendered!.id, status: "partial", publishedAt: when } });
    expect(await publish.attachClipToPost(s.user.id, s.clip.id, post.id)).toEqual({ ok: true });
    const yt = await db.postTarget.create({ data: { postId: post.id, platform: "youtube", platformStatus: "published", publishedAt: when, metricsCheckedAt: when } });
    const gone = await db.postTarget.create({ data: { postId: post.id, platform: "instagram", platformStatus: "published", publishedAt: when, metricsCheckedAt: when, removedAt: new Date() } });
    await db.postTarget.create({ data: { postId: post.id, platform: "threads", platformStatus: "failed" } });
    await db.targetMetric.create({ data: { targetId: yt.id, views: 100, likes: 5, comments: 1, shares: 0, saves: 0 } });
    await db.targetMetric.create({ data: { targetId: yt.id, views: 40, likes: 2, comments: 0, shares: 0, saves: 0 } });
    await db.targetMetric.create({ data: { targetId: gone.id, views: 9999, likes: 0, comments: 0, shares: 0, saves: 0 } });
    const perf = await publish.clipPerformance(s.user.id, s.clip.id);
    expect(perf.clip.status).toBe("published");
    expect(perf.platforms.map((p) => p.platform).sort()).toEqual(["threads", "youtube"]);
    const y = perf.platforms.find((p) => p.platform === "youtube")!;
    expect(y.metrics.find((m) => m.key === "views")?.value).toBe(140);
    expect(y.metrics.find((m) => m.key === "likes")?.value).toBe(7);
    expect(y.metrics.find((m) => m.key === "comments")).toEqual({ key: "comments", value: 1, availability: "available" });
    expect(y.metrics.find((m) => m.key === "shares")?.value).toBeNull();
    expect(perf.line).toBe("Published. 140 views. Threads failed; open the post in Create to retry.");
  });

  test("review: a clip with a post keeps its cut and cannot be discarded; attach refuses swapped video, unrendered and discarded clips; ALREADY_POSTED routes to the post", async () => {
    const s = await seed();
    const actor = { id: s.user.id, role: "owner" };
    const post = await db.post.create({ data: { userId: s.user.id, mediaId: s.rendered!.id, status: "draft" } });
    // The creator swapped the video in Create: the post is not this clip's render, so no link.
    const other = await db.media.create({ data: { userId: s.user.id, originalFilename: "other.mp4", storageKey: `r1323/${tag()}-o.mp4`, mimeType: "video/mp4", size: 5, duration: 9, width: 1080, height: 1920, status: "ready" } });
    const swapped = await db.post.create({ data: { userId: s.user.id, mediaId: other.id, status: "draft" } });
    expect(await publish.attachClipToPost(s.user.id, s.clip.id, swapped.id)).toEqual({ ok: false, reason: "media_mismatch" });
    const un = await seed({ rendered: false });
    const unPost = await db.post.create({ data: { userId: un.user.id, mediaId: un.source.id, status: "draft" } });
    expect(await publish.attachClipToPost(un.user.id, un.clip.id, unPost.id)).toEqual({ ok: false, reason: "not_rendered" });
    expect(await publish.attachClipToPost(s.user.id, s.clip.id, post.id)).toEqual({ ok: true });
    // Words can still change; the cut, frame and subtitles are what the post carries.
    const edited = await jobs.updateClip(s.user.id, s.clip.id, { title: "New title" }, actor);
    expect(edited.title).toBe("New title");
    expect(edited.renderStatus).toBe("rendered");
    await expect(jobs.updateClip(s.user.id, s.clip.id, { start: 41 }, actor)).rejects.toMatchObject({ status: 409, code: "HAS_POST" });
    await expect(jobs.updateClip(s.user.id, s.clip.id, { reframe: { mode: "pillarbox" } }, actor)).rejects.toMatchObject({ status: 409, code: "HAS_POST" });
    await expect(jobs.discardClip(s.user.id, s.clip.id, actor)).rejects.toMatchObject({ status: 409, code: "HAS_POST" });
    expect((await db.generatedClip.findUniqueOrThrow({ where: { id: s.clip.id } })).renderStatus).toBe("rendered");
    // Opening Create for a clip that already has a post sends the creator to that post.
    await expect(publish.clipForCreate(s.user.id, s.clip.id)).rejects.toMatchObject({ status: 409, code: "ALREADY_POSTED", extra: { postId: post.id } });
    // The post was deleted: the clip is unlinked and can be posted again.
    await db.post.delete({ where: { id: post.id } });
    const again = await publish.clipForCreate(s.user.id, s.clip.id);
    expect(again.clip.post).toBeNull();
    expect((await db.generatedClip.findUniqueOrThrow({ where: { id: s.clip.id } })).postId).toBeNull();
    // A discarded clip never links.
    const d = await seed();
    await jobs.discardClip(d.user.id, d.clip.id, { id: d.user.id, role: "owner" });
    const dPost = await db.post.create({ data: { userId: d.user.id, mediaId: d.rendered!.id, status: "draft" } });
    expect(await publish.attachClipToPost(d.user.id, d.clip.id, dPost.id)).toEqual({ ok: false, reason: "discarded" });
  });
});

/* ------------------------------------------------------------------ wiring */

describe("R1323 wiring", () => {
  test("the save schema takes clipId and never fails over a bad one", () => {
    const base = { mediaId: "cl0000000000000000000000x", targets: [] };
    expect(savePostSchema.parse({ ...base, clipId: "abc123" }).clipId).toBe("abc123");
    expect(savePostSchema.parse({ ...base, clipId: "../../etc" }).clipId).toBeNull();
    expect(savePostSchema.parse(base).clipId).toBeUndefined();
  });

  test("the posts route links the clip after a create, as a Content Memory item of origin clipper", () => {
    const r = read("app/api/posts/route.ts");
    expect(r).toContain('fromClip ? { origin: "clipper" } : {}');
    expect(r).toContain("const fromClip = !existing && !!body.clipId && (await attachClipToPost(user.id, body.clipId, id).then((r) => r.ok)");
    expect(r.indexOf("const fromClip")).toBeLessThan(r.indexOf("await lineageAfterCreate("));
    expect(read("lib/intelligence/memory.ts")).toContain('"backfill", "clipper"]');
  });

  test("Create accepts ?clip=, sets the rendered file as the video, keeps words already there, and sends clipId with the first save", () => {
    const page = read("app/(studio)/create/page.tsx");
    expect(page).toContain("clipId={post || searchParams.post || searchParams.local ? null : (searchParams.clip?.slice(0, 40) ?? null)}");
    // ?clip= wins over ?rec=, so the two never fight over the first save's origin.
    expect(page).toContain("recId={post || searchParams.post || searchParams.local || searchParams.clip ? null :");
    const ws = read("components/create/CreateWorkspace.tsx");
    expect(ws).toContain("/api/clipper/clips/${encodeURIComponent(clipId)}/publish");
    expect(ws).toContain("setMedia(r.media);");
    expect(ws).toContain("recOrigin.current = { ...(recOrigin.current ?? {}), clipId: r.clip.id };");
    expect(ws).toContain("if (fileRef.current || mediaRef.current) return toast(");
    // A new file is not the clip's render: the first save must not link the clip. A clip with a post opens that post.
    expect(ws).toContain("if (recOrigin.current?.clipId) recOrigin.current =");
    expect(ws).toContain('r.code === "ALREADY_POSTED" && typeof r.data?.postId === "string"');
    expect(ws).toContain("router.replace(`/create?post=${encodeURIComponent(r.data.postId)}`)");
    expect(ws).toContain("if (emptyRef.current) {");
    expect(ws).toContain('window.history.replaceState(null, "", "/create");');
    // recFields() already rides both save payloads, so clipId lands with the first save and never after.
    expect(ws.match(/\.\.\.recFields\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("the clip row offers Post this clip only once rendered and unposted, and shows one honest line about its post", () => {
    const rv = read("components/clipper/ReviewScreen.tsx");
    expect(rv).toContain('c.renderStatus === "rendered" && !c.post && (');
    expect(rv).toContain("/create?clip=${encodeURIComponent(c.id)}");
    expect(rv).toContain("/create?post=${encodeURIComponent(c.post.id)}");
    expect(rv).toContain("{c.post && <PerformanceLine clip={c} />}");
    expect(rv).toContain("/api/clipper/clips/${clip.id}/performance");
    expect(rv).toContain("performanceLine(clip.post, [])");
    expect(rv).toContain("The numbers didn't load");
    expect(rv).toContain('{c.status !== "published" && !c.post && <Button');
    for (const p of ["app/api/clipper/clips/[id]/publish/route.ts", "app/api/clipper/clips/[id]/performance/route.ts"]) expect(read(p)).toContain("export const GET = route(");
    expect(read("lib/clipper/publish.ts")).toContain('import "server-only"');
    expect(read("lib/clipper/publish-core.ts")).not.toContain("prisma");
  });
});

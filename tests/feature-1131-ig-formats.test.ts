/**
 * 1131: Instagram Stories, photo posts and carousels. The shared rules (formatIssues), the JPEG reader, the
 * save schema, the Graph calls the Instagram publisher makes for each format, and the save route + worker
 * against the throwaway database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import * as realRegistry from "../lib/social/registry";
import { defaultFormat, formatIssues, formatsFor, platformsFor, supportsFormat, takesCaption, type SlideFacts } from "../lib/formats";
import { jpegSize } from "../lib/media/jpeg";
import { savePostSchema } from "../lib/validation";
import { PLATFORMS, type Platform } from "../lib/domain";
import type { MediaContext, PublishContext, RemoteState, SocialPublisher } from "../lib/social/types";

/** A minimal JPEG: SOI, APP0, SOF0 with the given size, EOI. Enough for jpegSize. */
function jpeg(width: number, height: number, pad = 0) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.concat([Buffer.from([0xff, 0xd8, ...app0, ...sof]), Buffer.alloc(pad, 0), Buffer.from([0xff, 0xd9])]);
}
const img = (w = 1080, h = 1350, size = 500_000): SlideFacts => ({ mimeType: "image/jpeg", size, width: w, height: h });
const vid = (duration = 20, w = 1080, h = 1920, size = 10e6): SlideFacts => ({ mimeType: "video/mp4", size, duration, width: w, height: h });
const errors = (xs: { level: string; message: string }[]) => xs.filter((x) => x.level === "error").map((x) => x.message);

describe("format rules", () => {
  test("what a set of files can be", () => {
    expect(defaultFormat([img()])).toBe("photo");
    expect(defaultFormat([vid()])).toBe("video");
    expect(defaultFormat([img(), vid()])).toBe("carousel");
    expect(formatsFor([img()])).toEqual(["photo", "story"]);
    expect(formatsFor([vid()])).toEqual(["video", "story"]);
    expect(formatsFor([])).toEqual([]);
    expect(takesCaption("story")).toBe(false);
    expect(takesCaption("carousel")).toBe(true);
  });
  test("Stories, photos and carousels are Instagram only; video goes everywhere", () => {
    for (const f of ["story", "photo", "carousel"] as const) expect(platformsFor(f, PLATFORMS)).toEqual(["instagram"]);
    expect(PLATFORMS.every((p) => supportsFormat(p, "video"))).toBe(true);
    expect(errors(formatIssues("tiktok", "story", [vid()]))[0]).toContain("can't take a story");
  });
  test("story: one item, video up to 60 s and 100 MB, warns when it isn't tall", () => {
    expect(formatIssues("instagram", "story", [vid(30)])).toEqual([]);
    expect(formatIssues("instagram", "story", [img(1080, 1920)])).toEqual([]);
    expect(errors(formatIssues("instagram", "story", [vid(61)]))[0]).toContain("up to 60s");
    expect(errors(formatIssues("instagram", "story", [vid(30, 1080, 1920, 150e6)]))[0]).toContain("100 MB");
    expect(errors(formatIssues("instagram", "story", [vid(2)]))[0]).toContain("under 3 seconds");
    expect(errors(formatIssues("instagram", "story", [img(), img()]))[0]).toContain("one photo or one video");
    const wide = formatIssues("instagram", "story", [img(1920, 1080)]);
    expect(errors(wide)).toEqual([]);
    expect(wide[0].level).toBe("warning");
  });
  test("photo: one JPEG under 8 MB, between 4:5 and 1.91:1", () => {
    expect(formatIssues("instagram", "photo", [img(1080, 1350)])).toEqual([]);
    expect(formatIssues("instagram", "photo", [img(1440, 754)])).toEqual([]);
    expect(errors(formatIssues("instagram", "photo", [img(1080, 1920)]))[0]).toContain("4:5");
    expect(errors(formatIssues("instagram", "photo", [{ ...img(), mimeType: "image/png" }]))[0]).toContain("JPEG");
    expect(errors(formatIssues("instagram", "photo", [img(1080, 1080, 9e6)]))[0]).toContain("8 MB");
    expect(errors(formatIssues("instagram", "photo", [vid()]))[0]).toContain("needs an image");
  });
  test("carousel: 2 to 20 slides, videos up to 15 min, warns on mixed shapes", () => {
    expect(formatIssues("instagram", "carousel", [img(), img(), vid(30, 1080, 1350)])).toEqual([]);
    expect(errors(formatIssues("instagram", "carousel", [img()]))[0]).toContain("at least 2");
    expect(errors(formatIssues("instagram", "carousel", Array.from({ length: 21 }, () => img())))[0]).toContain("up to 20");
    expect(errors(formatIssues("instagram", "carousel", [img(), vid(901, 1080, 1350)]))[0]).toContain("Slide 2");
    expect(errors(formatIssues("instagram", "carousel", [img(), img(1080, 2400)]))[0]).toContain("Slide 2 is outside");
    const mixed = formatIssues("instagram", "carousel", [img(1080, 1080), img(1080, 1350)]);
    expect(errors(mixed)).toEqual([]);
    expect(mixed.some((x) => x.level === "warning" && x.message.includes("first one"))).toBe(true);
  });
});

describe("JPEG reader", () => {
  test("reads the frame size, refuses what isn't a JPEG", () => {
    expect(jpegSize(jpeg(1080, 1350))).toEqual({ width: 1080, height: 1350 });
    expect(jpegSize(jpeg(320, 240, 50))).toEqual({ width: 320, height: 240 });
    expect(jpegSize(Buffer.from("\x89PNG\r\n\x1a\n0000000000000000"))).toBeNull();
    expect(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe("save schema", () => {
  const A = "ckxxxxxxxxxxxxxxxxxxxxxxa";
  const B = "ckxxxxxxxxxxxxxxxxxxxxxxb";
  const base = { mediaId: A, title: "T", targets: [{ platform: "instagram" as const, caption: "c" }] };
  const ok = (x: object) => savePostSchema.safeParse({ ...base, ...x }).success;
  test("video needs no items; the others do, starting with the main media", () => {
    expect(ok({})).toBe(true);
    expect(ok({ format: "video" })).toBe(true);
    expect(ok({ format: "story" })).toBe(false);
    expect(ok({ format: "story", items: [{ mediaId: A }] })).toBe(true);
    expect(ok({ format: "photo", items: [{ mediaId: B }] })).toBe(false);
    expect(ok({ format: "photo", items: [{ mediaId: A }, { mediaId: B }] })).toBe(false);
    expect(ok({ format: "carousel", items: [{ mediaId: A }] })).toBe(false);
    expect(ok({ format: "carousel", items: [{ mediaId: A }, { mediaId: B, altText: "a dog" }] })).toBe(true);
    expect(ok({ format: "carousel", items: [{ mediaId: A }, { mediaId: A }] })).toBe(false);
    expect(ok({ format: "reel" })).toBe(false);
  });
});

/* ---------------- the Instagram publisher's Graph calls ---------------- */

type Call = { url: string; form: Record<string, string> };
const realFetch = globalThis.fetch;
function graph(reply: (c: Call, n: number) => unknown) {
  const calls: Call[] = [];
  globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
    const c = { url: String(u), form: Object.fromEntries(new URLSearchParams(typeof init?.body === "string" ? init.body : String(init?.body ?? ""))) };
    calls.push(c);
    const body = reply(c, calls.length);
    return body instanceof Response ? body : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return calls;
}
const slideCtx = (id: string, mimeType: string, altText?: string): MediaContext => ({
  id, mimeType, size: 1, altText, publicUrl: async () => `https://cdn/${id}`, open: async () => { throw new Error("n/a"); }, readAll: async () => Buffer.alloc(0),
});
const ctx = (format: PublishContext["format"], items: MediaContext[], extra: Partial<PublishContext> = {}): PublishContext => ({
  account: { id: "a", platformUserId: "IG1", username: "u", accessToken: "t" },
  media: items[0], items, format, content: { caption: "Hello", hashtags: "#a" }, attempt: 0, ...extra,
});

describe("Instagram publisher formats", () => {
  afterAll(() => { globalThis.fetch = realFetch; });

  test("story: STORIES container, image or video, no caption", async () => {
    const { InstagramPublisher } = await import("../lib/social/instagram");
    try {
      let calls = graph(() => ({ id: "c-1" }));
      expect(await new InstagramPublisher().upload(ctx("story", [slideCtx("p1", "image/jpeg", "ignored")]))).toBe("c-1");
      expect(calls[0].url).toBe("https://graph.instagram.com/v21.0/IG1/media".replace("v21.0", calls[0].url.split("/")[3]));
      expect(calls[0].form).toMatchObject({ media_type: "STORIES", image_url: "https://cdn/p1" });
      expect(calls[0].form.caption).toBeUndefined();
      expect(calls[0].form.alt_text).toBeUndefined();
      calls = graph(() => ({ id: "c-2" }));
      await new InstagramPublisher().upload(ctx("story", [slideCtx("v1", "video/mp4")]));
      expect(calls[0].form).toMatchObject({ media_type: "STORIES", video_url: "https://cdn/v1" });
      expect(calls[0].form.image_url).toBeUndefined();
    } finally { globalThis.fetch = realFetch; }
  });

  test("photo: image_url with caption and alt text, no media_type", async () => {
    const { InstagramPublisher } = await import("../lib/social/instagram");
    try {
      const calls = graph(() => ({ id: "c-3" }));
      await new InstagramPublisher().upload(ctx("photo", [slideCtx("p1", "image/jpeg", "  a red bike  ")]));
      expect(calls[0].form).toMatchObject({ image_url: "https://cdn/p1", caption: "Hello\n\n#a", alt_text: "a red bike" });
      expect(calls[0].form.media_type).toBeUndefined();
    } finally { globalThis.fetch = realFetch; }
  });

  test("carousel: a child per slide, checkpointed; resumes; waits for every child; then the parent; then publishes", async () => {
    const { InstagramPublisher } = await import("../lib/social/instagram");
    const items = [slideCtx("p1", "image/jpeg", "first"), slideCtx("v1", "video/mp4"), slideCtx("p2", "image/jpeg")];
    const marks: string[] = [];
    try {
      // dies on the third child: two are saved
      let calls = graph((_c, n) => (n === 3 ? new Response(JSON.stringify({ error: { message: "boom", code: 2 } }), { status: 500 }) : { id: `k${n}` }));
      await expect(new InstagramPublisher().upload(ctx("carousel", items, { checkpoint: async (r) => void marks.push(r) }))).rejects.toThrow();
      expect(marks).toEqual(["session:igkids:k1", "session:igkids:k1,k2"]);
      expect(calls[0].form).toMatchObject({ image_url: "https://cdn/p1", is_carousel_item: "true", alt_text: "first" });
      expect(calls[1].form).toMatchObject({ media_type: "VIDEO", video_url: "https://cdn/v1", is_carousel_item: "true" });
      expect(calls[1].form.alt_text).toBeUndefined();
      expect(calls[0].form.caption).toBeUndefined();

      // the retry makes only the third
      calls = graph(() => ({ id: "k3" }));
      const ref = await new InstagramPublisher().upload(ctx("carousel", items, { resumeRef: marks[1] }));
      expect(ref).toBe("kids:k1,k2,k3");
      expect(calls.length).toBe(1);
      expect(calls[0].form.image_url).toBe("https://cdn/p2");

      // the video child is still processing: keep waiting, no parent yet
      calls = graph((c) => ({ status_code: c.url.includes("/k2?") ? "IN_PROGRESS" : "FINISHED" }));
      expect(await new InstagramPublisher().publish(ctx("carousel", items), ref)).toEqual({ state: "processing", ref });
      expect(calls.some((c) => c.form.media_type === "CAROUSEL")).toBe(false);

      // all done: the parent goes in with the children and the caption, and becomes the ref
      calls = graph((c) => (c.url.includes("status_code") ? { status_code: "FINISHED" } : { id: "parent-1" }));
      expect(await new InstagramPublisher().getStatus(ctx("carousel", items), ref)).toEqual({ state: "processing", ref: "parent-1" });
      const parent = calls.find((c) => c.form.media_type === "CAROUSEL")!;
      expect(parent.form).toMatchObject({ children: "k1,k2,k3", caption: "Hello\n\n#a" });

      // and from there it publishes like any container
      calls = graph((c) => (c.url.includes("status_code") ? { status_code: "FINISHED" } : c.url.includes("media_publish") ? { id: "ig-post-9" } : { permalink: "https://instagram.com/p/x" }));
      expect(await new InstagramPublisher().getStatus(ctx("carousel", items), "parent-1")).toEqual({ state: "published", platformPostId: "ig-post-9", url: "https://instagram.com/p/x" });
      expect(calls.find((c) => c.url.includes("media_publish"))!.form.creation_id).toBe("parent-1");
    } finally { globalThis.fetch = realFetch; }
  });

  test("carousel: a child that failed fails the post and says which slide", async () => {
    const { InstagramPublisher } = await import("../lib/social/instagram");
    try {
      graph((c) => ({ status_code: c.url.includes("/k2?") ? "ERROR" : "FINISHED" }));
      const s = await new InstagramPublisher().publish(ctx("carousel", []), "kids:k1,k2");
      expect(s.state).toBe("failed");
      expect((s as { message: string }).message).toContain("slide 2");
    } finally { globalThis.fetch = realFetch; }
  });

  test("a lost story publish is found on /stories, but only once our own container says PUBLISHED", async () => {
    const { InstagramPublisher } = await import("../lib/social/instagram");
    const since = new Date(Date.now() - 60_000);
    const stories = { data: [
      { id: "old", timestamp: new Date(Date.now() - 3600_000).toISOString() },
      { id: "s-1", permalink: "https://instagram.com/stories/u/1", timestamp: new Date(Date.now() - 30_000).toISOString() },
      { id: "s-2", permalink: "https://instagram.com/stories/u/2", timestamp: new Date().toISOString() },
    ] };
    const story = ctx("story", [slideCtx("p1", "image/jpeg")]);
    try {
      let calls = graph((c) => (c.url.includes("status_code") ? { status_code: "PUBLISHED" } : stories));
      const hit = await new InstagramPublisher().findExisting(story, { since, uploadRef: "c-7" });
      expect(calls[0].url).toContain("/c-7?fields=status_code");
      expect(calls[1].url).toContain("/IG1/stories?");
      expect(hit).toEqual({ platformPostId: "s-2", url: "https://instagram.com/stories/u/2" });

      // Not published yet: the newest Story could be someone else's, so it is not claimed.
      calls = graph((c) => (c.url.includes("status_code") ? { status_code: "FINISHED" } : stories));
      expect(await new InstagramPublisher().findExisting(story, { since, uploadRef: "c-7" })).toBeNull();
      expect(calls.some((c) => c.url.includes("/stories"))).toBe(false);
      // and with no container to ask, nothing is claimed either
      expect(await new InstagramPublisher().findExisting(story, { since })).toBeNull();
    } finally { globalThis.fetch = realFetch; }
  });

  test("a captionless photo is never matched to some other captionless post", async () => {
    const { InstagramPublisher } = await import("../lib/social/instagram");
    const since = new Date(Date.now() - 60_000);
    const bare = ctx("photo", [slideCtx("p1", "image/jpeg")], { content: { caption: "", hashtags: "" } });
    const media = { data: [{ id: "someone-else", caption: "", timestamp: new Date().toISOString() }] };
    try {
      graph((c) => (c.url.includes("status_code") ? { status_code: "FINISHED" } : media));
      expect(await new InstagramPublisher().findExisting(bare, { since, uploadRef: "c-8" })).toBeNull();
      graph((c) => (c.url.includes("status_code") ? { status_code: "PUBLISHED" } : media));
      expect(await new InstagramPublisher().findExisting(bare, { since, uploadRef: "c-8" })).toEqual({ platformPostId: "someone-else", url: undefined });
    } finally { globalThis.fetch = realFetch; }
  });

  test("publish fails straight away on a container Instagram refused", async () => {
    const { InstagramPublisher } = await import("../lib/social/instagram");
    try {
      const calls = graph(() => ({ status_code: "ERROR" }));
      const s = await new InstagramPublisher().publish(ctx("photo", [slideCtx("p1", "image/jpeg")]), "c-9");
      expect(s.state).toBe("failed");
      expect(calls.some((c) => c.url.includes("media_publish"))).toBe(false);
    } finally { globalThis.fetch = realFetch; }
  });
});

/* ---------------- save route + worker, against the test database ---------------- */

// cookies() only works inside a Next request; the save route reads the picked profile from one. Same shared jar
// as the other files that mock next/headers (bun keeps the first module mock for the whole run).
const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

const g = globalThis as unknown as { __fmtUser?: unknown; __fmtFake?: SocialPublisher; __queueBackend?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__fmtUser !== undefined ? g.__fmtUser : realGetCurrentUser()) }));
const realFor = realRegistry.publisherForAccount;
mock.module("../lib/social/registry", () => ({
  ...realRegistry,
  publisherForAccount: (p: Parameters<typeof realFor>[0], a: Parameters<typeof realFor>[1]) => g.__fmtFake ?? realFor(p, a),
}));

class Fake implements SocialPublisher {
  constructor(readonly platform: Platform) {}
  seen: PublishContext[] = [];
  async connect() { return { url: "", state: "" }; }
  async completeConnect(): Promise<never> { throw new Error("n/a"); }
  async refreshToken() { return { accessToken: "fresh", expiresAt: new Date(Date.now() + 3600_000) }; }
  validateMedia() { return []; }
  async upload(c: PublishContext) { this.seen.push(c); return "up-1"; }
  async publish(): Promise<RemoteState> { return { state: "published", platformPostId: "ig-1", url: "https://instagram.com/p/1" }; }
  async getStatus(): Promise<RemoteState> { throw new Error("n/a"); }
  async delete() {}
  async findExisting() { return null; }
}

type Job = { name: string; data: any };
let jobs: Job[] = [];
let previousBackend: unknown;
let db: typeof import("../lib/db").db;
let runJob: typeof import("../lib/queue/handlers").runJob;
let services: typeof import("../lib/services");
let encrypt: typeof import("../lib/crypto").encrypt;
let postsRoute: typeof import("../app/api/posts/route");
let imageRoute: typeof import("../app/api/media/image/route");
let pruneStaleDrafts: typeof import("../lib/retention/prune").pruneStaleDrafts;

beforeAll(async () => {
  previousBackend = g.__queueBackend;
  g.__queueBackend = { add: async (name: string, data: unknown) => void jobs.push({ name, data }) };
  ({ db } = await import("../lib/db"));
  ({ runJob } = await import("../lib/queue/handlers"));
  services = await import("../lib/services");
  ({ encrypt } = await import("../lib/crypto"));
  postsRoute = await import("../app/api/posts/route");
  imageRoute = await import("../app/api/media/image/route");
  ({ pruneStaleDrafts } = await import("../lib/retention/prune"));
}, 60_000);
afterAll(() => {
  delete g.__fmtUser;
  g.__fmtFake = undefined;
  g.__queueBackend = previousBackend;
});
beforeEach(() => { jobs = []; });

let n = 0;
async function who() {
  n++;
  const user = await db.user.create({ data: { name: "FM", email: `fm${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  g.__fmtUser = { ...user, role: "owner", joinedAt: user.createdAt };
  await db.socialAccount.create({ data: { userId: user.id, platform: "instagram", platformUserId: `ig-${n}`, username: "u", accessToken: encrypt("tok"), status: "connected" } });
  await db.socialAccount.create({ data: { userId: user.id, platform: "youtube", platformUserId: `yt-${n}`, username: "u", accessToken: encrypt("tok"), status: "connected" } });
  return user;
}
const headers = (type = "application/json") => ({ origin: "http://localhost", host: "localhost", "content-type": type });
const uploadPhoto = (body: Buffer, type = "image/jpeg") =>
  imageRoute.POST(new NextRequest("http://localhost/api/media/image?name=a.jpg", { method: "POST", body: new Uint8Array(body), headers: headers(type) }), { params: {} } as never);
const save = (body: object) =>
  postsRoute.POST(new NextRequest("http://localhost/api/posts", { method: "POST", body: JSON.stringify(body), headers: headers() }), { params: {} } as never);
const video = (userId: string, duration = 20) =>
  db.media.create({ data: { userId, originalFilename: "v.mp4", storageKey: `fm/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1000, duration, width: 1080, height: 1920, status: "ready" } });

describe("photo upload route", () => {
  test("stores a JPEG as ready media with its size; refuses others", async () => {
    await who();
    const r = await uploadPhoto(jpeg(1080, 1350, 100));
    expect(r.status).toBe(201);
    const { media } = await r.json();
    expect(media).toMatchObject({ kind: "image", mimeType: "image/jpeg", width: 1080, height: 1350, status: "ready" });
    expect((await uploadPhoto(jpeg(10, 10), "image/png")).status).toBe(415);
    expect((await uploadPhoto(Buffer.from("not a jpeg, honest"))).status).toBe(415);
    expect((await uploadPhoto(Buffer.concat([jpeg(10, 10), Buffer.alloc(4 * 1024 * 1024)]))).status).toBe(413);
  });
});

describe("saving and sending", () => {
  test("a carousel saves its slides in order and the worker sends them in that order", async () => {
    const user = await who();
    const a = (await (await uploadPhoto(jpeg(1080, 1350))).json()).media;
    const v = await video(user.id);
    const b = (await (await uploadPhoto(jpeg(1080, 1350))).json()).media;
    const r = await save({ mediaId: a.id, title: "C", format: "carousel", items: [{ mediaId: a.id, altText: "one" }, { mediaId: v.id }, { mediaId: b.id }], targets: [{ platform: "instagram", caption: "three slides", firstComment: "first!" }] });
    expect(r.status).toBe(200);
    const { post } = await r.json();
    expect(post.format).toBe("carousel");
    expect(post.items.map((i: { id: string }) => i.id)).toEqual([a.id, v.id, b.id]);
    expect(post.items[0].altText).toBe("one");

    // reorder on a later save
    const r2 = await save({ postId: post.id, mediaId: b.id, title: "C", format: "carousel", items: [{ mediaId: b.id }, { mediaId: a.id, altText: "one" }, { mediaId: v.id }], targets: [{ platform: "instagram", caption: "three slides" }] });
    expect((await r2.json()).post.items.map((i: { id: string }) => i.id)).toEqual([b.id, a.id, v.id]);

    const fake = new Fake("instagram");
    g.__fmtFake = fake;
    await services.launchPost(user.id, post.id, "now", null, "smooth");
    await runJob("SOCIAL_UPLOAD", jobs.shift()!.data);
    await runJob("SOCIAL_PUBLISH", jobs.shift()!.data);
    const seen = fake.seen[0];
    expect(seen.format).toBe("carousel");
    expect(seen.items!.map((i) => i.id)).toEqual([b.id, a.id, v.id]);
    expect(seen.items![1].altText).toBe("one");
    expect(seen.media.id).toBe(b.id);
    expect(seen.cover ?? null).toBeNull();
    const t = await db.postTarget.findFirstOrThrow({ where: { postId: post.id } });
    expect(t.platformStatus).toBe("published");
  });

  test("a story drops the first comment and goes out without a caption", async () => {
    const user = await who();
    const v = await video(user.id, 15);
    const r = await save({ mediaId: v.id, title: "S", format: "story", items: [{ mediaId: v.id }], targets: [{ platform: "instagram", firstComment: "nope" }] });
    expect(r.status).toBe(200);
    const { post } = await r.json();
    expect(post.format).toBe("story");
    expect((await db.postTarget.findFirstOrThrow({ where: { postId: post.id } })).firstComment).toBeNull();
    const fake = new Fake("instagram");
    g.__fmtFake = fake;
    await services.launchPost(user.id, post.id, "now", null, "smooth");
    await runJob("SOCIAL_UPLOAD", jobs.shift()!.data);
    expect(fake.seen[0].format).toBe("story");
  });

  test("a stale poll never writes its older ref over a newer one, and stops instead of polling on", async () => {
    const user = await who();
    const a = (await (await uploadPhoto(jpeg(1080, 1350))).json()).media;
    const b = (await (await uploadPhoto(jpeg(1080, 1350))).json()).media;
    const { post } = await (await save({ mediaId: a.id, title: "C", format: "carousel", items: [{ mediaId: a.id }, { mediaId: b.id }], targets: [{ platform: "instagram", caption: "two" }] })).json();
    // While this job is busy, another job makes the carousel parent and moves the ref on to it.
    class Racer extends Fake {
      async publish(): Promise<RemoteState> {
        await db.postTarget.updateMany({ where: { postId: post.id }, data: { uploadRef: "parent-winner" } });
        return { state: "processing", ref: "parent-loser" };
      }
    }
    g.__fmtFake = new Racer("instagram");
    await services.launchPost(user.id, post.id, "now", null, "smooth");
    await runJob("SOCIAL_UPLOAD", jobs.shift()!.data);
    jobs = jobs.filter((j) => j.name === "SOCIAL_PUBLISH");
    await runJob("SOCIAL_PUBLISH", jobs.shift()!.data);
    const t = await db.postTarget.findFirstOrThrow({ where: { postId: post.id } });
    expect(t.uploadRef).toBe("parent-winner");
    expect(jobs.filter((j) => j.name === "SOCIAL_STATUS_CHECK").length).toBe(0);
  });

  test("the worker refuses a story over 60 s before it reaches Instagram", async () => {
    const user = await who();
    const v = await video(user.id, 90);
    const { post } = await (await save({ mediaId: v.id, title: "S", format: "story", items: [{ mediaId: v.id }], targets: [{ platform: "instagram" }] })).json();
    const fake = new Fake("instagram");
    g.__fmtFake = fake;
    await services.launchPost(user.id, post.id, "now", null, "smooth");
    await runJob("SOCIAL_UPLOAD", jobs.shift()!.data).catch(() => {});
    expect(fake.seen.length).toBe(0);
    const t = await db.postTarget.findFirstOrThrow({ where: { postId: post.id } });
    expect(t.platformStatus).toBe("failed");
    expect(t.errorCode).toBe("MEDIA_REJECTED");
    expect(t.errorMessage ?? "").toContain("60s");
  });

  test("refuses formats a platform can't take, photos posted as video, and slides that aren't yours", async () => {
    const user = await who();
    const a = (await (await uploadPhoto(jpeg(1080, 1080))).json()).media;
    const yt = await save({ mediaId: a.id, title: "P", format: "photo", items: [{ mediaId: a.id }], targets: [{ platform: "youtube" }] });
    expect(yt.status).toBe(400);
    expect((await yt.json()).code).toBe("FORMAT_UNSUPPORTED");
    expect((await save({ mediaId: a.id, title: "P", targets: [{ platform: "instagram", caption: "x" }] })).status).toBe(400);
    const v = await video(user.id);
    expect((await save({ mediaId: v.id, title: "P", format: "photo", items: [{ mediaId: v.id }], targets: [{ platform: "instagram" }] })).status).toBe(400);
    const theirs = await video((await db.user.create({ data: { name: "O", email: `o${Date.now()}@test.dev`, passwordHash: "x" } })).id);
    g.__fmtUser = { ...user, role: "owner", joinedAt: user.createdAt };
    expect((await save({ mediaId: a.id, title: "P", format: "carousel", items: [{ mediaId: a.id }, { mediaId: theirs.id }], targets: [{ platform: "instagram" }] })).status).toBe(404);
  });

  test("pruning an old draft takes its slides with it, but not a slide another post uses", async () => {
    const user = await who();
    const a = await video(user.id);
    const b = await video(user.id);
    const shared = await video(user.id);
    const { post } = await (await save({ mediaId: a.id, title: "Old", format: "carousel", items: [{ mediaId: a.id }, { mediaId: b.id }, { mediaId: shared.id }], targets: [{ platform: "instagram", caption: "x" }] })).json();
    const { post: other } = await (await save({ mediaId: shared.id, title: "Keep", format: "story", items: [{ mediaId: shared.id }], targets: [{ platform: "instagram" }] })).json();
    await db.post.update({ where: { id: post.id }, data: { updatedAt: new Date(Date.now() - 400 * 864e5) } });
    await pruneStaleDrafts();
    expect(await db.post.findUnique({ where: { id: post.id } })).toBeNull();
    expect(await db.media.findUnique({ where: { id: a.id } })).toBeNull();
    expect(await db.media.findUnique({ where: { id: b.id } })).toBeNull();
    expect(await db.media.findUnique({ where: { id: shared.id } })).not.toBeNull();
    expect(await db.post.findUnique({ where: { id: other.id } })).not.toBeNull();
  });
});

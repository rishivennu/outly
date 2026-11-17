/**
 * R1178 blog scheduler: the cron tick (start, resume, late), retry, forDate, "Approve and publish on ...",
 * skipped days, and the calendar/history/topics the admin calendar reads. Every time is passed in, so the
 * results do not depend on the clock. Run with TEST_DB=r1178a.db.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const realCache = require("next/cache");
mock.module("next/cache", () => ({ ...realCache, revalidatePath: () => {}, revalidateTag: () => {} }));

const ADMIN = { id: "adm-r1178", name: "Asha", login: "asha", role: "marketing" as const };
const g = globalThis as unknown as { __r1178Admin?: boolean; __r1178NoKey?: boolean; __blogLlmReal?: boolean; __r1178Calls: string[] };
g.__r1178Calls = [];
// Pin the real getAdmin before mocking (mock.module rewrites the module's own bindings); only this file sees an admin.
const realAuth = require("../lib/admin/auth");
const realGetAdmin = realAuth.getAdmin;
mock.module("../lib/admin/auth", () => ({ ...realAuth, getAdmin: async () => (g.__r1178Admin ? ADMIN : realGetAdmin()) }));

// Same canned stage outputs as round-1175 (its fakes, reused) with different topics, so a shared test database with
// 1175's articles does not trip the overlap checks. Real functions pinned first; __blogLlmReal still passes through.
const realLlm = require("../lib/blog/llm");
const real = { blogReady: realLlm.blogReady, blogWebReady: realLlm.blogWebReady, blogJson: realLlm.blogJson, blogWebJson: realLlm.blogWebJson };
const KW = "threads replies vanish";
const WORDS = ("A creator posts the same kind of reel for weeks, then one morning the views are a third of what they were. " +
  "Nothing in the account looks different. The usual advice is to post more, which rarely helps and often makes the slide worse. " +
  "Start by reading the first three seconds of the last ten posts and note where people leave; the pattern is usually visible without any tool. ").trim();
const paragraph = (n: number) => Array.from({ length: n }, () => WORDS).join(" ");
const SECTIONS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map((k, i) => ({ key: k, heading: ["Why your reach dropped", "What is actually happening", "Why it happens", "The mistakes that make it worse", "What the evidence says", "What to do this week", "What to measure", "Where this will not work", "How platforms differ", "Where Outlly fits"][i], points: ["one", "two"] }));
const draft = (keys: string[]) =>
  SECTIONS.filter((s) => keys.includes(s.key))
    .map((s, i) => `## ${s.heading}\n\n${paragraph(2)}${i === 0 ? ` This is why an ${KW} feels sudden. See the [Outlly features](/#features).` : ""}\n\n- Check the hook\n- Check the first comment\n- [ ] Write down the number`)
    .join("\n\n");
mock.module("../lib/blog/llm", () => ({
  ...realLlm,
  blogReady: () => (g.__blogLlmReal ? real.blogReady() : !g.__r1178NoKey),
  blogWebReady: () => (g.__blogLlmReal ? real.blogWebReady() : true),
  blogJson: async (system: string, prompt: string, opts?: unknown) => {
    if (g.__blogLlmReal) return real.blogJson(system, prompt, opts as never);
    g.__r1178Calls.push(prompt.slice(0, 40));
    if (prompt.includes('"candidates"'))
      return { model: "kimi", data: { candidates: [
        { topic: "Threads replies vanish after posting: what to do", problem: "Replies disappear", primaryKeyword: KW, searchIntent: "informational", category: "Growth", score: 9, basis: "Common question" },
        { topic: "LinkedIn carousel reach falls on weekends", problem: "Weekend dip", primaryKeyword: "linkedin carousel weekend reach", searchIntent: "informational", category: "Growth", score: 7, basis: "Frequent complaint" },
        { topic: "Pinterest pins stop getting saves", problem: "Saves fall", primaryKeyword: "pinterest saves drop", searchIntent: "informational", category: "Growth", score: 6, basis: "Evergreen" },
      ], chosen: 0, reason: "Most searched" } };
    if (prompt.includes('"workingTitle"')) return { model: "kimi", data: { workingTitle: "Threads replies vanish after posting: what to do", sections: SECTIONS, featureTieIn: "analytics", tieInReason: "Reading your own numbers" } };
    if (prompt.includes("the first half")) return { model: "kimi", data: { markdown: draft(["B", "C", "D", "E"]) } };
    if (prompt.includes("the second half")) return { model: "kimi", data: { markdown: draft(["F", "G", "H", "I", "J"]) } };
    if (prompt.includes('"seoTitle"')) return { model: "kimi", data: { seoTitle: "Threads Replies Vanish: What to Do", metaDescription: "Your Threads replies vanish after posting. Here is what is actually happening, the mistakes that make it worse, and what to check this week.", slug: "threads-replies-vanish-what-to-do", primaryKeyword: KW, secondaryKeywords: ["reels views down"], searchIntent: "informational", relatedQuestions: ["Why did my reach drop?"], category: "Growth", tags: ["instagram"], ogTitle: "Instagram reach drop", ogDescription: "What to check first.", internalLinks: [{ href: "/#features", label: "Outlly features" }], excerpt: "What to check when your reach falls overnight." } };
    if (prompt.includes('"onePainPoint"')) return { model: "kimi", data: { checks: { onePainPoint: { ok: true, note: "" }, practical: { ok: true, note: "" }, supported: { ok: true, note: "" }, filler: { ok: true, note: "" }, titleAccurate: { ok: true, note: "" }, tieIn: { ok: true, note: "" } }, editorNote: "Tight." } };
    throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
  },
  blogWebJson: async (system: string, prompt: string, opts?: unknown) => {
    if (g.__blogLlmReal) return real.blogWebJson(system, prompt, opts as never);
    g.__r1178Calls.push("web");
    return {
      webUsed: true,
      citations: [{ url: "https://help.instagram.com/reach-basics", title: "About reach", content: "" }],
      data: {
        whatHappens: "Distribution to non-followers falls first.",
        whyItHappens: ["Weaker hooks"],
        mistakes: ["Posting more"],
        facts: [{ claim: "Reach counts unique accounts", kind: "fact", sourceUrl: "https://help.instagram.com/reach-basics" }],
        solutions: ["Audit hooks"],
        caveats: ["Small accounts swing more"],
        platformNotes: [{ platform: "Instagram", note: "Reels and feed are ranked separately" }],
        sources: [{ url: "https://help.instagram.com/reach-basics", title: "About reach", publisher: "Instagram Help", kind: "official", supports: "Reach definition" }],
      },
    };
  },
}));

import { db } from "../lib/db";
import { env } from "../lib/env";
import { saveConfig } from "../lib/settings";
import { BLOG_DEFAULT, blogConfigIssues, pruneSkipDates } from "../lib/blog/config";
import { jobView, retryJob, runStage, startJob } from "../lib/blog/job";
import { getPost, publishDue, schedulePost, unschedulePost, updatePost } from "../lib/blog/posts";
import { blogTick, kickBlogTick } from "../lib/blog/schedule";
import { addBacklogTopic, backlogTopics, blogHistory, calendarMonth, removeBacklogTopic } from "../lib/blog/calendar";

// Asia/Kolkata (default): 06:00 start = 00:30Z, 08:00 ready-by = 02:30Z.
const D1 = "2030-03-10";
const at = (iso: string) => new Date(iso);
const cfg = (over: Record<string, unknown> = {}) => saveConfig("blog", { ...BLOG_DEFAULT, ...over });
const req = (url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) }) as never;
const fresh = (id: string, now: Date, ageMs: number) => db.blogJob.update({ where: { id }, data: { updatedAt: new Date(now.getTime() - ageMs) } });
const savedSecret = env.CRON_SECRET;

beforeAll(async () => {
  await cfg();
});
afterAll(async () => {
  env.CRON_SECRET = savedSecret;
  g.__r1178Admin = false;
  g.__r1178NoKey = false;
  await cfg();
});

describe("1178 cron route auth", () => {
  test("503 without CRON_SECRET, 401 with a wrong bearer", async () => {
    const { GET, POST } = await import("../app/api/cron/blog/route");
    env.CRON_SECRET = "";
    expect((await GET(req("/api/cron/blog"))).status).toBe(503);
    env.CRON_SECRET = "r1178-secret";
    expect((await POST(req("/api/cron/blog", "POST", undefined, { authorization: "Bearer nope" }))).status).toBe(401);
    expect((await GET(req("/api/cron/blog"))).status).toBe(401);
  });
});

describe("1178 skipped days", () => {
  test("blogConfigIssues validates skipDates; prune drops days older than 30 days", () => {
    expect(blogConfigIssues({ ...BLOG_DEFAULT, skipDates: ["2030-03-10"] })).toEqual([]);
    expect(blogConfigIssues({ ...BLOG_DEFAULT, skipDates: ["2030-02-30"] }).length).toBe(1);
    expect(blogConfigIssues({ ...BLOG_DEFAULT, skipDates: ["10-03-2030"] }).length).toBe(1);
    const many = Array.from({ length: 121 }, (_, i) => new Date(Date.UTC(2030, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
    expect(blogConfigIssues({ ...BLOG_DEFAULT, skipDates: many })).toEqual(["At most 120 skipped days."]);
    expect(pruneSkipDates(["2030-03-12", "2030-01-01", "2030-02-10", "2030-03-12"], "2030-03-10")).toEqual(["2030-02-10", "2030-03-12"]);
  });
});

let landedPostId = "";
describe("1178 tick: start, resume, late", () => {
  let jobId = "";
  test("before startTime nothing starts", async () => {
    const s = await blogTick(at(`${D1}T00:20:00Z`));
    expect(s.started).toBeNull();
    expect(s.startReason).toBe("before start time");
    expect(await db.blogJob.count({ where: { forDate: D1 } })).toBe(0);
  });
  test("not on a skipped day, not while paused, not without an AI key", async () => {
    await cfg({ skipDates: [D1] });
    expect((await blogTick(at(`${D1}T00:40:00Z`))).startReason).toBe("skipped day");
    await cfg({ paused: true });
    const p = await blogTick(at(`${D1}T00:40:00Z`));
    expect(p.paused).toBe(true);
    expect(p.started).toBeNull();
    await cfg();
    g.__r1178NoKey = true;
    expect((await blogTick(at(`${D1}T00:40:00Z`))).startReason).toBe("no AI key");
    g.__r1178NoKey = false;
    expect(await db.blogJob.count({ where: { forDate: D1 } })).toBe(0);
  });
  test("at startTime it starts once, takes the oldest backlog topic and runs exactly one stage", async () => {
    const first = await addBacklogTopic({ topic: "Instagram reach drop", problem: "Views fell overnight" });
    await addBacklogTopic({ topic: "Second idea" });
    const s = await blogTick(at(`${D1}T00:31:00Z`));
    expect(s.started).toBeTruthy();
    jobId = s.started!;
    const job = await db.blogJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.kind).toBe("scheduled");
    expect(job.forDate).toBe(D1);
    expect(job.startedBy).toBe("schedule");
    expect(job.topicHint).toBe("Instagram reach drop: Views fell overnight");
    expect(s.resumed).toEqual({ id: jobId, stage: "research", status: "running" });
    expect((await db.blogTopic.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("used");
    expect((await backlogTopics()).backlog.map((t) => t.topic)).toEqual(["Second idea"]);
    expect(await db.adminEvent.count({ where: { kind: "blog.started", title: "The daily blog run started", body: "From the backlog: Instagram reach drop" } })).toBe(1);
  });
  test("a second tick does not start another run, and leaves a run someone is driving alone", async () => {
    const now = at(`${D1}T00:35:00Z`);
    await fresh(jobId, now, 10_000);
    const s = await blogTick(now);
    expect(s.started).toBeNull();
    // The day's scheduled run exists (it is this one), which is checked before "a run is going".
    expect(s.startReason).toBe("already ran today");
    expect(s.resumed).toBeNull();
    expect(await db.blogJob.count({ where: { forDate: D1 } })).toBe(1);
  });
  test("a stale running job is resumed by exactly one stage", async () => {
    const now = at(`${D1}T00:40:00Z`);
    await fresh(jobId, now, 120_000);
    const before = (await jobView(jobId)).events.filter((e) => e.status === "done").length;
    const s = await blogTick(now);
    expect(s.resumed).toEqual({ id: jobId, stage: "outline", status: "running" });
    expect((await jobView(jobId)).events.filter((e) => e.status === "done").length).toBe(before + 1);
  });
  test("past readyBy: one delayed event and one admin alert per job, never marked ready", async () => {
    const now = at(`${D1}T02:45:00Z`);
    await fresh(jobId, now, 5_000);
    const s1 = await blogTick(now);
    expect(s1.delayed).toEqual([jobId]);
    await fresh(jobId, now, 5_000);
    const s2 = await blogTick(at(`${D1}T02:50:00Z`));
    expect(s2.delayed).toEqual([]);
    const v = await jobView(jobId);
    const delayed = v.events.filter((e) => e.status === "delayed");
    expect(delayed.length).toBe(1);
    expect(delayed[0].message).toBe("Past 08:00, still on outline");
    expect(v.status).toBe("running");
    expect(await db.adminEvent.count({ where: { kind: "blog.delayed", body: "Past 08:00, still on outline" } })).toBe(1);
  });
  test("once the day's scheduled run exists (any status) the tick never starts another", async () => {
    for (let i = 0; i < 5; i++) await runStage(jobId);
    const v = await jobView(jobId);
    expect(v.status).toBe("done");
    expect(v.postId).toBeTruthy();
    landedPostId = v.postId!;
    expect((await getPost(landedPostId)).status).toBe("pending");
    const s = await blogTick(at(`${D1}T03:00:00Z`));
    expect(s.started).toBeNull();
    expect(s.startReason).toBe("already ran today");
  });
});

describe("1178 approve and publish on a date", () => {
  let postId = "";
  const T0 = at(`${D1}T03:00:00Z`);
  const WHEN = at(`${D1}T05:00:00Z`);
  beforeAll(async () => {
    postId = landedPostId;
  });
  test("publishDue never publishes a pending draft, even one that carries a date", async () => {
    await db.blogPost.update({ where: { id: postId }, data: { scheduledFor: at(`${D1}T01:00:00Z`) } });
    const r = await publishDue(T0);
    expect(r.published).toEqual([]);
    expect((await getPost(postId)).status).toBe("pending");
    await db.blogPost.update({ where: { id: postId }, data: { scheduledFor: null } });
  });
  test("schedulePost validates the time and runs the publish checks first (409)", async () => {
    await expect(schedulePost(ADMIN, postId, at(`${D1}T02:00:00Z`), T0)).rejects.toThrow("future");
    await expect(schedulePost(ADMIN, postId, new Date(T0.getTime() + 91 * 86_400_000), T0)).rejects.toThrow("90 days");
    await expect(schedulePost(ADMIN, postId, "not a date", T0)).rejects.toThrow("valid date");
    const body = (await getPost(postId)).bodyMd;
    await updatePost(ADMIN, postId, { bodyMd: "## Only one\n\nToo short." });
    let err: any = null;
    await schedulePost(ADMIN, postId, WHEN, T0).catch((e) => (err = e));
    expect(err?.status).toBe(409);
    expect(String(err?.message)).toContain("too short");
    await updatePost(ADMIN, postId, { bodyMd: body });
  });
  test("schedule, unschedule (stays approved), reschedule", async () => {
    const a = await schedulePost(ADMIN, postId, WHEN, T0);
    expect(a.status).toBe("approved");
    expect(a.scheduledFor).toBe(WHEN.toISOString());
    expect(a.reviewedBy).toBe("asha");
    const b = await unschedulePost(ADMIN, postId);
    expect(b.status).toBe("approved");
    expect(b.scheduledFor).toBeNull();
    const c = await schedulePost(ADMIN, postId, WHEN, T0);
    expect(c.scheduledFor).toBe(WHEN.toISOString());
  });
  test("publishDue waits for the time, then publishes as the reviewer", async () => {
    expect((await publishDue(at(`${D1}T04:59:00Z`))).published).toEqual([]);
    const r = await publishDue(at(`${D1}T05:01:00Z`));
    expect(r.published).toEqual([postId]);
    const p = await getPost(postId);
    expect(p.status).toBe("published");
    expect(p.publishedBy).toBe("asha");
    expect(p.scheduledFor).toBeNull();
    expect(await db.adminEvent.count({ where: { kind: "blog.published", title: `Scheduled article "${p.title}" is live`, href: `/blog/${p.slug}` } })).toBe(1);
  });
  test("a scheduled article that fails its checks stays approved, loses its date and alerts once", async () => {
    const live = await getPost(postId);
    const dup = await db.blogPost.create({ data: { slug: "dup-of-live", title: live.title, bodyMd: live.bodyMd, metaDescription: "m", category: "Growth", primaryKeyword: KW, status: "approved", reviewedBy: "asha", scheduledFor: at(`${D1}T05:00:00Z`) } });
    const r = await publishDue(at(`${D1}T05:02:00Z`));
    expect(r.failed.map((f) => f.id)).toEqual([dup.id]);
    const after = await db.blogPost.findUniqueOrThrow({ where: { id: dup.id } });
    expect(after.status).toBe("approved");
    expect(after.scheduledFor).toBeNull();
    expect((await publishDue(at(`${D1}T05:03:00Z`))).failed).toEqual([]);
    expect(await db.adminEvent.count({ where: { kind: "blog.publish_failed", href: `/admin/blog/review/${dup.id}` } })).toBe(1);
    await db.blogPost.delete({ where: { id: dup.id } });
  });
});

describe("1178 retry and forDate", () => {
  const NOW = at("2030-04-01T04:00:00Z");
  let seq = 10;
  const seed = (forDate: string, data: object, status = "failed") =>
    db.blogJob.create({ data: { forDate, kind: "manual", seq: seq++, stage: "failed", status, error: "AI timed out", finishedAt: NOW, stageData: JSON.stringify({ ...data, rewriteOf: "" }) } });
  test("retryJob keeps completed stages and resumes at the first unsaved one", async () => {
    const topic = { candidates: [{ topic: "Kept topic", problem: "p", primaryKeyword: "kept", searchIntent: "informational", category: "Growth", score: 5, basis: "b" }], chosen: 0, reason: "r" };
    const job = await seed("2030-04-02", { topic, research: { sources: [] } });
    const v = await retryJob(job.id, "asha");
    expect(v.status).toBe("running");
    expect(v.stage).toBe("outline");
    expect(v.attempts).toBe(0);
    expect(v.error).toBe("");
    expect(v.finishedAt).toBeNull();
    expect(v.topic).toBe("Kept topic");
    expect(v.events.at(-1)).toMatchObject({ stage: "outline", status: "started", message: "Retry by asha" });
    const data = JSON.parse((await db.blogJob.findUniqueOrThrow({ where: { id: job.id } })).stageData);
    expect(Object.keys(data)).toContain("research");
    let err: any = null;
    await retryJob(job.id, "asha").catch((e) => (err = e));
    expect(err?.status).toBe(409);
  });
  test("retryJob refuses while another run is going for that day, and while paused", async () => {
    const a = await seed("2030-04-02", {}, "cancelled");
    let err: any = null;
    await retryJob(a.id, "asha").catch((e) => (err = e));
    expect(err?.status).toBe(409);
    const b = await seed("2030-04-03", {});
    await cfg({ paused: true });
    err = null;
    await retryJob(b.id, "asha").catch((e) => (err = e));
    expect(err?.status).toBe(409);
    await cfg();
    expect((await retryJob(b.id, "asha")).stage).toBe("topic");
    await db.blogJob.updateMany({ where: { forDate: { in: ["2030-04-02", "2030-04-03"] }, status: "running" }, data: { status: "cancelled" } });
  });
  test("forDate: a real day from today to 60 days ahead", async () => {
    for (const bad of ["2030-02-30", "2030-03-31", "2030-06-01", "tomorrow"]) {
      let err: any = null;
      await startJob({ kind: "scheduled", by: "asha", forDate: bad, now: NOW }).catch((e) => (err = e));
      expect(err?.status).toBe(400);
    }
    const r = await startJob({ kind: "scheduled", by: "asha", forDate: "2030-05-20", now: NOW });
    expect(r.job.forDate).toBe("2030-05-20");
    expect(r.job.kind).toBe("scheduled");
    await db.blogJob.update({ where: { id: r.job.id }, data: { status: "cancelled" } });
    // That day's scheduled run now exists, so the tick on the day will not start a second one.
    expect((await blogTick(at("2030-05-20T01:00:00Z"), { budgetMs: 0 })).startReason).toBe("already ran today");
  });
});

describe("1178 calendar, history and topics", () => {
  const NOW = at("2031-05-20T03:00:00Z"); // 08:30 in Kolkata: past readyBy
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    await cfg({ skipDates: ["2031-05-25"] });
    const post = (slug: string, data: Record<string, unknown>) => db.blogPost.create({ data: { slug, title: slug, ...data } }).then((p) => (ids[slug] = p.id));
    const job = (key: string, data: Record<string, unknown>) => db.blogJob.create({ data: { forDate: "2031-05-01", ...data } as never }).then((j: { id: string }) => (ids[key] = j.id));
    await post("live", { status: "published", publishedAt: at("2031-05-03T20:00:00Z"), createdAt: at("2031-05-01T10:00:00Z") });
    await post("booked", { status: "approved", scheduledFor: at("2031-05-10T04:00:00Z"), createdAt: at("2031-05-02T10:00:00Z") });
    await job("doneJob", { forDate: "2031-05-12", kind: "scheduled", status: "done", stage: "done" });
    await post("waiting", { status: "pending", jobId: ids.doneJob, createdAt: at("2031-05-11T10:00:00Z") });
    await db.blogJob.update({ where: { id: ids.doneJob }, data: { postId: ids.waiting } });
    await post("replaced", { status: "rejected", rejectReason: "Replaced by a rewrite (waiting)", createdAt: at("2031-05-11T09:00:00Z") });
    await job("failedJob", { forDate: "2031-05-15", status: "failed", stage: "failed", error: "AI timed out", startedAt: at("2031-05-15T00:31:00Z") });
    await job("lateJob", { forDate: "2031-05-20", kind: "scheduled", status: "running", stage: "draft1", startedAt: at("2031-05-20T00:31:00Z") });
    await job("retrying", { forDate: "2031-05-28", kind: "manual", status: "running", stage: "research", error: "AI timed out", startedAt: at("2031-05-19T10:00:00Z") });
    await job("blocked", { forDate: "2031-05-20", status: "failed", stage: "failed", error: "x", startedAt: at("2031-05-19T09:00:00Z") });
  });
  test("calendarMonth places every item on its day in the blog timezone", async () => {
    const c = await calendarMonth("2031-05", NOW);
    expect(c.days.length).toBe(31);
    expect(c.today).toBe("2031-05-20");
    const day = (d: string) => c.days.find((x) => x.date === `2031-05-${d}`)!;
    expect(day("04").items.map((i) => [i.title, i.status])).toEqual([["live", "published"]]);
    expect(day("10").items.map((i) => [i.title, i.status])).toEqual([["booked", "scheduled"]]);
    expect(day("12").items.map((i) => [i.title, i.status, i.href])).toEqual([["waiting", "pending", `/admin/blog/review/${ids.waiting}`]]);
    expect(day("11").items).toEqual([]);
    expect(day("15").items.map((i) => [i.kind, i.status, i.note])).toEqual([["job", "failed", "AI timed out"]]);
    const late = day("20").items.find((i) => i.id === ids.lateJob)!;
    expect([late.status, late.note, late.href]).toEqual(["delayed", "Writing the article (first half)", "/admin/blog/generate"]);
    // The earlier failed run on the 20th was replaced by the later one.
    expect(day("20").items.some((i) => i.id === ids.blocked)).toBe(false);
    expect(day("28").items.map((i) => i.status)).toEqual(["running"]);
  });
  test("scheduledRun: today only while no scheduled run exists; never on past or skipped days", async () => {
    const c = await calendarMonth("2031-05", NOW);
    const flag = (d: string) => c.days.find((x) => x.date === `2031-05-${d}`)!;
    expect(flag("19").scheduledRun).toBe(false);
    expect(flag("20").scheduledRun).toBe(false);
    expect(flag("21").scheduledRun).toBe(true);
    expect(flag("25").skipped).toBe(true);
    expect(flag("25").scheduledRun).toBe(false);
    await cfg({ paused: true });
    expect((await calendarMonth("2031-05", NOW)).days.some((d) => d.scheduledRun)).toBe(false);
    await cfg({ skipDates: ["2031-05-25"] });
    await expect(calendarMonth("2031-13", NOW)).rejects.toThrow("YYYY-MM");
  });
  test("history: retrying, delayed and canRetry", async () => {
    const rows = await blogHistory(200, NOW);
    const row = (k: string) => rows.find((r) => r.jobId === ids[k])!;
    expect(row("retrying").status).toBe("retrying");
    expect(row("lateJob").status).toBe("delayed");
    expect(row("failedJob")).toMatchObject({ status: "failed", canRetry: true, date: "2031-05-15" });
    expect(row("blocked").canRetry).toBe(false);
    expect(row("doneJob")).toMatchObject({ status: "done", canRetry: false, postId: ids.waiting });
    expect(rows[0].startedAt >= rows[1].startedAt).toBe(true);
  });
  test("topics: candidates exclude what is written; a candidate moves to the backlog; only backlog is deletable", async () => {
    const t = await backlogTopics();
    const cands = t.candidates.map((c) => c.topic);
    expect(cands).toContain("LinkedIn carousel reach falls on weekends");
    expect(cands).not.toContain("Threads replies vanish after posting: what to do");
    expect(new Set(cands).size).toBe(cands.length);
    const c = t.candidates.find((x) => x.topic === "LinkedIn carousel reach falls on weekends")!;
    await expect(removeBacklogTopic(c.id)).rejects.toThrow("Only a backlog topic");
    const moved = await addBacklogTopic({ fromId: c.id });
    expect(moved.status).toBe("backlog");
    expect((await backlogTopics()).candidates.some((x) => x.id === c.id)).toBe(false);
    await removeBacklogTopic(moved.id);
    expect((await backlogTopics()).backlog.some((x) => x.id === moved.id)).toBe(false);
  });
});

describe("1178 admin routes", () => {
  beforeAll(() => {
    g.__r1178Admin = true;
  });
  test("settings save keeps skipDates when the form leaves them out, and prunes old ones when sent", async () => {
    await cfg({ skipDates: ["2099-01-01"] });
    const { PUT } = await import("../app/api/admin/blog/settings/route");
    const r1 = await PUT(req("/api/admin/blog/settings", "PUT", { tone: "friendly" }), ctx());
    expect(r1.status).toBe(200);
    expect((await r1.json()).config.skipDates).toEqual(["2099-01-01"]);
    const r2 = await PUT(req("/api/admin/blog/settings", "PUT", { skipDates: ["2099-01-02", "2000-01-01"] }), ctx());
    expect((await r2.json()).config.skipDates).toEqual(["2099-01-02"]);
    const r3 = await PUT(req("/api/admin/blog/settings", "PUT", { skipDates: ["2099-02-30"] }), ctx());
    expect(r3.status).toBe(400);
  });
  test("schedule route: skip and unskip a day; a past day cannot be skipped", async () => {
    await cfg();
    const { POST } = await import("../app/api/admin/blog/schedule/route");
    const a = await POST(req("/api/admin/blog/schedule", "POST", { action: "skip", date: "2099-03-01" }), ctx());
    expect((await a.json()).skipDates).toEqual(["2099-03-01"]);
    const b = await POST(req("/api/admin/blog/schedule", "POST", { action: "unskip", date: "2099-03-01" }), ctx());
    expect((await b.json()).skipDates).toEqual([]);
    expect((await POST(req("/api/admin/blog/schedule", "POST", { action: "skip", date: "2001-01-01" }), ctx())).status).toBe(400);
    expect((await POST(req("/api/admin/blog/schedule", "POST", { action: "skip", date: "soon" }), ctx())).status).toBe(400);
  });
  test("posts route: schedule and unschedule actions", async () => {
    const p = await db.blogPost.create({ data: { slug: "route-draft", title: "Route draft", bodyMd: "## Short\n\nToo short.", status: "pending" } });
    const { POST } = await import("../app/api/admin/blog/posts/[id]/route");
    const when = new Date(Date.now() + 86_400_000).toISOString();
    const bad = await POST(req(`/api/admin/blog/posts/${p.id}`, "POST", { action: "schedule", at: when }), ctx({ id: p.id }));
    expect(bad.status).toBe(409);
    expect((await bad.json()).error).toContain("too short");
    await db.blogPost.update({ where: { id: p.id }, data: { status: "approved", scheduledFor: new Date(when) } });
    const off = await POST(req(`/api/admin/blog/posts/${p.id}`, "POST", { action: "unschedule" }), ctx({ id: p.id }));
    expect((await off.json()).post).toMatchObject({ status: "approved", scheduledFor: null });
    await db.blogPost.delete({ where: { id: p.id } });
  });
  test("calendar, history, topics and retry routes", async () => {
    const cal = await import("../app/api/admin/blog/calendar/route");
    expect((await cal.GET(req("/api/admin/blog/calendar?month=2031-05"), ctx())).status).toBe(200);
    expect((await cal.GET(req("/api/admin/blog/calendar?month=May"), ctx())).status).toBe(400);
    const hist = await import("../app/api/admin/blog/history/route");
    expect(Array.isArray((await (await hist.GET(req("/api/admin/blog/history"), ctx())).json()).rows)).toBe(true);
    const topics = await import("../app/api/admin/blog/topics/route");
    const made = await topics.POST(req("/api/admin/blog/topics", "POST", { topic: "Batching a week of reels" }), ctx());
    expect(made.status).toBe(201);
    const t = (await made.json()).topic;
    expect(t).toMatchObject({ status: "backlog", topic: "Batching a week of reels" });
    expect((await topics.DELETE(req(`/api/admin/blog/topics?id=${t.id}`, "DELETE"), ctx())).status).toBe(200);
    expect((await topics.DELETE(req(`/api/admin/blog/topics?id=${t.id}`, "DELETE"), ctx())).status).toBe(404);
    const done = await db.blogJob.findFirstOrThrow({ where: { status: "done" } });
    const retry = await import("../app/api/admin/blog/jobs/[id]/retry/route");
    expect((await retry.POST(req(`/api/admin/blog/jobs/${done.id}/retry`, "POST", {}), ctx({ id: done.id }))).status).toBe(409);
    const jobs = await import("../app/api/admin/blog/jobs/route");
    expect((await jobs.POST(req("/api/admin/blog/jobs", "POST", { forDate: "2001-01-01" }), ctx())).status).toBe(400);
  });
});

describe("1178 kick from the minute sweep", () => {
  const realFetch = globalThis.fetch;
  afterAll(() => {
    globalThis.fetch = realFetch;
  });
  test("idle with nothing due (no fetch); kicks /api/cron/blog with the bearer when a run is stale", async () => {
    const calls: { url: string; auth: string }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), auth: String((init?.headers as Record<string, string>)?.authorization ?? "") });
      return new Response("{}");
    }) as unknown as typeof fetch;
    env.CRON_SECRET = "r1178-secret";
    await db.blogJob.updateMany({ where: { status: "running" }, data: { status: "cancelled" } });
    await db.blogPost.updateMany({ where: { scheduledFor: { not: null } }, data: { scheduledFor: null } });
    await cfg({ schedule: { ...BLOG_DEFAULT.schedule, enabled: false } });
    const now = at("2032-01-05T10:00:00Z");
    expect(await kickBlogTick("https://outlly.test", now)).toBe("idle");
    expect(calls).toEqual([]);
    const j = await db.blogJob.create({ data: { forDate: "2032-01-05", status: "running", stage: "research" } });
    await fresh(j.id, now, 120_000);
    expect(await kickBlogTick("https://outlly.test", now)).toBe("kicked");
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([{ url: "https://outlly.test/api/cron/blog", auth: "Bearer r1178-secret" }]);
    env.CRON_SECRET = "";
    expect(await kickBlogTick("https://outlly.test", now)).toBe("no secret");
    await db.blogJob.update({ where: { id: j.id }, data: { status: "cancelled" } });
  });
  test("an authorised cron call returns the tick summary (paused: nothing starts)", async () => {
    env.CRON_SECRET = "r1178-secret";
    await cfg({ paused: true });
    const { GET } = await import("../app/api/cron/blog/route");
    const r = await GET(req("/api/cron/blog", "GET", undefined, { authorization: "Bearer r1178-secret" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toMatchObject({ paused: true, started: null });
  });
});

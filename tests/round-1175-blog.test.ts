import { describe, expect, test, beforeAll, mock } from "bun:test";

// revalidatePath needs a Next request; outside one it throws. Everything else in next/cache stays real.
const realCache = require("next/cache");
mock.module("next/cache", () => ({ ...realCache, revalidatePath: () => {}, revalidateTag: () => {} }));

// The blog's two model calls are replaced with canned stage outputs. Pin the real module first so BlogLlmError stays real.
const realLlm = require("../lib/blog/llm");
const g = globalThis as unknown as { __blogCalls: string[]; __blogFail?: (prompt: string) => void; __blogQuality?: Record<string, { ok: boolean; note: string }>; __blogLlmReal?: boolean };
g.__blogCalls = [];

const KW = "instagram reach drop";
const WORDS = ("A creator posts the same kind of reel for weeks, then one morning the views are a third of what they were. " +
  "Nothing in the account looks different. The usual advice is to post more, which rarely helps and often makes the slide worse. " +
  "Start by reading the first three seconds of the last ten posts and note where people leave; the pattern is usually visible without any tool. ").trim();
function paragraph(n: number) {
  return Array.from({ length: n }, () => WORDS).join(" ");
}
function draft(sections: { key: string; heading: string }[], keys: string[]) {
  return sections
    .filter((s) => keys.includes(s.key))
    .map((s, i) => `## ${s.heading}\n\n${paragraph(2)}${i === 0 ? ` This is why an ${KW} feels sudden. See the [Outlly features](/#features).` : ""}\n\n- Check the hook\n- Check the first comment\n- [ ] Write down the number`)
    .join("\n\n");
}
const SECTIONS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map((k, i) => ({ key: k, heading: ["Why your reach dropped", "What is actually happening", "Why it happens", "The mistakes that make it worse", "What the evidence says", "What to do this week", "What to measure", "Where this will not work", "How platforms differ", "Where Outlly fits"][i], points: ["one", "two"] }));

// mock.module is run-wide: once this file has run, every later test file that imports lib/blog/llm gets this fake.
// Another round's test (R1177) sets g.__blogLlmReal = true to reach the real functions through it.
// (The real functions are pinned here because mock.module also rewrites realLlm's own bindings: calling
// realLlm.blogJson after the mock would call the fake again, forever.)
const passThrough = () => !!g.__blogLlmReal;
const real = { blogReady: realLlm.blogReady, blogWebReady: realLlm.blogWebReady, blogJson: realLlm.blogJson, blogWebJson: realLlm.blogWebJson };
mock.module("../lib/blog/llm", () => ({
  ...realLlm,
  blogReady: () => (passThrough() ? real.blogReady() : true),
  blogWebReady: () => (passThrough() ? real.blogWebReady() : true),
  blogJson: async (_system: string, prompt: string, opts?: unknown) => {
    if (passThrough()) return real.blogJson(_system, prompt, opts as never);
    g.__blogCalls.push(prompt.slice(0, 60));
    g.__blogFail?.(prompt);
    if (prompt.includes('"candidates"')) {
      return { model: "kimi", data: { candidates: [
        { topic: "Your Instagram reach dropped overnight: what to check first", problem: "Views fall suddenly with no obvious change", primaryKeyword: KW, searchIntent: "informational", category: "Growth", score: 9, basis: "Common question in creator forums" },
        { topic: "Why YouTube Shorts stop getting views after a week", problem: "Shorts decay fast", primaryKeyword: "youtube shorts views drop", searchIntent: "informational", category: "Growth", score: 7, basis: "Frequent complaint" },
        { topic: "How to write a hook for a talking-head reel", problem: "Weak first second", primaryKeyword: "reel hook", searchIntent: "informational", category: "Craft", score: 6, basis: "Evergreen" },
      ], chosen: 0, reason: "Most searched, least covered" } };
    }
    if (prompt.includes('"workingTitle"')) return { model: "kimi", data: { workingTitle: "Your Instagram reach dropped overnight: what to check first", sections: SECTIONS, featureTieIn: "analytics", tieInReason: "The fix is about reading your own numbers" } };
    if (prompt.includes("the first half")) return { model: "kimi", data: { markdown: draft(SECTIONS, ["B", "C", "D", "E"]) } };
    if (prompt.includes("the second half")) return { model: "kimi", data: { markdown: draft(SECTIONS, ["F", "G", "H", "I", "J"]) } };
    if (prompt.includes('"seoTitle"')) return { model: "kimi", data: { seoTitle: "Instagram Reach Drop: What to Check First", metaDescription: "Your Instagram reach dropped overnight. Here is what is actually happening, the mistakes that make it worse, and what to check this week.", slug: "instagram-reach-drop-what-to-check-first", primaryKeyword: KW, secondaryKeywords: ["reels views down", "instagram algorithm"], searchIntent: "informational", relatedQuestions: ["Why did my reach drop?"], category: "Growth", tags: ["instagram", "reach"], ogTitle: "Instagram reach drop", ogDescription: "What to check first.", internalLinks: [{ href: "/#features", label: "Outlly features" }, { href: "https://evil.example/x", label: "nope" }], excerpt: "What to check when your reach falls overnight." } };
    if (prompt.includes('"onePainPoint"')) return { model: "kimi", data: { checks: g.__blogQuality ?? { onePainPoint: { ok: true, note: "" }, practical: { ok: true, note: "" }, supported: { ok: true, note: "" }, filler: { ok: true, note: "" }, titleAccurate: { ok: true, note: "" }, tieIn: { ok: true, note: "" } }, editorNote: "Tight and useful." } };
    if (prompt.includes('{"markdown":string}')) return { model: "kimi", data: { markdown: `## What to measure\n\n${paragraph(2)} Rewritten.` } };
    throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
  },
  blogWebJson: async (_system: string, prompt: string, opts?: unknown) => {
    if (passThrough()) return real.blogWebJson(_system, prompt, opts as never);
    g.__blogCalls.push("web:" + prompt.slice(0, 40));
    return {
      webUsed: true,
      citations: [{ url: "https://help.instagram.com/reach-basics", title: "About reach", content: "" }],
      data: {
        whatHappens: "Distribution to non-followers falls first.",
        whyItHappens: ["Weaker hooks", "Format fatigue"],
        mistakes: ["Posting more", "Deleting posts"],
        facts: [{ claim: "Reach counts unique accounts", kind: "fact", sourceUrl: "https://help.instagram.com/reach-basics" }, { claim: "Most creators see 40% swings", kind: "fact", sourceUrl: "https://madeup.example/stat" }],
        solutions: ["Audit hooks"],
        caveats: ["Small accounts swing more"],
        platformNotes: [{ platform: "Instagram", note: "Reels and feed are ranked separately" }],
        sources: [
          { url: "https://help.instagram.com/reach-basics", title: "About reach", publisher: "Instagram Help", kind: "official", supports: "Reach definition" },
          { url: "https://madeup.example/stat", title: "Creator survey", publisher: "Madeup", kind: "publication", supports: "40% swings" },
        ],
      },
    };
  },
}));

import { db } from "../lib/db";
import { can } from "../lib/admin/perms";
import { BLOG_DEFAULT, blogConfigIssues } from "../lib/blog/config";
import { countWords, slugify, SLUG_RE } from "../lib/blog/types";
import { overlaps, pickDistinct, normaliseSeo, qualityChecks } from "../lib/blog/stages";
import { renderMarkdown, stripMarkdown } from "../lib/blog/markdown";
import { localDay, startJob, runStage, cancelJob, recentJobs, STATIC_LINKS } from "../lib/blog/job";
import { getPost, listPosts, publishPost, updatePost, rejectPost, restorePost, splitSections, blogStats, todayBlog, unpublishPost, regenerateSection } from "../lib/blog/posts";

const ADMIN = { id: "adm-blog", name: "Asha", login: "asha", role: "marketing" as const };
const TOPIC = { topic: "t", problem: "p", primaryKeyword: KW, searchIntent: "informational", category: "Growth", score: 9, basis: "b" };
const OUTLINE = { workingTitle: "t", sections: SECTIONS, featureTieIn: "analytics", tieInReason: "" };

describe("1175 pure helpers", () => {
  test("slugify and SLUG_RE", () => {
    expect(slugify("  Your Instagram Reach Dropped: What to Check First! ")).toBe("instagram-reach-dropped-what-check-first");
    expect(SLUG_RE.test("ok-slug-9")).toBe(true);
    expect(SLUG_RE.test("Bad Slug")).toBe(false);
  });
  test("countWords ignores markdown marks", () => {
    expect(countWords("## Heading\n\nOne two **three** [four](/x). <br> ...")).toBe(5);
  });
  test("overlaps is word based, pickDistinct skips covered topics", () => {
    expect(overlaps("Instagram reach drop explained", "why instagram reach drops")).toBe(true);
    expect(overlaps("YouTube thumbnails", "Instagram reach")).toBe(false);
    const out = { candidates: [{ ...TOPIC, topic: "Instagram reach drop explained" }, { ...TOPIC, topic: "Writing better reel hooks", primaryKeyword: "reel hooks" }], chosen: 0, reason: "" };
    expect(pickDistinct(out, [{ topic: "Why instagram reach drops", primaryKeyword: KW }])).toBe(1);
  });
  test("normaliseSeo drops unknown links, fixes slug clashes and bounds the meta", () => {
    const ctx = { allowedLinks: STATIC_LINKS, takenSlugs: ["instagram-reach-drop"] };
    const s = normaliseSeo(BLOG_DEFAULT, TOPIC, OUTLINE, { slug: "Instagram Reach Drop", internalLinks: [{ href: "/#features", label: "f" }, { href: "https://evil.example", label: "x" }, { href: "/admin", label: "a" }] }, ctx);
    expect(s.slug).not.toBe("instagram-reach-drop");
    expect(SLUG_RE.test(s.slug)).toBe(true);
    expect(s.internalLinks.map((l) => l.href)).toEqual(["/#features"]);
    expect(s.primaryKeyword).toBe(KW);
  });
  test("qualityChecks: structure, sources and links are critical", () => {
    const body = draft(SECTIONS, ["B", "C", "D", "E", "F", "G", "H", "I", "J"]);
    const seo = normaliseSeo(BLOG_DEFAULT, TOPIC, OUTLINE, { seoTitle: "Instagram reach drop: what to check", metaDescription: "x".repeat(90), slug: "a-slug", internalLinks: [{ href: "/#features", label: "f" }] }, { allowedLinks: STATIC_LINKS, takenSlugs: [] });
    const good = qualityChecks({ cfg: BLOG_DEFAULT, topic: TOPIC, outline: OUTLINE, body, seo, sources: [{ url: "https://help.instagram.com/x", title: "", publisher: "", kind: "official", supports: "", verified: true }], existing: [], allowedHrefs: STATIC_LINKS.map((l) => l.href) });
    expect(good.filter((c) => c.critical && !c.ok)).toEqual([]);
    const noSource = qualityChecks({ cfg: BLOG_DEFAULT, topic: TOPIC, outline: OUTLINE, body, seo, sources: [], existing: [], allowedHrefs: STATIC_LINKS.map((l) => l.href) });
    expect(noSource.find((c) => c.id === "sources")?.ok).toBe(false);
    const thin = qualityChecks({ cfg: BLOG_DEFAULT, topic: TOPIC, outline: OUTLINE, body: "## One\n\nshort", seo, sources: [], existing: [], allowedHrefs: [] });
    expect(thin.find((c) => c.id === "length")?.ok).toBe(false);
    expect(thin.find((c) => c.id === "structure")?.ok).toBe(false);
    const overlap = qualityChecks({ cfg: BLOG_DEFAULT, topic: TOPIC, outline: OUTLINE, body, seo, sources: [], existing: [{ title: "Instagram reach drop: what to check", primaryKeyword: KW }], allowedHrefs: [] });
    expect(overlap.find((c) => c.id === "overlap")?.ok).toBe(false);
  });
  test("renderMarkdown escapes html and drops unsafe hrefs", () => {
    const { html, headings } = renderMarkdown("## Hi <b>there</b>\n\nText <script>alert(1)</script> [ok](/help) [bad](javascript:alert(1))\n\n- [x] done\n- [ ] todo\n\n> quote");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="/help"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain('class="tasks"');
    expect(html).toContain("<blockquote>");
    expect(headings.length).toBe(1);
    expect(stripMarkdown("**bold** [x](/y)")).toBe("bold x");
  });
  test("splitSections and localDay", () => {
    const parts = splitSections("intro\n\n## A\n\na text\n\n## B\n\nb text");
    expect(parts.map((p) => p.heading)).toEqual(["", "A", "B"]);
    expect(localDay("Asia/Kolkata", new Date("2026-11-16T20:00:00Z"))).toBe("2026-11-17");
    expect(localDay("UTC", new Date("2026-11-16T20:00:00Z"))).toBe("2026-11-16");
  });
  test("blogConfigIssues and perms", () => {
    expect(blogConfigIssues(BLOG_DEFAULT)).toEqual([]);
    expect(blogConfigIssues({ ...BLOG_DEFAULT, minWords: 2000, maxWords: 1000 }).length).toBeGreaterThan(0);
    expect(blogConfigIssues({ ...BLOG_DEFAULT, schedule: { ...BLOG_DEFAULT.schedule, autoPublish: true } }).length).toBeGreaterThan(0);
    expect(can("marketing", "content")).toBe(true);
    expect(can("super", "content")).toBe(true);
    expect(can("support", "content")).toBe(false);
  });
});

describe("1175 job flow", () => {
  let jobId = "";
  let postId = "";
  beforeAll(async () => {
    await db.adminUser.upsert({ where: { id: ADMIN.id }, update: {}, create: { id: ADMIN.id, name: ADMIN.name, login: ADMIN.login, role: ADMIN.role, passwordHash: "x" } }).catch(() => {});
  });
  test("startJob runs once per day; a second click joins the running job", async () => {
    const a = await startJob({ kind: "manual", by: "asha" });
    expect(a.existed).toBe(false);
    expect(a.job.stage).toBe("topic");
    const b = await startJob({ kind: "manual", by: "asha" });
    expect(b.existed).toBe(true);
    expect(b.job.id).toBe(a.job.id);
    jobId = a.job.id;
  });
  test("runStage walks all seven stages and lands a pending post", async () => {
    const stages: string[] = [];
    for (let i = 0; i < 7; i++) {
      const v = await runStage(jobId);
      stages.push(v.stage);
    }
    expect(stages).toEqual(["research", "outline", "draft1", "draft2", "seo", "quality", "done"]);
    const job = (await recentJobs(5)).find((j) => j.id === jobId)!;
    expect(job.status).toBe("done");
    expect(job.postId).toBeTruthy();
    expect(job.topic).toContain("Instagram");
    expect(job.events.filter((e) => e.status === "done").length).toBe(7);
    postId = job.postId!;
    const post = await getPost(postId);
    expect(post.status).toBe("pending");
    expect(post.author).toBe("Outlly Team");
    expect(post.wordCount).toBeGreaterThan(700);
    expect(post.slug).toBe("instagram-reach-drop-what-check-first");
    expect(post.internalLinks.map((l) => l.href)).toEqual(["/#features"]);
    expect(post.sources.length).toBe(2);
    expect(post.sources.find((s) => s.url.includes("help.instagram"))?.verified).toBe(true);
    expect(post.sources.find((s) => s.url.includes("madeup"))?.verified).toBe(false);
    expect(post.quality?.ok).toBe(true);
    expect(post.quality?.checks.find((c) => c.id === "onePainPoint")?.ok).toBe(true);
    const topics = await db.blogTopic.findMany();
    expect(topics.find((t) => t.status === "written")?.postId).toBe(postId);
    expect(topics.filter((t) => t.status === "candidate").length).toBe(2);
    const ev = await db.adminEvent.findFirst({ where: { kind: "blog.ready" } });
    expect(ev?.href).toBe(`/admin/blog/review/${postId}`);
  });
  test("runStage on a finished job is a no-op; todayBlog finds the pending post", async () => {
    const v = await runStage(jobId);
    expect(v.stage).toBe("done");
    const t = await todayBlog();
    expect(t.post?.id).toBe(postId);
    expect(t.job).toBeNull();
  });
  test("updatePost validates slug and links, and re-runs the code checks", async () => {
    const p = await updatePost(ADMIN, postId, { title: "Instagram reach drop: what to check first" });
    expect(p.title).toBe("Instagram reach drop: what to check first");
    expect(p.quality?.checks.find((c) => c.id === "onePainPoint")?.ok).toBe(true);
    await expect(updatePost(ADMIN, postId, { slug: "???" })).rejects.toThrow();
    expect((await updatePost(ADMIN, postId, { slug: "Instagram Reach Drop!" })).slug).toBe("instagram-reach-drop");
    await expect(updatePost(ADMIN, postId, { internalLinks: [{ href: "https://evil.example", label: "x" }] })).rejects.toThrow();
    const log = await db.auditLog.findFirst({ where: { action: "blog.edit" } });
    expect(log).toBeTruthy();
  });
  test("publish is blocked while a critical check fails, then succeeds", async () => {
    const before = await getPost(postId);
    await updatePost(ADMIN, postId, { bodyMd: "## Only one\n\nToo short." });
    let err: any = null;
    await publishPost(ADMIN, postId).catch((e) => (err = e));
    expect(err?.status).toBe(422);
    await updatePost(ADMIN, postId, { bodyMd: before.bodyMd });
    const pub = await publishPost(ADMIN, postId);
    expect(pub.status).toBe("published");
    expect(pub.publishedBy).toBe("asha");
    expect(pub.publishedAt).toBeTruthy();
    const stats = await blogStats();
    expect(stats.published).toBe(1);
    expect(stats.lastPublished?.slug).toBe(pub.slug);
    const off = await unpublishPost(ADMIN, postId);
    expect(off.status).toBe("approved");
    expect((await listPosts({ status: "approved" })).length).toBe(1);
    await publishPost(ADMIN, postId);
  });
  test("a second day's run cannot reuse the published slug or topic", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const r = await startJob({ kind: "scheduled", by: "schedule", now: tomorrow });
    expect(r.existed).toBe(false);
    for (let i = 0; i < 7; i++) await runStage(r.job.id);
    const job = (await recentJobs(5)).find((j) => j.id === r.job.id)!;
    expect(job.status).toBe("done");
    const p2 = await getPost(job.postId!);
    expect(p2.slug).not.toBe((await getPost(postId)).slug);
    expect(p2.slug).toBe("instagram-reach-drop-what-check-first");
    // The canned model returns the same topic, so the overlap check must flag it rather than let a duplicate through.
    expect(p2.quality?.checks.find((c) => c.id === "overlap")?.ok).toBe(false);
    let err: any = null;
    await publishPost(ADMIN, p2.id).catch((e) => (err = e));
    expect(err?.status).toBe(422);
    const rej = await rejectPost(ADMIN, p2.id, "Duplicate of yesterday");
    expect(rej.status).toBe("rejected");
    expect(rej.rejectReason).toBe("Duplicate of yesterday");
    const back = await restorePost(ADMIN, p2.id);
    expect(back.status).toBe("pending");
  });
  test("regenerateSection replaces one heading only, and only while unpublished", async () => {
    await expect(regenerateSection(ADMIN, postId, "What to measure", "tighter")).rejects.toThrow();
    const before = await unpublishPost(ADMIN, postId);
    const after = await regenerateSection(ADMIN, postId, "What to measure", "tighter");
    expect(after.bodyMd).toContain("Rewritten.");
    expect(splitSections(after.bodyMd).length).toBe(splitSections(before.bodyMd).length);
    expect(after.bodyMd).toContain("## Why it happens");
    await publishPost(ADMIN, postId);
  });
  test("a failing stage records the error and can be retried; cancel stops it", async () => {
    const day = new Date(Date.now() + 2 * 86_400_000);
    const r = await startJob({ kind: "manual", by: "asha", now: day });
    g.__blogFail = (p) => {
      if (p.includes('"candidates"')) throw new realLlm.BlogLlmError("AI timed out", true);
    };
    const v1 = await runStage(r.job.id);
    g.__blogFail = undefined;
    expect(v1.status).toBe("running");
    expect(v1.stage).toBe("topic");
    expect(v1.attempts).toBe(1);
    expect(v1.events.some((e) => e.status === "failed")).toBe(true);
    const v2 = await runStage(r.job.id);
    expect(v2.stage).toBe("research");
    await cancelJob(r.job.id, "asha");
    const v3 = await runStage(r.job.id);
    expect(v3.status).toBe("cancelled");
  });
  test("paused config refuses a new run", async () => {
    const { saveConfig } = await import("../lib/settings");
    await saveConfig("blog", { ...BLOG_DEFAULT, paused: true });
    let err: any = null;
    await startJob({ kind: "manual", by: "asha", now: new Date(Date.now() + 3 * 86_400_000) }).catch((e) => (err = e));
    expect(err?.status).toBe(409);
    await saveConfig("blog", { ...BLOG_DEFAULT, paused: false });
  });
});

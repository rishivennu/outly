import "server-only";
import { db } from "../db";
import { getConfig } from "../settings";
import { adminEvent } from "../admin/route";
import { dayDiff, isDay, type BlogConfig } from "./config";
import { BlogLlmError } from "./llm";
import { stageDraft, stageOutline, stageQuality, stageResearch, stageSeo, stageTopic, type TopicMemory } from "./stages";
import { BLOG_STAGES, countWords, readingMinutes, type BlogJobView, type BlogStage, type StageData, type TopicCandidate } from "./types";

/**
 * R1175: one generation run is a BlogJob that moves through BLOG_STAGES one request at a time. Every call to
 * `runStage` does exactly one stage (fits Vercel's 60 s), saves its output, and records a BlogJobEvent with the
 * real elapsed time, which is what the admin's stage display shows. Nothing here publishes: the finished article
 * lands as a pending BlogPost.
 */

const MAX_ATTEMPTS = 3;

/** Today's date in the blog timezone, as YYYY-MM-DD. */
export function localDay(tz: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Minutes since local midnight in `tz`, for the schedule check. */
export function localMinutes(tz: string, now = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/** Pages an article may link to. Published posts join this list in lib/blog/posts.ts. */
export const STATIC_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Outlly home" },
  { href: "/#features", label: "Outlly features" },
  { href: "/#how", label: "How Outlly works" },
  { href: "/#platforms", label: "Platforms Outlly posts to" },
  { href: "/#pricing", label: "Outlly pricing" },
  { href: "/#faq", label: "Outlly FAQ" },
  { href: "/#demo", label: "Outlly demo" },
  { href: "/help", label: "Help centre" },
  { href: "/changelog", label: "What's new in Outlly" },
  { href: "/blog", label: "Outlly blog" },
];

export async function allowedLinks(exceptPostId?: string) {
  const posts = await db.blogPost.findMany({ where: { status: "published", ...(exceptPostId ? { id: { not: exceptPostId } } : {}) }, select: { slug: true, title: true }, orderBy: { publishedAt: "desc" }, take: 60 });
  return [...STATIC_LINKS, ...posts.map((p) => ({ href: `/blog/${p.slug}`, label: p.title }))];
}

export class JobError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Starts today's run, or returns the one already running for that day (the duplicate-click guard). `rewriteOf`
 * reuses a post's topic and skips topic discovery; the old post is replaced when the new one lands.
 */
export async function startJob(input: { kind: "manual" | "scheduled"; by: string; hint?: string; rewriteOf?: string; now?: Date; forDate?: string }): Promise<{ job: BlogJobView; existed: boolean }> {
  const cfg = await getConfig("blog");
  if (cfg.paused) throw new JobError("The blog agent is paused in Blog settings.", 409);
  const today = localDay(cfg.timezone, input.now);
  // R1178: an admin may prepare a later day's draft now; it counts as that day's scheduled run.
  if (input.forDate !== undefined && !(isDay(input.forDate) && dayDiff(today, input.forDate) >= 0 && dayDiff(today, input.forDate) <= 60)) throw new JobError("Pick a day from today to 60 days ahead (YYYY-MM-DD).");
  const forDate = input.forDate ?? today;
  const running = await db.blogJob.findFirst({ where: { forDate, status: "running" }, orderBy: { startedAt: "desc" } });
  if (running) return { job: await jobView(running.id), existed: true };
  if (input.kind === "scheduled") {
    const done = await db.blogJob.count({ where: { forDate, kind: "scheduled" } });
    if (done >= Math.max(1, cfg.schedule.perDay)) throw new JobError(forDate === today ? "Today's scheduled run already happened." : `The run for ${forDate} already happened.`, 409);
  }
  let stageData: StageData = {};
  let stage: BlogStage = "topic";
  if (input.rewriteOf) {
    const old = await db.blogPost.findUnique({ where: { id: input.rewriteOf } });
    if (!old) throw new JobError("That article no longer exists.", 404);
    const t: TopicCandidate = { topic: old.title, problem: old.painPoint, primaryKeyword: old.primaryKeyword, searchIntent: old.searchIntent, category: old.category, score: 0, basis: "Rewrite of an existing draft" };
    stageData = { topic: { candidates: [t], chosen: 0, reason: "Rewrite requested by the admin." } };
    stage = "research";
  }
  const last = await db.blogJob.findFirst({ where: { forDate, kind: input.kind }, orderBy: { seq: "desc" }, select: { seq: true } });
  const job = await db.blogJob.create({
    data: { forDate, kind: input.kind, seq: (last?.seq ?? 0) + 1, stage, startedBy: input.by.slice(0, 120), topicHint: (input.hint ?? "").slice(0, 300), stageData: JSON.stringify({ ...stageData, rewriteOf: input.rewriteOf ?? "" }) },
  });
  return { job: await jobView(job.id), existed: false };
}

export async function cancelJob(id: string, by: string) {
  const job = await db.blogJob.findUnique({ where: { id } });
  if (!job) throw new JobError("Run not found.", 404);
  if (job.status !== "running") return jobView(id);
  await db.blogJob.update({ where: { id }, data: { status: "cancelled", finishedAt: new Date(), error: `Stopped by ${by}` } });
  await db.blogJobEvent.create({ data: { jobId: id, stage: job.stage, status: "failed", message: `Stopped by ${by}` } });
  return jobView(id);
}

/**
 * R1178: resumes a failed or stopped run from the first stage with no saved output. fail() sets stage "failed",
 * so the stage comes from stageData, never from job.stage. Completed stages (and a rewrite's seeded topic) are kept.
 */
export async function retryJob(id: string, by: string): Promise<BlogJobView> {
  const job = await db.blogJob.findUnique({ where: { id } });
  if (!job) throw new JobError("Run not found.", 404);
  if (job.status !== "failed" && job.status !== "cancelled") throw new JobError("Only a failed or stopped run can be retried.", 409);
  const cfg = await getConfig("blog");
  if (cfg.paused) throw new JobError("The blog agent is paused in Blog settings.", 409);
  const other = await db.blogJob.findFirst({ where: { forDate: job.forDate, status: "running", id: { not: id } }, select: { id: true } });
  if (other) throw new JobError(`Another run is going for ${job.forDate}. Wait for it to finish.`, 409);
  const data = parseStageData(job.stageData);
  const stage = BLOG_STAGES.find((s) => !data[s]) ?? "quality";
  const claimed = await db.blogJob.updateMany({ where: { id, status: job.status }, data: { status: "running", stage, attempts: 0, error: "", finishedAt: null } });
  if (!claimed.count) return jobView(id);
  await db.blogJobEvent.create({ data: { jobId: id, stage, status: "started", message: `Retry by ${by}`.slice(0, 200) } });
  return jobView(id);
}
function parseStageData(s: string): StageData {
  try {
    return (JSON.parse(s || "{}") ?? {}) as StageData;
  } catch {
    return {};
  }
}

/** Runs the job's current stage once. Safe to call when the job is finished (returns it unchanged). */
export async function runStage(id: string): Promise<BlogJobView> {
  const job = await db.blogJob.findUnique({ where: { id } });
  if (!job) throw new JobError("Run not found.", 404);
  if (job.status !== "running") return jobView(id);
  const stage = job.stage as BlogStage;
  if (!BLOG_STAGES.includes(stage)) return jobView(id);
  // Claim the stage: a second caller arriving in the same second sees the bumped attempts and waits.
  const claimed = await db.blogJob.updateMany({ where: { id, stage, attempts: job.attempts, status: "running" }, data: { attempts: job.attempts + 1 } });
  if (claimed.count === 0) return jobView(id);
  if (job.attempts + 1 > MAX_ATTEMPTS) return fail(id, stage, `Gave up after ${MAX_ATTEMPTS} attempts at "${stage}".`);
  const cfg = await getConfig("blog");
  const data = JSON.parse(job.stageData || "{}") as StageData & { rewriteOf?: string };
  const t0 = Date.now();
  await db.blogJobEvent.create({ data: { jobId: id, stage, status: "started", message: job.attempts ? `Attempt ${job.attempts + 1}` : "" } });
  try {
    const out = await work(stage, cfg, data, job.topicHint, data.rewriteOf || undefined);
    const nextData = { ...data, [stage]: out };
    const i = BLOG_STAGES.indexOf(stage);
    const next = BLOG_STAGES[i + 1];
    const ms = Date.now() - t0;
    if (next) {
      await db.blogJob.update({ where: { id }, data: { stage: next, attempts: 0, stageData: JSON.stringify(nextData), error: "" } });
      await db.blogJobEvent.create({ data: { jobId: id, stage, status: "done", ms, message: summary(stage, out) } });
    } else {
      const postId = await land(job.id, cfg, nextData, job.startedBy, data.rewriteOf || undefined);
      await db.blogJob.update({ where: { id }, data: { stage: "done", status: "done", attempts: 0, stageData: JSON.stringify(nextData), postId, finishedAt: new Date(), error: "" } });
      await db.blogJobEvent.create({ data: { jobId: id, stage, status: "done", ms, message: summary(stage, out) } });
    }
    return jobView(id);
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 400);
    const ms = Date.now() - t0;
    await db.blogJobEvent.create({ data: { jobId: id, stage, status: "failed", ms, message: msg } });
    const retryable = !(e instanceof BlogLlmError && !e.retryable);
    if (!retryable || job.attempts + 1 >= MAX_ATTEMPTS) return fail(id, stage, msg);
    await db.blogJob.update({ where: { id }, data: { error: msg } });
    return jobView(id);
  }
}

/** Keeps running stages while the job is running and the time budget allows another full stage. */
export async function runStages(id: string, budgetMs: number): Promise<BlogJobView> {
  const t0 = Date.now();
  let view = await jobView(id);
  while (view.status === "running" && Date.now() - t0 < budgetMs) view = await runStage(id);
  return view;
}

async function fail(id: string, stage: string, msg: string) {
  await db.blogJob.update({ where: { id }, data: { status: "failed", stage: "failed", error: msg, finishedAt: new Date() } });
  await adminEvent("blog.failed", "Today's blog could not be generated", `${msg} (stage: ${stage})`, "/admin/blog/generate");
  return jobView(id);
}

async function work(stage: BlogStage, cfg: BlogConfig, d: StageData, hint: string, rewriteOf?: string) {
  const topic = () => {
    const t = d.topic?.candidates[d.topic.chosen];
    if (!t) throw new BlogLlmError("The topic is missing from this run.", false);
    return t;
  };
  switch (stage) {
    case "topic": {
      const memory = await topicMemory();
      return stageTopic(cfg, memory, hint);
    }
    case "research":
      return stageResearch(cfg, topic());
    case "outline":
      return stageOutline(cfg, topic(), need(d.research, "research"));
    case "draft1":
      return stageDraft(cfg, topic(), need(d.research, "research"), need(d.outline, "outline"), 1);
    case "draft2":
      return stageDraft(cfg, topic(), need(d.research, "research"), need(d.outline, "outline"), 2, need(d.draft1, "draft1").markdown);
    case "seo": {
      const body = `${need(d.draft1, "draft1").markdown}\n\n${need(d.draft2, "draft2").markdown}`;
      const taken = (await db.blogPost.findMany({ select: { slug: true } })).map((p) => p.slug);
      return stageSeo(cfg, topic(), need(d.outline, "outline"), body, { allowedLinks: await allowedLinks(rewriteOf), takenSlugs: taken });
    }
    case "quality": {
      const body = `${need(d.draft1, "draft1").markdown}\n\n${need(d.draft2, "draft2").markdown}`;
      const existing = await db.blogPost.findMany({ where: { status: { not: "rejected" }, ...(rewriteOf ? { id: { not: rewriteOf } } : {}) }, select: { title: true, primaryKeyword: true } });
      return stageQuality({ cfg, topic: topic(), outline: need(d.outline, "outline"), body, seo: need(d.seo, "seo"), sources: need(d.research, "research").sources, existing, allowedHrefs: (await allowedLinks(rewriteOf)).map((l) => l.href) });
    }
  }
}
function need<T>(v: T | undefined, name: string): T {
  if (!v) throw new BlogLlmError(`The ${name} stage has no saved output; start the run again.`, false);
  return v;
}

/** Every topic the agent has written or considered, plus every live article, so it never writes the same piece twice. */
export async function topicMemory(): Promise<TopicMemory[]> {
  const [topics, posts] = await Promise.all([
    db.blogTopic.findMany({ where: { status: { in: ["chosen", "written", "skipped"] } }, select: { topic: true, primaryKeyword: true, searchIntent: true, status: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.blogPost.findMany({ where: { status: { not: "rejected" } }, select: { title: true, primaryKeyword: true, searchIntent: true, status: true }, orderBy: { createdAt: "desc" }, take: 300 }),
  ]);
  const seen = new Set<string>();
  const out: TopicMemory[] = [];
  for (const x of [...posts.map((p) => ({ topic: p.title, primaryKeyword: p.primaryKeyword, searchIntent: p.searchIntent, status: p.status })), ...topics]) {
    const k = `${x.topic.toLowerCase()}|${x.primaryKeyword.toLowerCase()}`;
    if (!seen.has(k) && seen.add(k)) out.push(x);
  }
  return out;
}

function summary(stage: BlogStage, out: any): string {
  switch (stage) {
    case "topic":
      return `Chose "${out.candidates[out.chosen]?.topic ?? ""}" from ${out.candidates.length} candidates`;
    case "research":
      return `${out.sources.filter((s: any) => s.verified).length} verified of ${out.sources.length} sources, ${out.facts.length} claims${out.webUsed ? "" : " (no web access)"}`;
    case "outline":
      return `${out.sections.length} sections${out.featureTieIn ? `, ties in ${out.featureTieIn}` : ", no Outlly tie-in"}`;
    case "draft1":
    case "draft2":
      return `${countWords(out.markdown)} words`;
    case "seo":
      return `/blog/${out.slug}, ${out.internalLinks.length} internal links`;
    case "quality":
      return `${out.checks.filter((c: any) => c.ok).length} of ${out.checks.length} checks passed${out.ok ? "" : " (needs attention)"}`;
  }
}

/** The finished run becomes a pending BlogPost with its sources; the topic memory is updated; the admin is told. */
async function land(jobId: string, cfg: BlogConfig, d: StageData, by: string, rewriteOf?: string): Promise<string> {
  const t = need(d.topic, "topic");
  const topic = t.candidates[t.chosen];
  const research = need(d.research, "research");
  const outline = need(d.outline, "outline");
  const seo = need(d.seo, "seo");
  const quality = need(d.quality, "quality");
  const body = `${need(d.draft1, "draft1").markdown}\n\n${need(d.draft2, "draft2").markdown}`;
  const words = countWords(body);
  const post = await db.blogPost.create({
    data: {
      slug: seo.slug,
      title: outline.workingTitle,
      seoTitle: seo.seoTitle,
      metaDescription: seo.metaDescription,
      excerpt: seo.excerpt,
      bodyMd: body,
      category: seo.category,
      tags: JSON.stringify(seo.tags),
      primaryKeyword: seo.primaryKeyword,
      secondaryKeywords: JSON.stringify(seo.secondaryKeywords),
      searchIntent: seo.searchIntent,
      relatedQuestions: JSON.stringify(seo.relatedQuestions),
      internalLinks: JSON.stringify(seo.internalLinks),
      painPoint: topic.problem,
      author: cfg.author,
      status: "pending",
      wordCount: words,
      readingMin: readingMinutes(words),
      qualityReport: JSON.stringify(quality),
      qualityOk: quality.ok,
      featureTieIn: outline.featureTieIn,
      jobId,
      sources: { create: research.sources.map((s) => ({ url: s.url, title: s.title, publisher: s.publisher, kind: s.kind, supports: s.supports, verified: s.verified })) },
    },
  });
  // Topic memory: every candidate is remembered; the chosen one points at the article.
  await db.blogTopic.createMany({
    data: t.candidates.map((c, i) => ({ topic: c.topic, problem: c.problem, primaryKeyword: c.primaryKeyword, searchIntent: c.searchIntent, category: c.category, score: c.score, basis: c.basis, status: i === t.chosen ? "written" : "candidate", postId: i === t.chosen ? post.id : null, chosenAt: i === t.chosen ? new Date() : null })),
  });
  if (rewriteOf) await db.blogPost.updateMany({ where: { id: rewriteOf, status: { in: ["pending", "approved", "rejected"] } }, data: { status: "rejected", rejectReason: `Replaced by a rewrite (${post.slug})` } });
  await adminEvent("blog.ready", by === "schedule" ? "Your Today's Blog Is Ready!" : "A new blog draft is ready for review", `"${outline.workingTitle}" (${words} words) is waiting in Pending approval.`, `/admin/blog/review/${post.id}`);
  return post.id;
}

export async function jobView(id: string): Promise<BlogJobView> {
  const job = await db.blogJob.findUniqueOrThrow({ where: { id }, include: { events: { orderBy: { createdAt: "asc" } } } });
  return toView(job);
}

export function toView(job: { id: string; forDate: string; kind: string; seq: number; stage: string; status: string; error: string; attempts: number; startedBy: string; topicHint: string; postId: string | null; startedAt: Date; finishedAt: Date | null; stageData: string; events?: { stage: string; status: string; ms: number; message: string; createdAt: Date }[] }): BlogJobView {
  let topic = "";
  try {
    const d = JSON.parse(job.stageData || "{}") as StageData;
    topic = d.topic?.candidates[d.topic.chosen]?.topic ?? "";
  } catch {
    /* unreadable stage data shows no topic */
  }
  return {
    id: job.id,
    forDate: job.forDate,
    kind: job.kind,
    seq: job.seq,
    stage: job.stage as BlogJobView["stage"],
    status: job.status as BlogJobView["status"],
    error: job.error,
    attempts: job.attempts,
    startedBy: job.startedBy,
    topicHint: job.topicHint,
    postId: job.postId,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    events: (job.events ?? []).map((e) => ({ stage: e.stage, status: e.status, ms: e.ms, message: e.message, at: e.createdAt.toISOString() })),
    topic,
  };
}

/** Recent runs for the history table and the dashboard. */
export async function recentJobs(take = 30): Promise<BlogJobView[]> {
  const jobs = await db.blogJob.findMany({ orderBy: { startedAt: "desc" }, take, include: { events: { orderBy: { createdAt: "asc" } } } });
  return jobs.map(toView);
}

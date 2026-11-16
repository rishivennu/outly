import "server-only";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { getConfig } from "../settings";
import type { AdminSession } from "../admin/auth";
import { allowedLinks, JobError, localDay, toView } from "./job";
import { blogJson } from "./llm";
import { qualityChecks } from "./stages";
import { countWords, parseJson, parseList, readingMinutes, SLUG_RE, slugify, type BlogJobView, type BlogPostPatch, type BlogPostView, type OutlineStageOut, type QualityReport, type SeoStageOut, type TopicCandidate } from "./types";

/**
 * R1175 review desk: reading, editing, rejecting and publishing articles. Every change by an admin leaves an
 * AuditLog row (targetType "blog"). Publishing is the only path to status "published" and it re-runs the
 * deterministic quality checks first, so an edit that broke the article cannot slip out.
 */

type PostRow = NonNullable<Awaited<ReturnType<typeof db.blogPost.findUnique>>> & { sources?: { id: string; url: string; title: string; publisher: string; kind: string; supports: string; verified: boolean; accessedAt: Date }[] };

export function postView(p: PostRow): BlogPostView {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    seoTitle: p.seoTitle,
    metaDescription: p.metaDescription,
    excerpt: p.excerpt,
    bodyMd: p.bodyMd,
    category: p.category,
    tags: parseList(p.tags),
    primaryKeyword: p.primaryKeyword,
    secondaryKeywords: parseList(p.secondaryKeywords),
    searchIntent: p.searchIntent,
    relatedQuestions: parseList(p.relatedQuestions),
    internalLinks: parseJson<{ href: string; label: string }[]>(p.internalLinks, []),
    painPoint: p.painPoint,
    author: p.author,
    status: p.status as BlogPostView["status"],
    wordCount: p.wordCount,
    readingMin: p.readingMin,
    quality: parseJson<QualityReport | null>(p.qualityReport, null),
    qualityOk: p.qualityOk,
    featureTieIn: p.featureTieIn,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    publishedBy: p.publishedBy,
    reviewedBy: p.reviewedBy,
    rejectReason: p.rejectReason,
    jobId: p.jobId,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    sources: (p.sources ?? []).map((s) => ({ id: s.id, url: s.url, title: s.title, publisher: s.publisher, kind: s.kind, supports: s.supports, verified: s.verified, accessedAt: s.accessedAt.toISOString() })),
  };
}

export async function getPost(id: string): Promise<BlogPostView> {
  const p = await db.blogPost.findUnique({ where: { id }, include: { sources: { orderBy: { accessedAt: "asc" } } } });
  if (!p) throw new JobError("Article not found.", 404);
  return postView(p);
}

export async function listPosts(filter: { status?: string; q?: string; take?: number } = {}): Promise<BlogPostView[]> {
  const where: any = {};
  if (filter.status && filter.status !== "all") where.status = filter.status;
  if (filter.q?.trim()) where.OR = [{ title: { contains: filter.q.trim() } }, { primaryKeyword: { contains: filter.q.trim() } }, { category: { contains: filter.q.trim() } }];
  const rows = await db.blogPost.findMany({ where, orderBy: { createdAt: "desc" }, take: filter.take ?? 100, include: { sources: true } });
  return rows.map(postView);
}

const snap = (v: unknown) => JSON.stringify(v).slice(0, 4000);
async function audit(admin: AdminSession, action: string, id: string, before: unknown, after: unknown, note = "") {
  await db.auditLog.create({ data: { actor: admin.login.slice(0, 120), actorRole: admin.role, action, targetType: "blog", targetId: id, before: snap(before), after: snap(after), note: note.slice(0, 500) } }).catch((e) => console.error("[audit]", e));
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const strs = (v: unknown, max = 10) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max) : undefined);

/** The admin's edits. Validates what code can validate; re-runs the quality checks so the report stays honest. */
export async function updatePost(admin: AdminSession, id: string, patch: BlogPostPatch): Promise<BlogPostView> {
  const cur = await db.blogPost.findUnique({ where: { id }, include: { sources: true } });
  if (!cur) throw new JobError("Article not found.", 404);
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = str(patch.title, 160);
  if (patch.seoTitle !== undefined) data.seoTitle = str(patch.seoTitle, 90);
  if (patch.metaDescription !== undefined) data.metaDescription = str(patch.metaDescription, 200);
  if (patch.excerpt !== undefined) data.excerpt = str(patch.excerpt, 400);
  if (patch.category !== undefined) data.category = str(patch.category, 60);
  if (patch.primaryKeyword !== undefined) data.primaryKeyword = str(patch.primaryKeyword, 80).toLowerCase();
  if (patch.tags !== undefined) data.tags = JSON.stringify(strs(patch.tags, 8) ?? []);
  if (patch.secondaryKeywords !== undefined) data.secondaryKeywords = JSON.stringify(strs(patch.secondaryKeywords, 10) ?? []);
  if (patch.bodyMd !== undefined) {
    const body = String(patch.bodyMd ?? "").replace(/\r\n/g, "\n").trim();
    if (!body) throw new JobError("The article body cannot be empty.");
    data.bodyMd = body;
    data.wordCount = countWords(body);
    data.readingMin = readingMinutes(countWords(body));
  }
  if (patch.slug !== undefined) {
    const slug = slugify(String(patch.slug));
    if (!SLUG_RE.test(slug)) throw new JobError("The slug may only use lowercase letters, numbers and hyphens.");
    if (cur.status === "published" && slug !== cur.slug) throw new JobError("Unpublish before changing the address of a live article.", 409);
    const clash = await db.blogPost.findFirst({ where: { slug, id: { not: id } }, select: { id: true } });
    if (clash) throw new JobError("Another article already uses that slug.", 409);
    data.slug = slug;
  }
  if (patch.internalLinks !== undefined) {
    const allowed = new Set((await allowedLinks(id)).map((l) => l.href));
    const links = (Array.isArray(patch.internalLinks) ? patch.internalLinks : []).map((l) => ({ href: str(l?.href, 200), label: str(l?.label, 120) })).filter((l) => l.href);
    const bad = links.filter((l) => !allowed.has(l.href));
    if (bad.length) throw new JobError(`These links do not point at an Outlly page: ${bad.map((b) => b.href).join(", ")}`);
    data.internalLinks = JSON.stringify(links.slice(0, 6));
  }
  if (!Object.keys(data).length) return postView(cur);
  const title = (data.title as string) ?? cur.title;
  if (!title) throw new JobError("The title cannot be empty.");
  const merged = { ...cur, ...data } as typeof cur;
  const report = await refreshQuality(merged);
  const saved = await db.blogPost.update({ where: { id }, data: { ...data, title, qualityReport: JSON.stringify(report), qualityOk: report.ok, reviewedBy: admin.login }, include: { sources: true } });
  await audit(admin, "blog.edit", id, pick(cur, Object.keys(data)), pick(saved, Object.keys(data)));
  if (saved.status === "published") revalidateBlog(saved.slug);
  return postView(saved);
}
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));

/** Re-runs the code checks against the current text; keeps the model's editorial checks from the last run. */
async function refreshQuality(p: PostRow): Promise<QualityReport> {
  const cfg = await getConfig("blog");
  const prev = parseJson<QualityReport | null>(p.qualityReport, null);
  const topic: TopicCandidate = { topic: p.title, problem: p.painPoint, primaryKeyword: p.primaryKeyword, searchIntent: p.searchIntent, category: p.category, score: 0, basis: "" };
  const outline: OutlineStageOut = { workingTitle: p.title, sections: [], featureTieIn: p.featureTieIn, tieInReason: "" };
  const seo: SeoStageOut = { seoTitle: p.seoTitle || p.title, metaDescription: p.metaDescription, slug: p.slug, primaryKeyword: p.primaryKeyword, secondaryKeywords: parseList(p.secondaryKeywords), searchIntent: p.searchIntent, relatedQuestions: parseList(p.relatedQuestions), category: p.category, tags: parseList(p.tags), ogTitle: p.seoTitle, ogDescription: p.metaDescription, internalLinks: parseJson(p.internalLinks, []), excerpt: p.excerpt };
  // Overlap is judged against what is live or approved, plus older drafts: a newer duplicate in the queue must not block the original.
  const existing = await db.blogPost.findMany({ where: { id: { not: p.id }, OR: [{ status: { in: ["published", "approved"] } }, { status: "pending", createdAt: { lt: p.createdAt } }] }, select: { title: true, primaryKeyword: true } });
  const codeChecks = qualityChecks({ cfg, topic, outline, body: p.bodyMd, seo, sources: (p.sources ?? []).map((s) => ({ ...s, kind: s.kind as any })), existing, allowedHrefs: (await allowedLinks(p.id)).map((l) => l.href) });
  const codeIds = new Set(codeChecks.map((c) => c.id));
  const checks = [...codeChecks, ...(prev?.checks ?? []).filter((c) => !codeIds.has(c.id))];
  return { checks, ok: checks.every((c) => c.ok || !c.critical), editorNote: prev?.editorNote ?? "", wordCount: countWords(p.bodyMd) };
}

export async function rejectPost(admin: AdminSession, id: string, reason: string): Promise<BlogPostView> {
  const cur = await db.blogPost.findUnique({ where: { id } });
  if (!cur) throw new JobError("Article not found.", 404);
  if (cur.status === "published") throw new JobError("Unpublish a live article instead of rejecting it.", 409);
  const saved = await db.blogPost.update({ where: { id }, data: { status: "rejected", rejectReason: str(reason, 500), reviewedBy: admin.login }, include: { sources: true } });
  await db.blogTopic.updateMany({ where: { postId: id }, data: { status: "skipped" } });
  await audit(admin, "blog.reject", id, { status: cur.status }, { status: "rejected" }, reason);
  return postView(saved);
}

/** Back to the review queue from rejected (the topic becomes "written" again so it is not re-proposed). */
export async function restorePost(admin: AdminSession, id: string): Promise<BlogPostView> {
  const cur = await db.blogPost.findUnique({ where: { id } });
  if (!cur) throw new JobError("Article not found.", 404);
  if (cur.status !== "rejected") return getPost(id);
  const saved = await db.blogPost.update({ where: { id }, data: { status: "pending", rejectReason: "", reviewedBy: admin.login }, include: { sources: true } });
  await db.blogTopic.updateMany({ where: { postId: id }, data: { status: "written" } });
  await audit(admin, "blog.restore", id, { status: "rejected" }, { status: "pending" });
  return postView(saved);
}

/**
 * Approve & Publish. Validates the article, the slug and the metadata, blocks on any failing critical quality
 * check, refuses a second publish, then flips the status and refreshes the public pages. The post is only
 * "published" after the database write succeeded, which is what the UI reports.
 */
export async function publishPost(admin: AdminSession, id: string): Promise<BlogPostView> {
  const cur = await db.blogPost.findUnique({ where: { id }, include: { sources: true } });
  if (!cur) throw new JobError("Article not found.", 404);
  if (cur.status === "published") throw new JobError("This article is already live.", 409);
  if (cur.status === "rejected") throw new JobError("Restore the article before publishing it.", 409);
  const problems: string[] = [];
  if (!cur.title.trim()) problems.push("Title is empty.");
  if (countWords(cur.bodyMd) < 200) problems.push("The body is too short to publish.");
  if (!SLUG_RE.test(cur.slug)) problems.push("The slug is not valid.");
  if (!cur.metaDescription.trim()) problems.push("Meta description is empty.");
  if (!cur.category.trim()) problems.push("Pick a category.");
  const clash = await db.blogPost.findFirst({ where: { slug: cur.slug, id: { not: id } }, select: { id: true } });
  if (clash) problems.push("Another article already uses this slug.");
  const dup = await db.blogPost.findFirst({ where: { id: { not: id }, status: "published", OR: [{ title: cur.title }, { primaryKeyword: cur.primaryKeyword || "\u0000" }] }, select: { title: true } });
  if (dup) problems.push(`A live article already covers this ("${dup.title}").`);
  const report = await refreshQuality(cur);
  const blocking = report.checks.filter((c) => c.critical && !c.ok);
  if (blocking.length) problems.push(...blocking.map((c) => c.label + (c.note ? `: ${c.note}` : "")));
  if (problems.length) {
    await db.blogPost.update({ where: { id }, data: { qualityReport: JSON.stringify(report), qualityOk: report.ok } });
    throw new JobError(problems.join(" "), 422);
  }
  const now = new Date();
  const saved = await db.blogPost.update({ where: { id }, data: { status: "published", publishedAt: cur.publishedAt ?? now, publishedBy: admin.login, reviewedBy: admin.login, qualityReport: JSON.stringify(report), qualityOk: true }, include: { sources: true } });
  await audit(admin, "blog.publish", id, { status: cur.status }, { status: "published", slug: saved.slug });
  revalidateBlog(saved.slug);
  return postView(saved);
}

export async function unpublishPost(admin: AdminSession, id: string): Promise<BlogPostView> {
  const cur = await db.blogPost.findUnique({ where: { id } });
  if (!cur) throw new JobError("Article not found.", 404);
  if (cur.status !== "published") return getPost(id);
  const saved = await db.blogPost.update({ where: { id }, data: { status: "approved", reviewedBy: admin.login }, include: { sources: true } });
  await audit(admin, "blog.unpublish", id, { status: "published" }, { status: "approved" });
  revalidateBlog(cur.slug);
  return postView(saved);
}

export function revalidateBlog(slug?: string) {
  try {
    revalidatePath("/blog");
    revalidatePath("/sitemap.xml");
    if (slug) revalidatePath(`/blog/${slug}`);
  } catch {
    /* outside a request (tests) there is nothing to refresh */
  }
}

/** Rewrites one H2 section in place, with the admin's note, keeping everything else byte for byte. */
export async function regenerateSection(admin: AdminSession, id: string, heading: string, note: string): Promise<BlogPostView> {
  const cur = await db.blogPost.findUnique({ where: { id }, include: { sources: true } });
  if (!cur) throw new JobError("Article not found.", 404);
  if (cur.status === "published") throw new JobError("Unpublish before regenerating a section of a live article.", 409);
  const cfg = await getConfig("blog");
  const body = cur.bodyMd.replace(/\r\n/g, "\n");
  const parts = splitSections(body);
  const i = parts.findIndex((p) => p.heading.trim().toLowerCase() === heading.trim().toLowerCase());
  if (i < 0) throw new JobError("That section heading was not found in the article.", 404);
  const sources = (cur.sources ?? []).filter((s) => s.verified).map((s) => `- ${s.title || s.url}: ${s.url}${s.supports ? ` (supports: ${s.supports})` : ""}`).join("\n");
  const prompt = `Audience: ${cfg.audience}\nTone: ${cfg.tone}.\nArticle title: ${cur.title}\nPrimary keyword: ${cur.primaryKeyword}\n\nRewrite ONLY this section of the article. Keep the same H2 heading unless the note asks otherwise, keep it consistent with the rest, and do not repeat what other sections say.\n${note ? `Editor's note: ${note}\n` : ""}\nVerified sources you may link (nothing else):\n${sources || "- none"}\n\nCurrent section:\n${parts[i].text}\n\nRest of the article, for context only:\n${parts
    .filter((_, j) => j !== i)
    .map((p) => p.text)
    .join("\n\n")
    .slice(0, 8000)}\n\nNo invented numbers, studies, quotes or customer stories. No emoji, no em dashes.\nJSON: {"markdown":string}`;
  const { data } = await blogJson<{ markdown: string }>(`You are an experienced creator strategist editing Outlly's blog. Answer only with JSON.`, prompt, { maxTokens: 3000, reasoning: true, temperature: 0.7, timeoutMs: 55_000 });
  const md = String(data?.markdown ?? "").trim().replace(/\u2014/g, ", ");
  if (countWords(md) < 30) throw new JobError("The rewrite came back too short. Try again.", 502);
  const next = md.startsWith("## ") ? md : `## ${parts[i].heading}\n\n${md}`;
  const joined = [...parts.slice(0, i).map((p) => p.text), next, ...parts.slice(i + 1).map((p) => p.text)].join("\n\n");
  return updatePost(admin, id, { bodyMd: joined }).then(async (v) => {
    await audit(admin, "blog.regenerate-section", id, { heading }, { words: countWords(next) }, note);
    return v;
  });
}

export function splitSections(body: string): { heading: string; text: string }[] {
  const lines = body.split("\n");
  const out: { heading: string; text: string }[] = [];
  let cur: { heading: string; lines: string[] } | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      if (cur) out.push({ heading: cur.heading, text: cur.lines.join("\n").trim() });
      cur = { heading: m[1].trim(), lines: [line] };
    } else if (cur) cur.lines.push(line);
    else if (line.trim()) (cur = { heading: "", lines: [line] });
  }
  if (cur) out.push({ heading: cur.heading, text: cur.lines.join("\n").trim() });
  return out;
}

/** Dashboard numbers: honest counts, no estimates. */
/**
 * The morning card: today's pending article (by the blog timezone) and whichever run is going right now.
 * Used by Overview and the Blog dashboard. Never throws; a broken blog table must not take Overview down.
 */
export async function todayBlog(): Promise<{ post: BlogPostView | null; job: BlogJobView | null }> {
  try {
    const cfg = await getConfig("blog");
    const today = localDay(cfg.timezone);
    const [running, todayJobs] = await Promise.all([
      db.blogJob.findFirst({ where: { status: "running" }, orderBy: { startedAt: "desc" }, include: { events: { orderBy: { createdAt: "asc" } } } }),
      db.blogJob.findMany({ where: { forDate: today, status: "done", postId: { not: null } }, select: { postId: true } }),
    ]);
    const ids = todayJobs.map((j) => j.postId!).filter(Boolean);
    const post = ids.length ? await db.blogPost.findFirst({ where: { id: { in: ids }, status: "pending" }, orderBy: { createdAt: "desc" }, include: { sources: { orderBy: { accessedAt: "asc" } } } }) : null;
    return { post: post ? postView(post) : null, job: running ? toView(running) : null };
  } catch {
    return { post: null, job: null };
  }
}

export async function blogStats() {
  const [pending, published, rejected, total, topics, lastPublished] = await Promise.all([
    db.blogPost.count({ where: { status: "pending" } }),
    db.blogPost.count({ where: { status: "published" } }),
    db.blogPost.count({ where: { status: "rejected" } }),
    db.blogPost.count(),
    db.blogTopic.count({ where: { status: { in: ["written", "chosen"] } } }),
    db.blogPost.findFirst({ where: { status: "published" }, orderBy: { publishedAt: "desc" }, select: { publishedAt: true, title: true, slug: true } }),
  ]);
  return { pending, published, rejected, total, topics, lastPublished: lastPublished ? { at: lastPublished.publishedAt!.toISOString(), title: lastPublished.title, slug: lastPublished.slug } : null };
}

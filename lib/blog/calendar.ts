import "server-only";
import { db } from "../db";
import { getConfig } from "../settings";
import { dayDiff } from "./config";
import { JobError, localDay, localMinutes } from "./job";
import { hhmm } from "./schedule";
import { STAGE_LABEL, type BlogBacklogTopic, type BlogCalendarDay, type BlogCalendarItem, type BlogCalendarMonth, type BlogHistoryRow, type BlogHistoryStatus, type StageData } from "./types";

/**
 * R1178: what the admin calendar and history read. Every day sits in the blog timezone. Queries are bounded to the
 * month window plus a day of slack either side, because a UTC timestamp near midnight can land on the next local day.
 */

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_MS = 86_400_000;

function jobTopic(stageData: string): string {
  try {
    const d = JSON.parse(stageData || "{}") as StageData;
    return d.topic?.candidates[d.topic.chosen]?.topic ?? "";
  } catch {
    return "";
  }
}
const stageLabel = (s: string) => STAGE_LABEL[s as keyof typeof STAGE_LABEL] ?? s;

/** A running job is late once readyBy has passed on its own day (or its day is already over). */
function isLate(forDate: string, today: string, minutesNow: number, readyBy: string) {
  const d = dayDiff(forDate, today);
  return d > 0 || (d === 0 && minutesNow >= hhmm(readyBy));
}

export async function calendarMonth(month?: string, now = new Date()): Promise<BlogCalendarMonth> {
  const cfg = await getConfig("blog");
  const tz = cfg.timezone;
  const today = localDay(tz, now);
  const m = month ?? today.slice(0, 7);
  const match = MONTH_RE.exec(m);
  if (!match) throw new JobError("Month must be YYYY-MM.", 400);
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const count = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const first = `${m}-01`;
  const last = `${m}-${String(count).padStart(2, "0")}`;
  const from = new Date(Date.UTC(y, mo - 1, 1) - DAY_MS);
  const to = new Date(Date.UTC(y, mo, 1) + DAY_MS);
  const minutesNow = localMinutes(tz, now);

  const jobs = await db.blogJob.findMany({ where: { forDate: { gte: first, lte: last } }, orderBy: { startedAt: "asc" }, take: 500 });
  const jobIds = jobs.map((j) => j.id);
  const posts = await db.blogPost.findMany({
    where: { OR: [{ publishedAt: { gte: from, lt: to } }, { scheduledFor: { gte: from, lt: to } }, { createdAt: { gte: from, lt: to } }, ...(jobIds.length ? [{ jobId: { in: jobIds } }] : [])] },
    select: { id: true, title: true, status: true, publishedAt: true, scheduledFor: true, createdAt: true, jobId: true, rejectReason: true },
    take: 500,
  });
  // A post that came from a run outside the month still needs its run's day.
  const outside = [...new Set(posts.map((p) => p.jobId).filter((id): id is string => !!id && !jobIds.includes(id)))];
  const jobDay = new Map<string, string>(jobs.map((j) => [j.id, j.forDate]));
  if (outside.length) for (const j of await db.blogJob.findMany({ where: { id: { in: outside } }, select: { id: true, forDate: true } })) jobDay.set(j.id, j.forDate);

  const byDay = new Map<string, BlogCalendarItem[]>();
  const put = (date: string, item: BlogCalendarItem) => {
    if (date < first || date > last) return;
    byDay.set(date, [...(byDay.get(date) ?? []), item]);
  };
  for (const p of posts) {
    // A rewrite replaces the old draft: show the new one only.
    if (p.status === "rejected" && p.rejectReason.startsWith("Replaced by a rewrite")) continue;
    const href = `/admin/blog/review/${p.id}`;
    if (p.status === "published" && p.publishedAt) put(localDay(tz, p.publishedAt), { kind: "post", id: p.id, title: p.title, status: "published", href, at: p.publishedAt.toISOString(), note: "" });
    else if (p.status === "approved" && p.scheduledFor) put(localDay(tz, p.scheduledFor), { kind: "post", id: p.id, title: p.title, status: "scheduled", href, at: p.scheduledFor.toISOString(), note: "" });
    else {
      const day = (p.jobId && jobDay.get(p.jobId)) || localDay(tz, p.createdAt);
      const status = p.status === "approved" || p.status === "rejected" ? p.status : "pending";
      put(day, { kind: "post", id: p.id, title: p.title, status, href, at: p.createdAt.toISOString(), note: "" });
    }
  }
  const postJobs = new Set(posts.map((p) => p.jobId).filter(Boolean));
  for (const j of jobs) {
    if (j.postId || postJobs.has(j.id) || j.status === "done") continue;
    // A failed or stopped run that a later run of the same day replaced is history, not news.
    if (j.status !== "running" && jobs.some((o) => o.forDate === j.forDate && o.startedAt > j.startedAt)) continue;
    const late = j.status === "running" && isLate(j.forDate, today, minutesNow, cfg.schedule.readyBy);
    const status = j.status === "running" ? (late ? "delayed" : "running") : j.status === "failed" ? "failed" : "cancelled";
    const title = jobTopic(j.stageData) || j.topicHint || (j.status === "running" ? "Choosing a topic..." : "No topic chosen yet");
    const note = status === "failed" || status === "cancelled" ? j.error : stageLabel(j.stage);
    put(j.forDate, { kind: "job", id: j.id, title, status, href: "/admin/blog/generate", at: j.startedAt.toISOString(), note });
  }

  const skip = new Set(cfg.skipDates ?? []);
  const scheduledCount = new Map<string, number>();
  for (const j of jobs) if (j.kind === "scheduled") scheduledCount.set(j.forDate, (scheduledCount.get(j.forDate) ?? 0) + 1);
  const perDay = Math.max(1, cfg.schedule.perDay);
  const days: BlogCalendarDay[] = [];
  for (let d = 1; d <= count; d++) {
    const date = `${m}-${String(d).padStart(2, "0")}`;
    const skipped = skip.has(date);
    const scheduledRun = cfg.schedule.enabled && !cfg.paused && !skipped && date >= today && (scheduledCount.get(date) ?? 0) < perDay;
    days.push({ date, skipped, scheduledRun, items: (byDay.get(date) ?? []).sort((a, b) => a.at.localeCompare(b.at)) });
  }
  return { month: m, today, timezone: tz, startTime: cfg.schedule.startTime, readyBy: cfg.schedule.readyBy, enabled: cfg.schedule.enabled, paused: cfg.paused, days };
}

export async function blogHistory(take = 60, now = new Date()): Promise<BlogHistoryRow[]> {
  const cfg = await getConfig("blog");
  const today = localDay(cfg.timezone, now);
  const minutesNow = localMinutes(cfg.timezone, now);
  const jobs = await db.blogJob.findMany({ orderBy: { startedAt: "desc" }, take: Math.min(Math.max(1, take), 200) });
  const runningDays = new Map<string, string[]>();
  for (const r of await db.blogJob.findMany({ where: { status: "running" }, select: { id: true, forDate: true } })) runningDays.set(r.forDate, [...(runningDays.get(r.forDate) ?? []), r.id]);
  return jobs.map((j) => {
    let status: BlogHistoryStatus = j.status as BlogHistoryStatus;
    if (j.status === "running") status = isLate(j.forDate, today, minutesNow, cfg.schedule.readyBy) ? "delayed" : j.error ? "retrying" : "running";
    const otherRunning = (runningDays.get(j.forDate) ?? []).some((id) => id !== j.id);
    return {
      jobId: j.id,
      date: j.forDate,
      kind: j.kind,
      startedBy: j.startedBy,
      startedAt: j.startedAt.toISOString(),
      finishedAt: j.finishedAt?.toISOString() ?? null,
      topic: jobTopic(j.stageData),
      status,
      stage: j.stage,
      error: j.error,
      postId: j.postId,
      canRetry: (j.status === "failed" || j.status === "cancelled") && !otherRunning && !cfg.paused,
    };
  });
}

const topicView = (t: { id: string; topic: string; problem: string; primaryKeyword: string; category: string; status: string; score: number; createdAt: Date }): BlogBacklogTopic => ({
  id: t.id,
  topic: t.topic,
  problem: t.problem,
  primaryKeyword: t.primaryKeyword,
  category: t.category,
  status: t.status === "backlog" ? "backlog" : "candidate",
  score: t.score,
  createdAt: t.createdAt.toISOString(),
});

/** Backlog oldest first (the next scheduled run takes the first); runner-ups not already written, chosen or queued. */
export async function backlogTopics(): Promise<{ backlog: BlogBacklogTopic[]; candidates: BlogBacklogTopic[] }> {
  const [backlog, candidates, taken, posts] = await Promise.all([
    db.blogTopic.findMany({ where: { status: "backlog" }, orderBy: { createdAt: "asc" }, take: 100 }),
    db.blogTopic.findMany({ where: { status: "candidate" }, orderBy: { createdAt: "desc" }, take: 300 }),
    db.blogTopic.findMany({ where: { status: { in: ["written", "chosen", "used", "backlog"] } }, select: { topic: true, primaryKeyword: true }, take: 500 }),
    db.blogPost.findMany({ where: { status: { not: "rejected" } }, select: { title: true, primaryKeyword: true }, take: 500 }),
  ]);
  const usedTopics = new Set([...taken.map((t) => t.topic), ...posts.map((p) => p.title)].map((s) => s.trim().toLowerCase()));
  const usedKeywords = new Set([...taken, ...posts].map((t) => t.primaryKeyword.trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  const fresh = candidates.filter((c) => {
    const k = c.topic.trim().toLowerCase();
    if (usedTopics.has(k) || (c.primaryKeyword && usedKeywords.has(c.primaryKeyword.trim().toLowerCase())) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Already newest first; a stable sort by score keeps newer runs ahead on ties.
  fresh.sort((a, b) => b.score - a.score);
  return { backlog: backlog.map(topicView), candidates: fresh.slice(0, 15).map(topicView) };
}

/** A new topic for the backlog, or a runner-up moved into it (it then queues behind what is already there). */
export async function addBacklogTopic(input: { topic?: string; problem?: string; primaryKeyword?: string; category?: string; fromId?: string }): Promise<BlogBacklogTopic> {
  if (input.fromId) {
    const cur = await db.blogTopic.findUnique({ where: { id: input.fromId } });
    if (!cur) throw new JobError("That topic no longer exists.", 404);
    if (cur.status === "backlog") return topicView(cur);
    if (cur.status !== "candidate") throw new JobError("Only a runner-up topic can move into the backlog.", 409);
    return topicView(await db.blogTopic.update({ where: { id: cur.id }, data: { status: "backlog", createdAt: new Date() } }));
  }
  const topic = (input.topic ?? "").trim().slice(0, 200);
  if (!topic) throw new JobError("Write the topic first.");
  const row = await db.blogTopic.create({
    data: { topic, problem: (input.problem ?? "").trim().slice(0, 400), primaryKeyword: (input.primaryKeyword ?? "").trim().toLowerCase().slice(0, 80), category: (input.category ?? "").trim().slice(0, 60), status: "backlog", basis: "Added by an admin" },
  });
  return topicView(row);
}

export async function removeBacklogTopic(id: string): Promise<void> {
  const cur = await db.blogTopic.findUnique({ where: { id }, select: { status: true } });
  if (!cur) throw new JobError("That topic no longer exists.", 404);
  if (cur.status !== "backlog") throw new JobError("Only a backlog topic can be removed.", 409);
  await db.blogTopic.delete({ where: { id } });
}

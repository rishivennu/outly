import "server-only";
import type { ClipCandidate, ClipJob, GeneratedClip, Prisma } from "@prisma/client";
import { db } from "../db";
import { hasIntelligence } from "../intelligence/entitlements";
import { HttpError } from "../http";
import { mediaView, ownedMedia } from "../services";
import { normalizeCues, type Cue } from "../captions/cues";
import { cleanWords, cuesFromWords, DEFAULT_SUBTITLE_RULES, findText, highlightPrompt, parseHighlights, type Highlight, type Word } from "../captions/subtitle-engine";
import { logLearning } from "../intelligence/learning";
import { modelStates } from "../intelligence/model/predict";
import { fromHighlights, rankCandidates, textOf, widen, type PersonalHints, type ScoredCandidate } from "./candidates-core";
import { draftCopy } from "./copy-core";
import { DEFAULT_REFRAME, parseReframe, reframeOf, type ReframePlan } from "./reframe-core";
import { ACTIVE_JOBS_MAX, CANDIDATES_MAX, CLIP_MAX_SEC, CLIP_MIN_SEC, MAX_SOURCE_SEC, isActive, nextState, parseSettings, settingsOf, sourceProblem, type ClipSettings, type Executor, type JobEvent } from "./settings-core";

/**
 * R1321: the Shorts Clipper's stored side. A job is created from an owned Media, moves through the state machine in
 * settings-core.ts by events an executor reports, keeps its transcript and candidates, and turns approved candidates
 * into GeneratedClips the executor renders. Every read and write is scoped by ownerId; every change writes a ClipEvent.
 */

export type Actor = { id: string; role: string };

const json = (v: unknown) => JSON.stringify(v);
const parse = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

async function event(jobId: string, ownerId: string, type: string, data?: unknown, clipId?: string | null, actorId?: string | null) {
  await db.clipEvent.create({ data: { jobId, clipId: clipId ?? null, ownerId, actorId: actorId ?? null, type, data: data === undefined ? null : json(data).slice(0, 4000) } });
}

/* ------------------------------------------------------------------ views */

export interface JobView {
  id: string;
  mediaId: string | null;
  status: string;
  stage: string;
  progress: number;
  executor: string;
  settings: ClipSettings;
  error: string | null;
  durationSec: number | null;
  language: string | null;
  heartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  counts: { candidates: number; clips: number };
}

export interface CandidateView extends Omit<ScoredCandidate, "source" | "kind"> {
  id: string;
  kind: string;
  source: string;
  status: string;
  clipId: string | null;
}

export interface ClipView {
  id: string;
  jobId: string;
  candidateId: string | null;
  start: number;
  end: number;
  title: string;
  hook: string | null;
  caption: string | null;
  hashtags: string | null;
  reframe: ReframePlan;
  subtitle: ClipSettings["subtitle"];
  renderStatus: string;
  renderError: string | null;
  renderedAt: string | null;
  mediaId: string | null;
  postId: string | null;
  /** R1323: the post made from this clip, when the detail was read with its posts (null = none, or not looked up). */
  post: ClipPostView | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** R1323: what the clip screen needs to know about the post a clip became. */
export interface ClipPostView {
  id: string;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
}

const jobView = (j: ClipJob & { _count?: { candidates: number; clips: number } }): JobView => ({
  id: j.id,
  mediaId: j.mediaId,
  status: j.status,
  stage: j.stage,
  progress: j.progress,
  executor: j.executor,
  settings: parseSettings(j.settings),
  error: j.error,
  durationSec: j.durationSec,
  language: j.language,
  heartbeatAt: j.heartbeatAt?.toISOString() ?? null,
  createdAt: j.createdAt.toISOString(),
  updatedAt: j.updatedAt.toISOString(),
  completedAt: j.completedAt?.toISOString() ?? null,
  counts: { candidates: j._count?.candidates ?? 0, clips: j._count?.clips ?? 0 },
});

const candidateView = (c: ClipCandidate & { clip?: { id: string } | null }): CandidateView => ({
  id: c.id,
  start: c.start,
  end: c.end,
  kind: c.kind,
  title: c.title,
  reason: c.reason,
  scores: parse(c.scores, { hook: 0, selfContained: 0, length: 0, density: 0, personal: 0.5, total: c.score }),
  score: c.score,
  rank: c.rank,
  source: c.source,
  status: c.status,
  clipId: c.clip?.id ?? null,
});

export const clipView = (c: GeneratedClip, post: ClipPostView | null = null): ClipView => ({
  id: c.id,
  jobId: c.jobId,
  candidateId: c.candidateId,
  start: c.start,
  end: c.end,
  title: c.title,
  hook: c.hook,
  caption: c.caption,
  hashtags: c.hashtags,
  reframe: parseReframe(c.reframe),
  subtitle: settingsOf({ subtitle: parse(c.subtitle, {}) }).subtitle,
  renderStatus: c.renderStatus,
  renderError: c.renderError,
  renderedAt: c.renderedAt?.toISOString() ?? null,
  mediaId: c.mediaId,
  postId: c.postId,
  post,
  status: c.status,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const postSummary = (p: { id: string; status: string; scheduledAt: Date | null; publishedAt: Date | null }): ClipPostView => ({ id: p.id, status: p.status, scheduledAt: p.scheduledAt?.toISOString() ?? null, publishedAt: p.publishedAt?.toISOString() ?? null });

/**
 * R1323: clips with the posts they became. Reading is also when a clip learns its post went out: the clip turns
 * `published`, gets a ClipEvent and one LearningEvent (`clip_published`, deduped), so the loop closes without a hook
 * in the publishing path. A post that was deleted leaves `post` null and the clip as it was.
 */
export async function clipsWithPosts(ownerId: string, clips: GeneratedClip[]): Promise<ClipView[]> {
  const ids = clips.map((c) => c.postId).filter((id): id is string => !!id);
  if (!ids.length) return clips.map((c) => clipView(c));
  const posts = await db.post.findMany({ where: { id: { in: ids }, userId: ownerId }, select: { id: true, status: true, scheduledAt: true, publishedAt: true } });
  const byId = new Map(posts.map((p) => [p.id, postSummary(p)]));
  const out: ClipView[] = [];
  for (let c of clips) {
    const post = c.postId ? byId.get(c.postId) ?? null : null;
    if (post && (post.status === "published" || post.status === "partial") && c.status !== "published" && c.status !== "discarded") {
      const n = await db.generatedClip.updateMany({ where: { id: c.id, ownerId, status: c.status }, data: { status: "published" } });
      if (n.count) {
        await event(c.jobId, ownerId, "published", { postId: post.id, publishedAt: post.publishedAt }, c.id, null);
        await logLearning(ownerId, "clip_published", { subjectType: "clip", subjectId: c.id, dedupeKey: `clip_published:${c.id}`, data: { jobId: c.jobId, postId: post.id, start: c.start, end: c.end, candidateId: c.candidateId, length: Math.round((c.end - c.start) * 10) / 10 }, at: post.publishedAt ? new Date(post.publishedAt) : undefined }).catch(() => false);
        c = { ...c, status: "published" };
      }
    }
    out.push(clipView(c, post));
  }
  return out;
}

/* ------------------------------------------------------------------ jobs */

const COUNT = { _count: { select: { candidates: true, clips: true } } } as const;

export async function ownedJob(ownerId: string, id: string) {
  const j = await db.clipJob.findFirst({ where: { id, ownerId }, include: COUNT });
  if (!j) throw new HttpError(404, "We couldn't find that clipper job.", "NO_JOB");
  return j;
}

export async function createJob(ownerId: string, input: { mediaId: string; clientKey?: string | null; settings?: unknown; executor?: Executor }, actor: Actor): Promise<{ job: JobView; created: boolean }> {
  const clientKey = input.clientKey?.trim() || null;
  if (clientKey) {
    const same = await db.clipJob.findUnique({ where: { ownerId_clientKey: { ownerId, clientKey } }, include: COUNT });
    if (same && same.mediaId !== input.mediaId) throw new HttpError(409, "That client key already names a job for another video.", "KEY_IN_USE");
    if (same) return { job: jobView(same), created: false };
  }
  const media = await ownedMedia(ownerId, input.mediaId);
  if (media.deletedAt) throw new HttpError(400, "That video is in the Trash. Restore it first.", "TRASHED");
  const problem = sourceProblem(media);
  if (problem) throw new HttpError(400, problem, "BAD_SOURCE");
  const active = await db.clipJob.count({ where: { ownerId, status: { in: ["queued", "running"] } } });
  if (active >= ACTIVE_JOBS_MAX) throw new HttpError(409, `You already have ${active} clipper ${active === 1 ? "job" : "jobs"} running. Let it finish or cancel it first.`, "TOO_MANY_JOBS");
  const settings = settingsOf(input.settings);
  try {
    const job = await db.clipJob.create({ data: { ownerId, mediaId: media.id, clientKey, settings: json(settings), executor: input.executor ?? "browser", durationSec: media.duration ?? null, language: settings.language || null }, include: COUNT });
    await event(job.id, ownerId, "created", { mediaId: media.id, settings, executor: job.executor }, null, actor.id);
    return { job: jobView(job), created: true };
  } catch (e) {
    if (!isUnique(e) || !clientKey) throw e;
    const same = await db.clipJob.findUnique({ where: { ownerId_clientKey: { ownerId, clientKey } }, include: COUNT });
    if (!same) throw e;
    return { job: jobView(same), created: false };
  }
}

export async function listJobs(ownerId: string, opts: { limit?: number; status?: string } = {}): Promise<JobView[]> {
  const take = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 20) || 20));
  const rows = await db.clipJob.findMany({ where: { ownerId, ...(opts.status ? { status: opts.status } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take, include: COUNT });
  return rows.map(jobView);
}

export interface JobDetail {
  job: JobView;
  media: Awaited<ReturnType<typeof mediaView>> | null;
  transcript: { engine: string; language: string; wordCount: number; cues: Cue[] } | null;
  candidates: CandidateView[];
  clips: ClipView[];
}

/** One job with everything the screen needs. Cues (up to 6000 lines) come only with `transcript: true`; polling goes without. */
export async function jobDetail(ownerId: string, id: string, opts: { transcript?: boolean } = {}): Promise<JobDetail> {
  const j = await ownedJob(ownerId, id);
  const [media, transcript, candidates, clips] = await Promise.all([
    j.mediaId ? db.media.findFirst({ where: { id: j.mediaId, userId: ownerId } }).then((m) => (m ? mediaView(m) : null)) : null,
    db.clipTranscript.findUnique({ where: { jobId: j.id } }),
    db.clipCandidate.findMany({ where: { jobId: j.id, ownerId }, orderBy: [{ rank: "asc" }, { start: "asc" }], take: 50, include: { clip: { select: { id: true } } } }),
    db.generatedClip.findMany({ where: { jobId: j.id, ownerId, status: { not: "discarded" } }, orderBy: [{ start: "asc" }, { id: "asc" }], take: 50 }),
  ]);
  return {
    job: jobView(j),
    media,
    transcript: transcript ? { engine: transcript.engine, language: transcript.language, wordCount: transcript.wordCount, cues: opts.transcript ? parse<Cue[]>(transcript.cues, []) : [] } : null,
    candidates: candidates.map(candidateView),
    clips: await clipsWithPosts(ownerId, clips),
  };
}

/** Move the job by an event; an event the state machine refuses is a 409 that names where the job is. */
export async function moveJob(ownerId: string, id: string, ev: JobEvent, actor: Actor | null, extra: Prisma.ClipJobUpdateInput = {}): Promise<JobView> {
  const j = await ownedJob(ownerId, id);
  const next = nextState(j, ev);
  if (!next) throw new HttpError(409, `This job is ${j.status} at the ${j.stage} stage; "${ev}" does not apply here.`, "BAD_TRANSITION");
  const now = new Date();
  if (ev === "start" && j.status === "running") {
    // Already running (a second tab, a retry of the same call): only the heartbeat and the executor move.
    await db.clipJob.updateMany({ where: { id: j.id, ownerId, status: "running" }, data: { heartbeatAt: now, ...extra } });
    return jobView(await ownedJob(ownerId, id));
  }
  const n = await db.clipJob.updateMany({
    where: { id: j.id, ownerId, status: j.status, stage: j.stage },
    data: { status: next.status, stage: next.stage, heartbeatAt: now, ...(ev === "start" || ev === "retry" ? { error: null, progress: 0 } : {}), ...(next.stage === "done" || next.status === "cancelled" ? { completedAt: now } : {}), ...extra },
  });
  if (!n.count) throw new HttpError(409, "The job just changed under you. Refresh to see where it is.", "CONFLICT");
  await event(j.id, ownerId, ev, { from: { status: j.status, stage: j.stage }, to: next }, null, actor?.id ?? null);
  return jobView(await ownedJob(ownerId, id));
}

export async function heartbeat(ownerId: string, id: string, progress: number, executor?: Executor): Promise<JobView> {
  const j = await ownedJob(ownerId, id);
  if (!isActive(j.status)) throw new HttpError(409, `This job is ${j.status}; nothing is running.`, "NOT_RUNNING");
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  await db.clipJob.updateMany({ where: { id: j.id, ownerId }, data: { progress: p, heartbeatAt: new Date(), ...(executor ? { executor } : {}) } });
  return jobView(await ownedJob(ownerId, id));
}

export async function failJob(ownerId: string, id: string, error: string, actor: Actor | null) {
  return moveJob(ownerId, id, "fail", actor, { error: error.slice(0, 300) });
}

/* ------------------------------------------------------------------ transcript */

export const TRANSCRIPT_MAX = { words: 40_000, cues: 6_000 } as const;

/** The executor's transcript: words cleaned and cues rebuilt (or taken as sent) with the shared rules, stored once. */
export async function saveTranscript(ownerId: string, id: string, input: { words: unknown; cues?: unknown; language?: string; engine?: string; durationSec?: number | null }, actor: Actor | null): Promise<{ job: JobView; wordCount: number; cues: number }> {
  const j = await ownedJob(ownerId, id);
  if (j.status !== "running" || j.stage !== "transcribe") throw new HttpError(409, `This job is ${j.status} at the ${j.stage} stage; it is not waiting for a transcript.`, "BAD_TRANSITION");
  const reported = input.durationSec && input.durationSec > 0 ? Math.min(input.durationSec, MAX_SOURCE_SEC) : null;
  const duration = reported ?? j.durationSec ?? MAX_SOURCE_SEC;
  const words = cleanWords(input.words, 0, duration).slice(0, TRANSCRIPT_MAX.words);
  if (words.length < 3) throw new HttpError(400, "The transcript is empty. The video may have no speech, or the audio did not come through.", "EMPTY_TRANSCRIPT");
  const cues = (Array.isArray(input.cues) && input.cues.length ? normalizeCues(input.cues as { start: unknown; end: unknown; text: unknown }[], duration) : cuesFromWords(words, DEFAULT_SUBTITLE_RULES)).slice(0, TRANSCRIPT_MAX.cues);
  const language = (input.language ?? "").trim().slice(0, 12);
  const engine = (input.engine ?? "unknown").trim().slice(0, 24) || "unknown";
  // The transcript and the stage move land together, guarded by the stage: a second "transcribed" racing the first
  // cannot overwrite a transcript detection is already reading.
  const next = nextState(j, "transcribed")!;
  await db.$transaction(async (tx) => {
    const n = await tx.clipJob.updateMany({
      where: { id: j.id, ownerId, status: "running", stage: "transcribe" },
      data: { status: next.status, stage: next.stage, heartbeatAt: new Date(), progress: 0, language: language || j.language, ...(reported ? { durationSec: reported } : {}) },
    });
    if (!n.count) throw new HttpError(409, "The job just changed under you. Refresh to see where it is.", "CONFLICT");
    await tx.clipTranscript.upsert({
      where: { jobId: j.id },
      create: { jobId: j.id, ownerId, engine, language, words: json(words), cues: json(cues), wordCount: words.length },
      update: { engine, language, words: json(words), cues: json(cues), wordCount: words.length },
    });
  });
  await event(j.id, ownerId, "transcribed", { from: { status: j.status, stage: j.stage }, to: next, words: words.length, cues: cues.length, engine }, null, actor?.id ?? null);
  return { job: jobView(await ownedJob(ownerId, id)), wordCount: words.length, cues: cues.length };
}

async function transcriptOf(ownerId: string, jobId: string): Promise<{ words: Word[]; cues: Cue[] }> {
  const t = await db.clipTranscript.findFirst({ where: { jobId, ownerId } });
  if (!t) throw new HttpError(409, "This job has no transcript yet.", "NO_TRANSCRIPT");
  return { words: parse<Word[]>(t.words, []), cues: parse<Cue[]>(t.cues, []) };
}

/* ------------------------------------------------------------------ detection */

/** What the creator's own history says about hooks and short videos, on the platforms this job is for. */
export async function hintsFor(ownerId: string, platforms: readonly string[]): Promise<PersonalHints> {
  // R1334: the personal part of the score is a paid capability; without it every candidate scores neutral (0.5), which
  // is what `personalScore` does with null hints, and the reason line never says "what works for you".
  if (!(await hasIntelligence(ownerId, "personalized_clip_ranking_enabled").catch(() => false))) return { hookLiftPct: null, shortVideoLiftPct: null };
  const states = await modelStates(ownerId).catch(() => []);
  const pick = (trait: string) => {
    const mine = states.filter((s) => platforms.includes(s.platform) && (s.level === "personal" || s.level === "blended"));
    const l = mine.flatMap((s) => s.lifts).find((x) => x.trait === trait);
    return l ? l.liftPct : null;
  };
  return { hookLiftPct: pick("hasHook"), shortVideoLiftPct: pick("shortVideo") };
}

/** Asks a model for a JSON answer (lib/ai/creative gemini in the app, injected in tests). Null = no AI available. */
export type AskJson = (system: string, prompt: string) => Promise<unknown>;

/**
 * Without a model: windows that start at a line start and run to the last line end inside the sweet spot, every
 * few lines, so the creator always gets ranked moments to pick from. Scored exactly like the model's picks.
 */
export const RULE_WINDOWS_MAX = 60;
/**
 * The fallback detector: sweet-spot windows over the whole transcript, each starting at a line, neighbours
 * half-overlapping so the overlap rule in rankCandidates keeps the better one. A long source gives many windows;
 * they are sampled evenly down to RULE_WINDOWS_MAX so every part of the video stays in the running.
 */
export function ruleWindows(cues: Cue[], settings: ClipSettings): Highlight[] {
  const all: Highlight[] = [];
  const sweet = Math.min(settings.maxSec, Math.max(settings.minSec, Math.round((settings.minSec + settings.maxSec) / 2)));
  let i = 0;
  while (i < cues.length) {
    const start = cues[i].start;
    let j = i;
    while (j + 1 < cues.length && cues[j + 1].end - start <= sweet) j++;
    const end = cues[j].end;
    if (end - start >= settings.minSec) all.push({ start, end, title: cues[i].text.split(/\s+/).slice(0, 8).join(" "), why: "" });
    i = Math.max(i + 1, Math.floor((i + j) / 2) + 1);
  }
  if (all.length <= RULE_WINDOWS_MAX) return all;
  const step = all.length / RULE_WINDOWS_MAX;
  return Array.from({ length: RULE_WINDOWS_MAX }, (_, k) => all[Math.min(all.length - 1, Math.floor(k * step))]);
}

export interface DetectResult {
  job: JobView;
  candidates: CandidateView[];
  detector: "ai" | "rules";
}

/** Runs detection over the stored transcript, replaces the job's suggested AI candidates, moves the job to review. */
export async function detect(ownerId: string, id: string, opts: { ask: AskJson | null; actor: Actor | null; note?: Record<string, unknown> | null }): Promise<DetectResult> {
  const j = await ownedJob(ownerId, id);
  if (j.status !== "running" || j.stage !== "detect") throw new HttpError(409, `This job is ${j.status} at the ${j.stage} stage; it is not waiting for detection.`, "BAD_TRANSITION");
  const settings = parseSettings(j.settings);
  const { words, cues } = await transcriptOf(ownerId, j.id);
  const duration = j.durationSec ?? (cues.length ? cues[cues.length - 1].end : 0);
  const rules = { ...DEFAULT_SUBTITLE_RULES, highlights: { count: Math.min(12, settings.target + 3), minSec: settings.minSec, maxSec: settings.maxSec } };
  let detector: DetectResult["detector"] = "rules";
  let highlights: Highlight[] = [];
  if (opts.ask) {
    const { system, prompt } = highlightPrompt(cues, rules);
    const out = await opts.ask(system, prompt).catch(() => null);
    if (out) {
      highlights = parseHighlights(out, cues, duration, rules);
      detector = "ai";
    }
  }
  if (!highlights.length) {
    highlights = ruleWindows(cues, settings);
    detector = "rules";
  }
  const hints = await hintsFor(ownerId, settings.platforms);
  const ranked = rankCandidates(fromHighlights(highlights), { cues, words, settings, hints });
  // The stage flips inside the same transaction as the candidate writes: a cancel or a second detect that landed
  // while the model was thinking makes the whole write roll back (409), never half a candidate set.
  const next = nextState(j, "detected")!;
  await db.$transaction(async (tx) => {
    const n = await tx.clipJob.updateMany({ where: { id: j.id, ownerId, status: "running", stage: "detect" }, data: { status: next.status, stage: next.stage, progress: 1, heartbeatAt: new Date() } });
    if (!n.count) throw new HttpError(409, "The job just changed under you. Refresh to see where it is.", "CONFLICT");
    await tx.clipCandidate.deleteMany({ where: { jobId: j.id, ownerId, source: "ai", status: "suggested" } });
    for (const c of ranked) await tx.clipCandidate.create({ data: { jobId: j.id, ownerId, start: c.start, end: c.end, kind: c.kind, title: c.title, reason: c.reason, scores: json(c.scores), score: c.score, rank: c.rank, source: "ai" } });
  });
  await event(j.id, ownerId, "detected", { detector, candidates: ranked.length, hints, from: { status: j.status, stage: j.stage }, to: next, ...(opts.note ?? {}) }, null, opts.actor?.id ?? null);
  const job = jobView(await ownedJob(ownerId, id));
  const rows = await db.clipCandidate.findMany({ where: { jobId: j.id, ownerId }, orderBy: [{ rank: "asc" }, { start: "asc" }], take: 50, include: { clip: { select: { id: true } } } });
  return { job, candidates: rows.map(candidateView), detector };
}

/** The creator's own words -> ranges from the transcript, scored and added as "text" candidates. */
/** Candidates a job may hold in all (AI, text and manual together). */
export const CANDIDATES_PER_JOB_MAX = CANDIDATES_MAX * 5;

export async function addTextCandidates(ownerId: string, id: string, query: string, actor: Actor): Promise<{ added: CandidateView[]; missing: string[] }> {
  const j = await ownedJob(ownerId, id);
  if (j.status !== "ready") throw new HttpError(409, "Finish detection first, then cut by text.", "BAD_TRANSITION");
  const settings = parseSettings(j.settings);
  const { words, cues } = await transcriptOf(ownerId, j.id);
  const { ranges, missing } = findText(words, query.slice(0, 500), DEFAULT_SUBTITLE_RULES, j.durationSec ?? Infinity);
  const have = await db.clipCandidate.findMany({ where: { jobId: j.id, ownerId }, select: { start: true, end: true, source: true }, take: CANDIDATES_PER_JOB_MAX });
  const existing = have.length;
  if (existing >= CANDIDATES_PER_JOB_MAX) throw new HttpError(409, `This job already has ${existing} moments. Reject some before adding more.`, "TOO_MANY_CANDIDATES");
  // A phrase is a second or two wide; grow each hit to whole lines and at least the shortest clip, phrase first.
  const widened = ranges.map((r) => ({ ...widen(r, cues, Math.min(settings.minSec, CLIP_MIN_SEC), settings.maxSec, j.durationSec ?? Infinity), source: "text" as const }));
  // The same phrase searched twice adds nothing; a moment the AI also picked is still added (the creator asked for
  // it by name), unless the ranges are all but identical.
  const share = (a: { start: number; end: number }, b: { start: number; end: number }) => (Math.min(a.end, b.end) - Math.max(a.start, b.start)) / Math.max(0.01, Math.min(a.end - a.start, b.end - b.start));
  const same = (a: { start: number; end: number }, b: { start: number; end: number }) => (Math.min(a.end, b.end) - Math.max(a.start, b.start)) / Math.max(0.01, Math.max(a.end, b.end) - Math.min(a.start, b.start));
  const fresh = widened.filter((r) => !have.some((h) => (h.source === "text" ? share(h, r) > 0.5 : same(h, r) > 0.9)));
  const ranked = rankCandidates(fresh, { cues, words, settings: { ...settings, minSec: Math.min(settings.minSec, CLIP_MIN_SEC) }, hints: await hintsFor(ownerId, settings.platforms) }).slice(0, CANDIDATES_PER_JOB_MAX - existing);
  const added: CandidateView[] = [];
  for (const [i, c] of ranked.entries()) {
    const row = await db.clipCandidate.create({ data: { jobId: j.id, ownerId, start: c.start, end: c.end, kind: "text", title: c.title, reason: c.reason, scores: json(c.scores), score: c.score, rank: existing + i + 1, source: "text" } });
    added.push(candidateView(row));
  }
  await event(j.id, ownerId, "text_search", { query: query.slice(0, 200), added: added.length, missing }, null, actor.id);
  return { added, missing };
}

/* ------------------------------------------------------------------ clips */

async function ownedCandidate(ownerId: string, id: string) {
  const c = await db.clipCandidate.findFirst({ where: { id, ownerId }, include: { clip: { select: { id: true } }, job: true } });
  if (!c) throw new HttpError(404, "We couldn't find that moment.", "NO_CANDIDATE");
  return c;
}

export async function ownedClip(ownerId: string, id: string) {
  const c = await db.generatedClip.findFirst({ where: { id, ownerId } });
  if (!c) throw new HttpError(404, "We couldn't find that clip.", "NO_CLIP");
  return c;
}

/** Approve a moment: it becomes a clip with a first draft of copy. Approving twice returns the same clip. */
export async function approveCandidate(ownerId: string, candidateId: string, actor: Actor): Promise<{ clip: ClipView; created: boolean }> {
  const c = await ownedCandidate(ownerId, candidateId);
  if (c.clip) return { clip: clipView(await ownedClip(ownerId, c.clip.id)), created: false };
  if (c.job.status === "cancelled") throw new HttpError(409, "This job was cancelled.", "CANCELLED");
  const settings = parseSettings(c.job.settings);
  const { words } = await transcriptOf(ownerId, c.jobId);
  const copy = draftCopy(textOf(words, c), c.title, settings.platforms);
  try {
    const clip = await db.$transaction(async (tx) => {
      const row = await tx.generatedClip.create({
        data: { jobId: c.jobId, ownerId, candidateId: c.id, start: c.start, end: c.end, title: copy.title, hook: copy.hook, caption: copy.caption, hashtags: copy.hashtags, reframe: json(DEFAULT_REFRAME), subtitle: json(settings.subtitle), status: "approved" },
      });
      await tx.clipCandidate.updateMany({ where: { id: c.id, ownerId }, data: { status: "approved" } });
      return row;
    });
    await event(c.jobId, ownerId, "approved", { candidateId: c.id, start: c.start, end: c.end }, clip.id, actor.id);
    return { clip: clipView(clip), created: true };
  } catch (e) {
    if (!isUnique(e)) throw e;
    const again = await db.generatedClip.findFirst({ where: { candidateId: c.id, ownerId } });
    if (!again) throw e;
    return { clip: clipView(again), created: false };
  }
}

export async function rejectCandidate(ownerId: string, candidateId: string, actor: Actor): Promise<CandidateView> {
  const c = await ownedCandidate(ownerId, candidateId);
  if (c.clip) throw new HttpError(409, "This moment is already a clip. Discard the clip instead.", "HAS_CLIP");
  await db.clipCandidate.updateMany({ where: { id: c.id, ownerId }, data: { status: "rejected" } });
  await event(c.jobId, ownerId, "rejected", { candidateId: c.id }, null, actor.id);
  return candidateView({ ...c, status: "rejected" });
}

const within = (j: { durationSec: number | null }, r: { start: number; end: number }) => {
  if (!Number.isFinite(r.start) || !Number.isFinite(r.end) || r.start < 0 || r.end <= r.start) throw new HttpError(400, "The clip needs a start before its end, both inside the video.", "BAD_RANGE");
  if (j.durationSec && r.end > j.durationSec + 0.5) throw new HttpError(400, "The clip runs past the end of the video.", "BAD_RANGE");
  const d = r.end - r.start;
  if (d < CLIP_MIN_SEC || d > CLIP_MAX_SEC) throw new HttpError(400, `A clip is ${CLIP_MIN_SEC} to ${CLIP_MAX_SEC} seconds long.`, "BAD_LENGTH");
};

/** A clip from a range the creator set by hand (a manual candidate is recorded so the history stays complete). */
export async function createManualClip(ownerId: string, jobId: string, input: { start: number; end: number; title?: string | null }, actor: Actor): Promise<ClipView> {
  const j = await ownedJob(ownerId, jobId);
  if (j.status !== "ready") throw new HttpError(409, "Finish detection first, then add your own clip.", "BAD_TRANSITION");
  within(j, input);
  const settings = parseSettings(j.settings);
  const { words, cues } = await transcriptOf(ownerId, j.id);
  const [scored] = rankCandidates([{ start: input.start, end: input.end, title: input.title ?? undefined, source: "manual" }], { cues, words, settings: { ...settings, minSec: CLIP_MIN_SEC, maxSec: CLIP_MAX_SEC }, hints: await hintsFor(ownerId, settings.platforms) });
  const copy = draftCopy(textOf(words, input), input.title ?? scored?.title, settings.platforms);
  const n = await db.clipCandidate.count({ where: { jobId: j.id, ownerId } });
  const clip = await db.$transaction(async (tx) => {
    const cand = await tx.clipCandidate.create({ data: { jobId: j.id, ownerId, start: input.start, end: input.end, kind: "manual", title: copy.title, reason: scored?.reason ?? "Chosen by hand.", scores: json(scored?.scores ?? {}), score: scored?.score ?? 0, rank: n + 1, source: "manual", status: "approved" } });
    return tx.generatedClip.create({ data: { jobId: j.id, ownerId, candidateId: cand.id, start: input.start, end: input.end, title: copy.title, hook: copy.hook, caption: copy.caption, hashtags: copy.hashtags, reframe: json(DEFAULT_REFRAME), subtitle: json(settings.subtitle), status: "approved" } });
  });
  await event(j.id, ownerId, "manual_clip", { start: input.start, end: input.end }, clip.id, actor.id);
  return clipView(clip);
}

export interface ClipPatch {
  title?: string;
  hook?: string | null;
  caption?: string | null;
  hashtags?: string | null;
  start?: number;
  end?: number;
  reframe?: unknown;
  subtitle?: unknown;
}

/** Edit a clip. A change to its timing, reframe or subtitles makes the render stale (pending again). */
export async function updateClip(ownerId: string, clipId: string, patch: ClipPatch, actor: Actor): Promise<ClipView> {
  const c = await ownedClip(ownerId, clipId);
  if (c.status === "published") throw new HttpError(409, "This clip is published; edit the post instead.", "PUBLISHED");
  if (c.status === "discarded") throw new HttpError(409, "This clip was discarded.", "DISCARDED");
  const j = await ownedJob(ownerId, c.jobId);
  const data: Prisma.GeneratedClipUpdateManyMutationInput = {};
  // R1323 review: a clip with a post keeps its render; cut, frame and subtitles are what the post carries.
  const cut = (patch.start !== undefined && patch.start !== c.start) || (patch.end !== undefined && patch.end !== c.end) || patch.reframe !== undefined || patch.subtitle !== undefined;
  if (c.postId && cut) throw new HttpError(409, "This clip has a post. Its cut, frame and subtitles stay as posted; edit the words here or the post in Create.", "HAS_POST");
  const changed: string[] = [];
  if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== c.title) (data.title = patch.title.trim().slice(0, 80)), changed.push("title");
  for (const k of ["hook", "caption", "hashtags"] as const) {
    if (patch[k] !== undefined && (patch[k] ?? null) !== c[k]) (data[k] = patch[k] === null ? null : patch[k]!.slice(0, k === "caption" ? 2200 : 300)), changed.push(k);
  }
  const range = { start: patch.start ?? c.start, end: patch.end ?? c.end };
  if (range.start !== c.start || range.end !== c.end) {
    within(j, range);
    data.start = Math.round(range.start * 100) / 100;
    data.end = Math.round(range.end * 100) / 100;
    changed.push("range");
  }
  if (patch.reframe !== undefined) {
    const plan = json(reframeOf(patch.reframe));
    if (plan !== c.reframe) (data.reframe = plan), changed.push("reframe");
  }
  if (patch.subtitle !== undefined) {
    const sub = json(settingsOf({ subtitle: patch.subtitle }).subtitle);
    if (sub !== c.subtitle) (data.subtitle = sub), changed.push("subtitle");
  }
  if (!changed.length) return clipView(c);
  const stale = changed.some((k) => k === "range" || k === "reframe" || k === "subtitle");
  if (stale && c.renderStatus !== "pending") Object.assign(data, { renderStatus: "pending", renderError: null, renderedAt: null, mediaId: null });
  const n = await db.generatedClip.updateMany({ where: { id: c.id, ownerId, updatedAt: c.updatedAt }, data });
  if (!n.count) throw new HttpError(409, "The clip just changed under you. Refresh and try again.", "CONFLICT");
  await event(c.jobId, ownerId, "edited", { changed, renderStale: stale }, c.id, actor.id);
  return clipView(await ownedClip(ownerId, clipId));
}

/** The copy drafted again from the clip's current words (after a range edit, or to undo hand edits). */
export async function regenerateCopy(ownerId: string, clipId: string, actor: Actor): Promise<ClipView> {
  const c = await ownedClip(ownerId, clipId);
  if (c.status === "published" || c.status === "discarded") throw new HttpError(409, "This clip can no longer be changed.", "CLOSED");
  const j = await ownedJob(ownerId, c.jobId);
  const { words } = await transcriptOf(ownerId, c.jobId);
  const copy = draftCopy(textOf(words, c), null, parseSettings(j.settings).platforms);
  const n = await db.generatedClip.updateMany({ where: { id: c.id, ownerId, updatedAt: c.updatedAt }, data: { title: copy.title, hook: copy.hook, caption: copy.caption, hashtags: copy.hashtags } });
  if (!n.count) throw new HttpError(409, "The clip just changed under you. Refresh and try again.", "CONFLICT");
  await event(c.jobId, ownerId, "copy_regenerated", null, c.id, actor.id);
  return clipView(await ownedClip(ownerId, clipId));
}

export async function discardClip(ownerId: string, clipId: string, actor: Actor): Promise<ClipView> {
  const c = await ownedClip(ownerId, clipId);
  if (c.status === "published") throw new HttpError(409, "This clip is published; archive the post instead.", "PUBLISHED");
  if (c.postId && c.status !== "discarded") throw new HttpError(409, "This clip has a post. Delete or archive the post first.", "HAS_POST");
  if (c.status !== "discarded") {
    const n = await db.generatedClip.updateMany({ where: { id: c.id, ownerId, status: { notIn: ["published", "discarded"] } }, data: { status: "discarded" } });
    if (!n.count) throw new HttpError(409, "The clip just changed under you. Refresh and try again.", "CONFLICT");
    if (c.candidateId) await db.clipCandidate.updateMany({ where: { id: c.candidateId, ownerId }, data: { status: "rejected" } });
    await event(c.jobId, ownerId, "discarded", null, c.id, actor.id);
  }
  return clipView(await ownedClip(ownerId, clipId));
}

/* ------------------------------------------------------------------ render */

export type RenderReport = { status: "rendering"; executor?: Executor } | { status: "rendered"; mediaId: string; executor?: Executor } | { status: "failed"; error: string; executor?: Executor };

/** The executor reports a render: started, finished with the rendered Media (owned, a video), or failed. */
export async function reportRender(ownerId: string, clipId: string, r: RenderReport, actor: Actor | null): Promise<ClipView> {
  const c = await ownedClip(ownerId, clipId);
  if (c.status === "discarded") throw new HttpError(409, "This clip was discarded.", "DISCARDED");
  if (r.status === "rendering") {
    await db.generatedClip.updateMany({ where: { id: c.id, ownerId }, data: { renderStatus: "rendering", renderError: null } });
  } else if (r.status === "rendered") {
    const m = await ownedMedia(ownerId, r.mediaId);
    if (!m.mimeType.startsWith("video/")) throw new HttpError(400, "The rendered clip must be a video.", "BAD_RENDER");
    if (m.deletedAt) throw new HttpError(400, "That rendered file is in the Trash.", "BAD_RENDER");
    if (m.id === c.mediaId && c.renderStatus === "rendered") return clipView(c);
    const j = await ownedJob(ownerId, c.jobId);
    if (m.id === j.mediaId) throw new HttpError(400, "That is the source video, not a rendered clip.", "BAD_RENDER");
    // Only a render this clip is waiting on counts: after an edit the status is "pending" again, so a report from
    // the render that started before the edit is stale and refused rather than marking old content as current.
    if (c.renderStatus !== "rendering") throw new HttpError(409, "This clip changed since that render started. Render it again.", "STALE_RENDER");
    const other = await db.generatedClip.findFirst({ where: { mediaId: m.id, ownerId, NOT: { id: c.id } }, select: { id: true } });
    if (other) throw new HttpError(409, "That file already belongs to another clip.", "MEDIA_IN_USE");
    const n = await db.generatedClip.updateMany({ where: { id: c.id, ownerId, renderStatus: "rendering", updatedAt: c.updatedAt }, data: { renderStatus: "rendered", renderError: null, renderedAt: new Date(), mediaId: m.id } });
    if (!n.count) throw new HttpError(409, "This clip changed since that render started. Render it again.", "STALE_RENDER");
  } else {
    await db.generatedClip.updateMany({ where: { id: c.id, ownerId }, data: { renderStatus: "failed", renderError: r.error.slice(0, 300) } });
  }
  if (r.executor) await db.clipJob.updateMany({ where: { id: c.jobId, ownerId }, data: { executor: r.executor } });
  await event(c.jobId, ownerId, `render_${r.status}`, r.status === "rendered" ? { mediaId: r.mediaId } : r.status === "failed" ? { error: r.error.slice(0, 300) } : null, c.id, actor?.id ?? null);
  return clipView(await ownedClip(ownerId, clipId));
}

/** A link to the rendered file, or 409 when it is not rendered yet. */
export async function clipDownload(ownerId: string, clipId: string) {
  const c = await ownedClip(ownerId, clipId);
  if (c.renderStatus !== "rendered" || !c.mediaId) throw new HttpError(409, "This clip is not rendered yet.", "NOT_RENDERED");
  const m = await db.media.findFirst({ where: { id: c.mediaId, userId: ownerId } });
  if (!m) throw new HttpError(404, "The rendered file is gone. Render the clip again.", "NO_MEDIA");
  return { clip: clipView(c), media: await mediaView(m) };
}

export async function clipEvents(ownerId: string, clipId: string, limit = 50) {
  const c = await ownedClip(ownerId, clipId);
  const rows = await db.clipEvent.findMany({ where: { clipId: c.id, ownerId }, orderBy: [{ at: "desc" }, { id: "desc" }], take: Math.min(50, Math.max(1, limit)) });
  return rows.map((e) => ({ id: e.id, type: e.type, actorId: e.actorId, data: parse(e.data, null), at: e.at.toISOString() }));
}

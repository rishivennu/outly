import type { CaptionPos, CaptionStyle } from "../captions/cues";
import { PLATFORMS, type Platform } from "../domain";

/**
 * R1321: the Shorts Clipper's limits, settings and job state machine. Pure: every number the API, the executor and
 * the screens agree on lives here, so a limit is never two different values in two files.
 */

/** v1 runs in the browser tab (canvas + MediaRecorder, real-time render): long files are refused until the worker exists. */
export const MAX_SOURCE_SEC = 2 * 3600;
export const MAX_SOURCE_BYTES = 2 * 1024 ** 3;
export const MIN_SOURCE_SEC = 20;
export const CLIP_MIN_SEC = 8;
export const CLIP_MAX_SEC = 90;
export const TARGET_MIN = 1;
export const TARGET_MAX = 10;
export const DEFAULT_TARGET = 5;
/** The detector may propose more than the target so the creator has a choice; never more than this. */
export const CANDIDATES_MAX = 12;
/** A job whose executor has not reported for this long is stalled; the screen offers to resume it. */
export const STALL_MS = 5 * 60_000;
/** Jobs per owner that may be queued or running at once (v1: one tab, one job). */
export const ACTIVE_JOBS_MAX = 2;

export const JOB_STATUSES = ["queued", "running", "ready", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const STAGES = ["transcribe", "detect", "review", "done"] as const;
export type Stage = (typeof STAGES)[number];
export const EXECUTORS = ["browser", "worker"] as const;
export type Executor = (typeof EXECUTORS)[number];
export const CANDIDATE_STATUSES = ["suggested", "approved", "rejected"] as const;
export const CLIP_STATUSES = ["draft", "approved", "published", "discarded"] as const;
export type ClipStatus = (typeof CLIP_STATUSES)[number];
export const RENDER_STATUSES = ["pending", "rendering", "rendered", "failed"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

export const ASPECTS = ["9:16"] as const;
export type Aspect = (typeof ASPECTS)[number];
export const OUT_W = 1080;
export const OUT_H = 1920;

export interface ClipSettings {
  /** How many clips the creator wants (1..10). */
  target: number;
  minSec: number;
  maxSec: number;
  /** Platforms the clips are meant for; decides the length sweet spot and the copy's hashtags line. */
  platforms: Platform[];
  aspect: Aspect;
  subtitle: { style: CaptionStyle; pos: CaptionPos; burn: boolean };
  /** Spoken language hint for transcription ("" = detect). */
  language: string;
}

export const DEFAULT_SETTINGS: ClipSettings = {
  target: DEFAULT_TARGET,
  minSec: 15,
  maxSec: 60,
  platforms: ["instagram", "youtube", "tiktok"],
  aspect: "9:16",
  subtitle: { style: "pop", pos: "bottom", burn: true },
  language: "",
};

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
const STYLES: readonly CaptionStyle[] = ["pop", "box", "clean"];
const POSITIONS: readonly CaptionPos[] = ["bottom", "middle", "top"];

/** Anything posted or stored -> complete, clamped settings. Unknown keys are dropped; a bad value takes the default. */
export function settingsOf(input: unknown): ClipSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const sub = (o.subtitle && typeof o.subtitle === "object" ? o.subtitle : {}) as Record<string, unknown>;
  const minSec = num(o.minSec, CLIP_MIN_SEC, CLIP_MAX_SEC - 2, DEFAULT_SETTINGS.minSec);
  const maxSec = Math.max(minSec + 2, num(o.maxSec, CLIP_MIN_SEC, CLIP_MAX_SEC, DEFAULT_SETTINGS.maxSec));
  const platforms = Array.isArray(o.platforms) ? (o.platforms.filter((p): p is Platform => typeof p === "string" && (PLATFORMS as readonly string[]).includes(p)) as Platform[]) : [];
  return {
    target: num(o.target, TARGET_MIN, TARGET_MAX, DEFAULT_TARGET),
    minSec,
    maxSec: Math.min(CLIP_MAX_SEC, maxSec),
    platforms: platforms.length ? [...new Set(platforms)] : DEFAULT_SETTINGS.platforms,
    aspect: "9:16",
    subtitle: {
      style: STYLES.includes(sub.style as CaptionStyle) ? (sub.style as CaptionStyle) : DEFAULT_SETTINGS.subtitle.style,
      pos: POSITIONS.includes(sub.pos as CaptionPos) ? (sub.pos as CaptionPos) : DEFAULT_SETTINGS.subtitle.pos,
      burn: typeof sub.burn === "boolean" ? sub.burn : true,
    },
    language: typeof o.language === "string" ? o.language.trim().slice(0, 12) : "",
  };
}

export function parseSettings(raw: string | null | undefined): ClipSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return settingsOf(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Why a source cannot be clipped, or null. The same words the upload step shows before any work starts. */
export function sourceProblem(m: { duration?: number | null; sizeBytes?: number | bigint | null; size?: number | null; mimeType?: string | null; status?: string | null }): string | null {
  if (m.mimeType && !m.mimeType.startsWith("video/")) return "The Clipper needs a video. Pick a video file.";
  if (m.status && m.status !== "ready" && m.status !== "uploaded") return "That video is still uploading or failed. Wait for it to finish, or pick another.";
  const bytes = Number(m.sizeBytes ?? m.size ?? 0);
  if (bytes > MAX_SOURCE_BYTES) return `That file is over ${MAX_SOURCE_BYTES / 1024 ** 3} GB. The Clipper takes up to ${MAX_SOURCE_BYTES / 1024 ** 3} GB for now.`;
  const d = m.duration;
  if (typeof d === "number" && d > MAX_SOURCE_SEC) return `That video is over ${MAX_SOURCE_SEC / 3600} hours. The Clipper takes up to ${MAX_SOURCE_SEC / 3600} hours for now.`;
  if (typeof d === "number" && d > 0 && d < MIN_SOURCE_SEC) return `That video is under ${MIN_SOURCE_SEC} seconds: it is already a short. Post it as it is.`;
  return null;
}

/* ------------------------------------------------------------------ state machine */

export type JobEvent = "start" | "transcribed" | "detected" | "reviewed" | "fail" | "cancel" | "retry";

/** The job's next (status, stage) for an event, or null when the event is not allowed from where the job is. */
export function nextState(cur: { status: string; stage: string }, event: JobEvent): { status: JobStatus; stage: Stage } | null {
  const status = cur.status as JobStatus;
  const stage = cur.stage as Stage;
  if (status === "cancelled") return null;
  switch (event) {
    case "start":
      // A second "start" on a running job is a no-op (same state); moveJob leaves progress and error alone for it.
      return status === "queued" || (status === "failed" && stage !== "done") ? { status: "running", stage: stage === "done" ? "review" : stage } : status === "running" ? { status, stage } : null;
    case "transcribed":
      return status === "running" && stage === "transcribe" ? { status: "running", stage: "detect" } : null;
    case "detected":
      return status === "running" && stage === "detect" ? { status: "ready", stage: "review" } : null;
    case "reviewed":
      return status === "ready" && stage === "review" ? { status: "ready", stage: "done" } : null;
    case "fail":
      return status === "running" || status === "queued" ? { status: "failed", stage } : null;
    case "retry":
      return status === "failed" ? { status: "queued", stage } : null;
    case "cancel":
      return status === "queued" || status === "running" || status === "failed" ? { status: "cancelled", stage } : null;
  }
}

export const isActive = (status: string) => status === "queued" || status === "running";
export const isStalled = (j: { status: string; heartbeatAt: Date | string | null; updatedAt: Date | string }, now: number = Date.now()) => {
  if (j.status !== "running") return false;
  const last = j.heartbeatAt ? new Date(j.heartbeatAt).getTime() : new Date(j.updatedAt).getTime();
  return now - last > STALL_MS;
};

/** Overall progress 0..1 across the stages, for one bar. */
export function overallProgress(stage: string, progress: number): number {
  const i = Math.max(0, STAGES.indexOf(stage as Stage));
  const weights = [0.7, 0.25, 0.05, 0];
  const before = weights.slice(0, i).reduce((a, b) => a + b, 0);
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return Math.min(1, Math.round((before + weights[i] * p) * 1000) / 1000);
}

/** What the screen says for a job's state. */
export function stageWords(j: { status: string; stage: string; error?: string | null }): string {
  if (j.status === "cancelled") return "Cancelled";
  if (j.status === "failed") return j.error ? `Stopped: ${j.error}` : "Stopped";
  if (j.status === "queued") return "Waiting to start";
  if (j.status === "ready") return j.stage === "done" ? "Clips reviewed" : "Moments found, ready to review";
  return j.stage === "transcribe" ? "Listening to the video" : j.stage === "detect" ? "Finding the moments" : "Working";
}

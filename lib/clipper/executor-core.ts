import { CLIP_MAX_SEC, CLIP_MIN_SEC, MIN_SOURCE_SEC, OUT_H, OUT_W, isStalled, stageWords } from "./settings-core";

/**
 * R1322: the pure side of the browser executor. What the tab may take on, which screen a job is on, the words the
 * screen says, the file name a render gets. The executor itself (lib/client/clipper.ts) does the browser work.
 */

/** The browser decodes the whole soundtrack in memory, so a tab takes sources up to this long (a worker takes the rest later). */
export const BROWSER_MAX_SEC = 40 * 60;
/** How often the executor reports progress while it works. */
export const HEARTBEAT_MS = 15_000;
/** The soundtrack is decoded from the whole file held in memory, so a tab takes files up to this size (R1322 review #12). */
export const BROWSER_MAX_BYTES = 1.5 * 1024 * 1024 * 1024;
/** The studio re-reads a job's screen this often, so a job that stops reporting turns stalled without a reload. */
export const SCREEN_TICK_MS = 30_000;

/** Why the browser cannot run this source, in the upload step's words; null when it can. */
export function browserProblem(m: { duration?: number | null; mimeType?: string | null; size?: number | null }): string | null {
  if (m.mimeType && !m.mimeType.startsWith("video/")) return "The Clipper needs a video. Pick a video file.";
  if (typeof m.size === "number" && m.size > BROWSER_MAX_BYTES) return `Right now the Clipper runs in your browser and takes files up to ${Math.round(BROWSER_MAX_BYTES / (1024 * 1024 * 1024) * 10) / 10} GB. A smaller export of the same video works.`;
  const d = m.duration;
  if (typeof d === "number" && d > BROWSER_MAX_SEC) return `Right now the Clipper runs in your browser and takes videos up to ${BROWSER_MAX_SEC / 60} minutes. Longer videos will come with the background worker.`;
  if (typeof d === "number" && d > 0 && d < MIN_SOURCE_SEC) return `That video is under ${MIN_SOURCE_SEC} seconds: it is already a short. Post it as it is.`;
  return null;
}

export type Screen = "upload" | "processing" | "stalled" | "failed" | "review" | "done" | "cancelled";

/**
 * Which screen a job belongs on when no run in this tab owns it. A queued job with no tab working on it can never
 * move, so it is stalled from the start (R1322 review #8); a running one is stalled once its heartbeat is old.
 */
export function screenOf(j: { status: string; stage: string; heartbeatAt: string | Date | null; updatedAt: string | Date } | null, now = Date.now()): Screen {
  if (!j) return "upload";
  if (j.status === "cancelled") return "cancelled";
  if (j.status === "failed") return "failed";
  if (j.status === "ready") return j.stage === "done" ? "done" : "review";
  if (j.status === "queued") return "stalled";
  if (j.status === "running" && isStalled(j, now)) return "stalled";
  return "processing";
}

/** The line under the progress bar while the tab works. */
export function workingWords(stage: string, progress: number, parts?: { done: number; total: number }): string {
  if (stage === "transcribe") {
    if (!parts || !parts.total) return progress <= 0 ? "Reading the soundtrack" : "Listening to the video";
    return `Listening: part ${Math.min(parts.total, parts.done + 1)} of ${parts.total}`;
  }
  if (stage === "detect") return "Finding the moments worth a clip";
  return stageWords({ status: "running", stage });
}

/** The words for a job that stopped reporting (the tab closed, the laptop slept). */
export function stalledWords(j: { status?: string; heartbeatAt: string | Date | null; updatedAt: string | Date }, now = Date.now()): string {
  if (j.status === "queued") return "This job was set up but no tab started on it. Resume it here to transcribe the video in this tab.";
  const last = new Date(j.heartbeatAt ?? j.updatedAt).getTime();
  const min = Math.max(1, Math.round((now - last) / 60_000));
  return `This job stopped reporting ${min} minute${min === 1 ? "" : "s"} ago, probably because its tab closed. Resume it here; it starts the current step again.`;
}

/** A safe file name for a rendered clip. */
export function clipFileName(source: string, clip: { title: string; start: number; end: number }, ext = "mp4"): string {
  const base = (source.replace(/\.[^.]+$/, "") || "video").replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "video";
  const slug = clip.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "clip";
  return `${base}-${slug}-${Math.round(clip.start)}s.${ext}`;
}

/** Clamp a trimmed range to the source and the clip limits; the end moves before the start does. */
export function clampRange(r: { start: number; end: number }, duration: number): { start: number; end: number } {
  let start = Math.max(0, Math.min(r.start, duration));
  let end = Math.max(0, Math.min(r.end, duration));
  if (end - start < CLIP_MIN_SEC) end = Math.min(duration, start + CLIP_MIN_SEC);
  if (end - start < CLIP_MIN_SEC) start = Math.max(0, end - CLIP_MIN_SEC);
  if (end - start > CLIP_MAX_SEC) end = start + CLIP_MAX_SEC;
  return { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 };
}

/** "1:05" style time for the timeline. */
export const mmss = (s: number) => {
  const t = Math.max(0, Math.round(s));
  const m = Math.floor(t / 60);
  return `${m}:${String(t % 60).padStart(2, "0")}`;
};

/** Which way the 9:16 crop window can move: across a source wider than 9:16, down a source taller than it. */
export const slideAxis = (w: number, h: number): "x" | "y" => (w / Math.max(1, h) >= OUT_W / OUT_H ? "x" : "y");

/**
 * The CSS that places a <video> of a `size.w` x `size.h` source so that drawFor's source rectangle lands on its
 * destination rectangle, in a preview `k` times smaller than the 1080x1920 output. The same mapping the render uses.
 */
export function previewStyle(size: { w: number; h: number }, d: { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }, k: number): { width: string; height: string; transform: string } {
  const px = (n: number) => `${Math.round(n * 100) / 100}px`;
  return {
    width: px((size.w * d.dw * k) / d.sw),
    height: px((size.h * d.dh * k) / d.sh),
    transform: `translate(${px((d.dx - (d.sx * d.dw) / d.sw) * k)}, ${px((d.dy - (d.sy * d.dh) / d.sh) * k)})`,
  };
}

/** Words (with their own times) that fall inside a clip, re-timed from the clip's start, for burning. */
export function cuesWithin<T extends { start: number; end: number }>(cues: T[], r: { start: number; end: number }): T[] {
  return cues
    .filter((c) => c.end > r.start && c.start < r.end)
    .map((c) => ({ ...c, start: Math.max(0, c.start - r.start), end: Math.min(r.end - r.start, c.end - r.start) }));
}

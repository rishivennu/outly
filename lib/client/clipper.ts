"use client";
import { api, ApiError } from "./api";
import { audioChunks, drawCue, postChunk, readyFont, recorderType, sampleText, type AudioChunk } from "./captions";
import { uploadVideo } from "./upload";
import { runChunks } from "../captions/run";
import { cueAt, type Cue } from "../captions/cues";
import { cleanWords, type Word } from "../captions/subtitle-engine";
import { drawFor } from "../clipper/reframe-core";
import { OUT_H, OUT_W } from "../clipper/settings-core";
import { HEARTBEAT_MS, clipFileName, cuesWithin } from "../clipper/executor-core";
import type { ClipView, JobDetail, JobView } from "../clipper/jobs";

/**
 * R1322: the browser executor. The creator's tab transcribes the source (lib/client/captions.ts chunks, the same
 * /api/ai/transcribe the Caption Studio uses), reports through /api/clipper/jobs/:id/stage, asks the server to
 * detect, and later renders approved clips to a 1080x1920 canvas it records and uploads as Media.
 */

export type Progress = (p: number, parts?: { done: number; total: number }) => void;

const stage = (jobId: string, body: unknown) => api<{ job: JobView }>(`/api/clipper/jobs/${jobId}/stage`, { method: "POST", json: body });

/** Read a file's or URL's duration and size without uploading it. */
export function probeVideo(src: string | File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const out = { duration: Number.isFinite(v.duration) ? v.duration : 0, width: v.videoWidth, height: v.videoHeight };
      if (typeof src !== "string") URL.revokeObjectURL(url);
      res(out);
    };
    v.onerror = () => {
      if (typeof src !== "string") URL.revokeObjectURL(url);
      rej(new Error("Couldn't read that video. Try an MP4 or MOV."));
    };
    v.src = url;
  });
}

/**
 * Transcribe + detect for a job, from the top: start, chunks in parallel (3 at a time, retries inside runChunks),
 * one transcript post, one detect call. Throws ApiError or Error; the caller reports `fail` with the message.
 */
/** R1326: what the detect call said about how the moments were found, for the studio's notice. */
export interface DetectOutcome { detector: "ai" | "rules"; budget: { allowed: boolean; reason: "ok" | "calls" | "money"; line: string } | null }

export async function runJob(job: JobView, src: string | Blob, o: { signal: AbortSignal; onProgress: Progress; lang?: string; onJob?: (j: JobView) => void; onDetect?: (d: DetectOutcome) => void }): Promise<JobDetail> {
  const { job: started } = await stage(job.id, { event: "start", executor: "browser" });
  o.onJob?.(started);
  if (started.stage === "transcribe") {
    o.onProgress(0);
    // Decoding a long soundtrack can take a while and reports nothing by itself, so the job keeps its heartbeat
    // meanwhile (R1322 review #12); otherwise another tab would see it as stalled.
    const beatNow = (progress: number) => stage(job.id, { event: "heartbeat", progress, executor: "browser" }).catch(() => {});
    const decodeBeat = setInterval(() => void beatNow(0), HEARTBEAT_MS);
    let all: AudioChunk[];
    try {
      all = await audioChunks(src, o.signal);
    } finally {
      clearInterval(decodeBeat);
    }
    const talking = all.map((c, i) => [c, i] as const).filter(([c]) => !c.silent);
    if (!talking.length) throw new Error("The video has no sound we could hear, so there is nothing to clip by speech.");
    const words: Word[] = [];
    let language = "";
    let lastBeat = Date.now();
    const beat = async (done: number) => {
      if (Date.now() - lastBeat < HEARTBEAT_MS) return;
      lastBeat = Date.now();
      await beatNow(Math.min(0.99, done / talking.length));
    };
    const run = `clip-${job.id}-${Date.now().toString(36)}`;
    const out = await runChunks(
      talking.map(([, i]) => i),
      (i, signal) => postChunk(all[i] as AudioChunk, { ref: job.mediaId ?? job.id, run, lang: o.lang }, signal),
      {
        signal: o.signal,
        onResult: (_, a) => {
          words.push(...a.words);
          if (!language && a.language) language = a.language;
        },
        onDone: (_, done, total) => {
          o.onProgress(Math.min(0.99, done / total), { done, total });
          void beat(done);
        },
      },
    );
    if (o.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (out.fatal) throw new ApiError(out.fatal.status, out.fatal.message, out.fatal.code);
    if (!out.results.size) throw new ApiError(out.failed[0]?.error.status ?? 502, out.failed[0]?.error.message ?? "Transcription didn't come back.", out.failed[0]?.error.code);
    const clean = cleanWords(words, 0, job.durationSec ?? Infinity);
    const t = await stage(job.id, { event: "transcribed", words: clean, language: language || undefined, engine: out.failed.length ? "browser-chunks-partial" : "browser-chunks", durationSec: job.durationSec ?? undefined });
    o.onJob?.(t.job);
  }
  if (o.signal.aborted) throw new DOMException("Cancelled", "AbortError");
  o.onProgress(1);
  const d = await api<{ job: JobView } & DetectOutcome>(`/api/clipper/jobs/${job.id}/detect`, { method: "POST" });
  o.onJob?.(d.job);
  o.onDetect?.({ detector: d.detector, budget: d.budget ?? null });
  return api<JobDetail>(`/api/clipper/jobs/${job.id}?transcript=1`);
}

/** Tell the server the tab gave up, with the reason the creator sees. */
export const failJob = (jobId: string, error: string) => stage(jobId, { event: "fail", error: error.slice(0, 500) }).catch(() => null);

/* ------------------------------------------------------------------ render */

export interface RenderOpts {
  cues: Cue[] | null;
  style: "pop" | "box" | "clean";
  pos: "bottom" | "middle" | "top";
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
  font?: string;
}

/**
 * One clip to a 1080x1920 MP4: the source plays its range once, each frame is drawn through the reframe plan
 * (crop window or pillarbox over a blurred copy), the clip's lines are burned when asked. Real time: a 30 s clip
 * takes about 30 s. The recorder is the same MP4 recorder the Caption Studio uses.
 */
export async function renderClip(src: string, clip: ClipView, name: string, o: RenderOpts): Promise<File> {
  const type = recorderType();
  if (!type) throw new Error("This browser can't record MP4 video. Use the latest Chrome, Edge or Safari.");
  if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.playsInline = true;
  video.muted = false;
  video.preload = "auto";
  const releaseVideo = () => {
    video.pause();
    video.onended = video.onerror = video.onseeked = video.onstalled = null;
    video.removeAttribute("src");
    video.load();
  };
  try {
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error("Couldn't open the video to render the clip."));
      o.signal?.addEventListener("abort", () => rej(new DOMException("Cancelled", "AbortError")), { once: true });
      video.src = src;
    });
  } catch (e) {
    releaseVideo();
    throw e;
  }
  const w = video.videoWidth || 1920;
  const h = video.videoHeight || 1080;
  const d = drawFor(w, h, clip.reframe);
  const lines = o.cues ? cuesWithin(o.cues, clip) : null;
  // The first burned frame must not fall back to a system font (R1322 review #13).
  if (lines?.length) await readyFont(o.font, sampleText(lines));
  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(30);
  const ac = new AudioContext();
  const cleanup = () => {
    releaseVideo();
    stream.getTracks().forEach((t) => t.stop());
    ac.close().catch(() => {});
  };
  const aborted = () => !!o.signal?.aborted;
  const paint = () => {
    if (d.backdrop) {
      ctx.filter = "blur(36px)";
      const scale = Math.max(OUT_W / w, OUT_H / h);
      ctx.drawImage(video, (OUT_W - w * scale) / 2, (OUT_H - h * scale) / 2, w * scale, h * scale);
      ctx.filter = "none";
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    } else if (d.dw < OUT_W || d.dh < OUT_H) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }
    ctx.drawImage(video, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
    if (lines) {
      const c = cueAt(lines, video.currentTime - clip.start);
      if (c) drawCue(ctx, c.text, OUT_W, OUT_H, o.style, o.pos, { font: o.font });
    }
  };
  const seek = (t: number) =>
    new Promise<void>((res) => {
      video.onseeked = () => res();
      video.currentTime = t;
    });
  const total = clip.end - clip.start;
  const parts: Blob[] = [];
  let rec: MediaRecorder | null = null;
  let stopped: Promise<void> = Promise.resolve();
  let failure: Error | null = null;
  try {
    try {
      const dest = ac.createMediaStreamDestination();
      ac.createMediaElementSource(video).connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch {
      /* silent clip */
    }
    rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 8_000_000 });
    const r = rec;
    r.ondataavailable = (e) => e.data.size && parts.push(e.data);
    stopped = new Promise<void>((res) => (r.onstop = () => res()));
    await ac.resume().catch(() => {});
    await seek(clip.start);
    paint();
    r.start(1000);
    await video.play();
    // The frame loop stops on the clip's end, on Stop (even while the video buffers, when no frame callback would
    // come), on a media error, and when nothing has moved for a long while (R1322 review #14).
    await new Promise<void>((res) => {
      let lastTime = -1;
      let still = 0;
      const finish = () => {
        clearInterval(watch);
        res();
      };
      const watch = setInterval(() => {
        if (aborted()) return finish();
        if (video.currentTime === lastTime) {
          if (++still >= 20) {
            failure = new Error("The video stopped loading while it rendered. Check your connection and try again.");
            return finish();
          }
        } else {
          lastTime = video.currentTime;
          still = 0;
        }
      }, 1000);
      video.onerror = () => {
        failure = new Error("The video could not be played to the end.");
        finish();
      };
      video.onended = () => {
        paint();
        finish();
      };
      const step = () => {
        if (aborted() || video.ended || video.currentTime >= clip.end || failure) return finish();
        paint();
        o.onProgress?.(Math.min(0.99, Math.max(0, video.currentTime - clip.start) / total));
        "requestVideoFrameCallback" in video ? (video as unknown as { requestVideoFrameCallback: (cb: () => void) => void }).requestVideoFrameCallback(step) : requestAnimationFrame(step);
      };
      step();
    });
  } finally {
    if (rec && rec.state !== "inactive") rec.stop();
    if (rec) await stopped;
    cleanup();
  }
  if (aborted()) throw new DOMException("Cancelled", "AbortError");
  if (failure) throw failure;
  o.onProgress?.(1);
  return new File(parts, clipFileName(name, clip, type.ext), { type: type.mime.split(";")[0] });
}

/** Render, upload as Media, report. Returns the clip as the server now has it. */
export async function exportClip(src: string, clip: ClipView, sourceName: string, o: RenderOpts & { onPhase?: (p: "render" | "upload") => void }): Promise<ClipView> {
  await api(`/api/clipper/clips/${clip.id}/render`, { method: "POST", json: { status: "rendering", executor: "browser" } });
  const report = (body: unknown) => api<{ clip: ClipView }>(`/api/clipper/clips/${clip.id}/render`, { method: "POST", json: body });
  try {
    o.onPhase?.("render");
    const file = await renderClip(src, clip, sourceName, o);
    o.onPhase?.("upload");
    const up = await uploadVideo<{ id: string }>(file, (p) => o.onProgress?.(p), o.signal, { resumeKey: `clip:${clip.id}:${clip.updatedAt}` });
    await api(`/api/media/${up.media.id}`, { method: "PATCH", json: { duration: Math.round((clip.end - clip.start) * 100) / 100, width: OUT_W, height: OUT_H } }).catch(() => null);
    try {
      return (await report({ status: "rendered", mediaId: up.media.id, executor: "browser" })).clip;
    } catch (e) {
      // The clip was edited while it rendered: the file is for an older cut, so it goes to the bin (R1322 review #21).
      if (e instanceof ApiError && e.status === 409) await api(`/api/media/${up.media.id}`, { method: "DELETE" }).catch(() => null);
      throw e;
    }
  } catch (e) {
    // Stop is reported too, so the clip never stays "Exporting" (R1322 review #4).
    const stoppedByUser = (e as Error)?.name === "AbortError";
    const error = stoppedByUser ? "Stopped." : (e instanceof ApiError ? e.message : (e as Error)?.message) || "The render stopped.";
    await report({ status: "failed", error: error.slice(0, 500), executor: "browser" }).catch(() => null);
    throw e;
  }
}

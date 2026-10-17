"use client";
/**
 * In-browser caption pipeline. No ffmpeg: audio is decoded with Web Audio and sent in 60 s WAV chunks for
 * transcription; burning-in plays the clip into a canvas, draws the cue on each frame and records the canvas
 * plus the original audio with MediaRecorder as MP4 (Chrome / Edge 126+, Safari).
 */
import { cueAt, wrapLines, type CaptionPos, type CaptionStyle, type Cue } from "@/lib/captions/cues";

const RATE = 16_000;
export const CHUNK_SECONDS = 60;

function wav(samples: Float32Array, rate = RATE): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** Decode the video's soundtrack to 16 kHz mono and cut it into ~60 s WAV chunks. */
export async function audioChunks(src: string | Blob, signal?: AbortSignal): Promise<{ blob: Blob; offset: number; duration: number }[]> {
  const data = typeof src === "string" ? await (await fetch(src, { signal })).arrayBuffer() : await src.arrayBuffer();
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(data);
  } catch {
    throw new Error("This video has no sound track we can read, so there's nothing to transcribe. You can type captions instead.");
  } finally {
    ctx.close().catch(() => {});
  }
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE);
  const node = off.createBufferSource();
  node.buffer = decoded;
  node.connect(off.destination);
  node.start();
  const mono = (await off.startRendering()).getChannelData(0);
  const per = CHUNK_SECONDS * RATE;
  const out: { blob: Blob; offset: number; duration: number }[] = [];
  for (let i = 0; i < mono.length; i += per) {
    const slice = mono.subarray(i, Math.min(mono.length, i + per));
    out.push({ blob: wav(slice), offset: i / RATE, duration: slice.length / RATE });
  }
  return out;
}

/** MP4 only: Reels and the upload checks need MP4, so a WebM-only browser gets the .srt download instead. */
export function recorderType(): { mime: string; ext: "mp4" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const tries: [string, "mp4"][] = [
    ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "mp4"],
    ["video/mp4;codecs=avc1,mp4a", "mp4"],
    ["video/mp4", "mp4"],
  ];
  for (const [mime, ext] of tries) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}

/** Draw one cue on a frame. Shared by the live preview canvas and the recorder. */
export function drawCue(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, style: CaptionStyle, pos: CaptionPos) {
  const size = Math.round(Math.min(w, h) * (style === "pop" ? 0.072 : 0.058));
  ctx.font = `${style === "clean" ? 600 : 800} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const words = style === "pop" ? text.toUpperCase() : text;
  const lines = wrapLines(words, w * 0.84, (s) => ctx.measureText(s).width);
  const lh = size * 1.22;
  const block = lh * lines.length;
  const cy = pos === "top" ? h * 0.16 : pos === "middle" ? h * 0.5 : h * 0.78;
  lines.forEach((line, i) => {
    const y = cy - block / 2 + lh * (i + 0.5);
    if (style === "box") {
      const tw = ctx.measureText(line).width;
      const px = size * 0.45;
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      const x0 = w / 2 - tw / 2 - px;
      const r = size * 0.28;
      ctx.beginPath();
      (ctx as any).roundRect ? (ctx as any).roundRect(x0, y - lh / 2, tw + px * 2, lh, r) : ctx.rect(x0, y - lh / 2, tw + px * 2, lh);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(line, w / 2, y);
    } else {
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, size * (style === "pop" ? 0.18 : 0.1));
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.strokeText(line, w / 2, y);
      ctx.fillStyle = style === "pop" ? "#d9ff3d" : "#fff";
      ctx.fillText(line, w / 2, y);
    }
  });
}

/**
 * Real-time render: the clip plays once (muted to the user) while the canvas records, so a 45 s clip takes ~45 s.
 * Returns a File ready to upload.
 */
export async function burnCaptions(
  src: string,
  cues: Cue[],
  opts: { style: CaptionStyle; pos: CaptionPos; name: string; onProgress?: (p: number) => void; signal?: AbortSignal },
): Promise<File> {
  const type = recorderType();
  if (!type) throw new Error("This browser can't record MP4 video. Use the latest Chrome, Edge or Safari, or download the .srt file instead.");
  const video = document.createElement("video");
  video.src = src;
  video.crossOrigin = "anonymous";
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error("Couldn't open the video to add captions."));
  });
  const w = video.videoWidth || 1080;
  const h = video.videoHeight || 1920;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const stream = canvas.captureStream(30);
  // Route the clip's audio into the recording without playing it through the speakers.
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  try {
    ac.createMediaElementSource(video).connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  } catch {
    /* silent clip: record video only */
  }

  const rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: Math.min(12_000_000, Math.round(w * h * 30 * 0.12)) });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise<void>((res) => (rec.onstop = () => res()));

  let raf = 0;
  const draw = () => {
    ctx.drawImage(video, 0, 0, w, h);
    const c = cueAt(cues, video.currentTime);
    if (c) drawCue(ctx, c.text, w, h, opts.style, opts.pos);
    opts.onProgress?.(Math.min(0.99, video.currentTime / (video.duration || 1)));
    if (!video.ended && !video.paused) raf = "requestVideoFrameCallback" in video ? (video as any).requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
  };

  const cleanup = () => {
    cancelAnimationFrame(raf);
    video.pause();
    stream.getTracks().forEach((t) => t.stop());
    ac.close().catch(() => {});
  };
  opts.signal?.addEventListener("abort", () => {
    if (rec.state !== "inactive") rec.stop();
    cleanup();
  });

  await ac.resume().catch(() => {});
  video.currentTime = 0;
  rec.start(1000);
  await video.play();
  draw();
  await new Promise<void>((res) => {
    video.onended = () => res();
    opts.signal?.addEventListener("abort", () => res());
  });
  ctx.drawImage(video, 0, 0, w, h);
  if (rec.state !== "inactive") rec.stop();
  await stopped;
  cleanup();
  if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  opts.onProgress?.(1);
  const base = opts.name.replace(/\.[^.]+$/, "") || "video";
  return new File(parts, `${base}-captions.${type.ext}`, { type: type.mime.split(";")[0] });
}

/**
 * Cut by ranges (FunClip's "clip by text" output): plays only the kept ranges in order and records them into
 * one MP4, captions burned in when `cues` is given. The recorder pauses during each seek so no frozen frames
 * are kept. Real time: a 20 s cut takes about 20 s.
 */
export async function cutClips(
  src: string,
  ranges: { start: number; end: number }[],
  opts: { cues?: Cue[]; style: CaptionStyle; pos: CaptionPos; name: string; onProgress?: (p: number) => void; signal?: AbortSignal },
): Promise<File> {
  const type = recorderType();
  if (!type) throw new Error("This browser can't record MP4 video. Use the latest Chrome, Edge or Safari.");
  const keep = [...ranges].filter((r) => r.end - r.start > 0.1).sort((a, b) => a.start - b.start);
  if (!keep.length) throw new Error("Pick at least one part of the video to keep.");
  const total = keep.reduce((t, r) => t + r.end - r.start, 0);

  const video = document.createElement("video");
  video.src = src;
  video.crossOrigin = "anonymous";
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error("Couldn't open the video to cut it."));
  });
  const w = video.videoWidth || 1080;
  const h = video.videoHeight || 1920;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(30);
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  try {
    ac.createMediaElementSource(video).connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  } catch {
    /* silent clip */
  }
  const rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: Math.min(12_000_000, Math.round(w * h * 30 * 0.12)) });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise<void>((res) => (rec.onstop = () => res()));
  const cleanup = () => {
    video.pause();
    stream.getTracks().forEach((t) => t.stop());
    ac.close().catch(() => {});
  };
  const aborted = () => !!opts.signal?.aborted;
  const paint = () => {
    ctx.drawImage(video, 0, 0, w, h);
    const c = opts.cues ? cueAt(opts.cues, video.currentTime) : null;
    if (c) drawCue(ctx, c.text, w, h, opts.style, opts.pos);
  };
  const seek = (t: number) =>
    new Promise<void>((res) => {
      video.onseeked = () => res();
      video.currentTime = t;
    });

  await ac.resume().catch(() => {});
  let done = 0;
  let started = false;
  try {
    for (let i = 0; i < keep.length && !aborted(); i++) {
      const r = keep[i];
      await seek(r.start);
      paint();
      if (!started) {
        rec.start(1000);
        started = true;
      } else rec.resume();
      await video.play();
      await new Promise<void>((res) => {
        const step = () => {
          paint();
          opts.onProgress?.(Math.min(0.99, (done + Math.max(0, video.currentTime - r.start)) / total));
          if (aborted() || video.ended || video.currentTime >= r.end) return res();
          "requestVideoFrameCallback" in video ? (video as any).requestVideoFrameCallback(step) : requestAnimationFrame(step);
        };
        step();
      });
      video.pause();
      if (rec.state === "recording") rec.pause();
      done += r.end - r.start;
    }
  } finally {
    if (started && rec.state !== "inactive") rec.stop();
    if (started) await stopped;
    cleanup();
  }
  if (aborted()) throw new DOMException("Cancelled", "AbortError");
  opts.onProgress?.(1);
  const base = opts.name.replace(/\.[^.]+$/, "") || "video";
  return new File(parts, `${base}-cut.${type.ext}`, { type: type.mime.split(";")[0] });
}

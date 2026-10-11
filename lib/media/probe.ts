import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { env } from "../env";

const run = promisify(execFile);

export const ALLOWED_VIDEO_MIME = ["video/mp4", "video/quicktime"] as const;
export const ALLOWED_EXT = [".mp4", ".mov"] as const;

/** Magic-byte check: MP4/MOV both carry an ISO-BMFF 'ftyp' (or legacy 'moov'/'mdat'/'wide') box at offset 4. */
export function looksLikeIsoBmff(head: Uint8Array) {
  if (head.length < 12) return false;
  const box = String.fromCharCode(head[4], head[5], head[6], head[7]);
  return ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(box);
}

async function which(bin: string, explicit: string) {
  if (explicit && existsSync(explicit)) return explicit;
  try {
    await run(bin, ["-version"], { timeout: 4000, windowsHide: true });
    return bin;
  } catch {
    return null;
  }
}

let cached: { ffmpeg: string | null; ffprobe: string | null } | null = null;
export async function ffmpegTools() {
  if (!cached) cached = { ffmpeg: await which("ffmpeg", env.FFMPEG_PATH), ffprobe: await which("ffprobe", env.FFPROBE_PATH) };
  return cached;
}

export interface ProbeResult {
  duration?: number;
  width?: number;
  height?: number;
  codec?: string;
}

export async function probe(path: string): Promise<ProbeResult | null> {
  const { ffprobe } = await ffmpegTools();
  if (!ffprobe) return null;
  const { stdout } = await run(
    ffprobe,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name:format=duration", "-of", "json", path],
    { timeout: 30_000, windowsHide: true },
  );
  const j = JSON.parse(stdout);
  const s = j.streams?.[0] ?? {};
  return { duration: Number(j.format?.duration) || undefined, width: s.width, height: s.height, codec: s.codec_name };
}

export async function thumbnail(input: string, output: string, atSec = 1): Promise<boolean> {
  const { ffmpeg } = await ffmpegTools();
  if (!ffmpeg) return false;
  await run(ffmpeg, ["-y", "-ss", String(atSec), "-i", input, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "3", output], {
    timeout: 60_000,
    windowsHide: true,
  });
  return true;
}

"use client";
import { api, ApiError } from "./api";
import { FEED_MAX_RATIO, FEED_MIN_RATIO } from "@/lib/formats";
import type { MediaView } from "@/lib/services";

/**
 * 1131: photos for Instagram. Instagram takes only JPEGs (8 MB, 320 to 1440 px wide), and feed photos must sit
 * between 4:5 and 1.91:1. The browser does that work, so the server never needs an image library: decode,
 * crop into range (feed), scale down, encode as JPEG, then send the bytes to /api/media/image.
 */
export type Fit = "feed" | "story";

/** Pictures the browser can read. HEIC only opens in Safari, so it is tried and explained if it fails. */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";
/** Above this a phone photo is suspicious (and slow to decode); 40 MB covers any real camera JPEG or PNG. */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
/** The upload route's cap (under Vercel's 4.5 MB request limit). */
const MAX_SEND = 4 * 1024 * 1024 - 64 * 1024;

export const looksLikePhoto = (f: { type: string; name: string }) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);

/** The centre crop that brings a picture into Instagram's range for this fit. Story pictures are never cropped. */
export function cropBox(w: number, h: number, fit: Fit) {
  if (fit === "story" || !w || !h) return { x: 0, y: 0, w, h };
  const r = w / h;
  if (r < FEED_MIN_RATIO) {
    const ch = Math.round(w / FEED_MIN_RATIO);
    return { x: 0, y: Math.round((h - ch) / 2), w, h: ch };
  }
  if (r > FEED_MAX_RATIO) {
    const cw = Math.round(h * FEED_MAX_RATIO);
    return { x: Math.round((w - cw) / 2), y: 0, w: cw, h };
  }
  return { x: 0, y: 0, w, h };
}

/** Output size: never upscaled, at most 1440 wide for the feed and 1080 wide for a Story (Instagram's own sizes). */
export function outSize(w: number, h: number, fit: Fit) {
  const max = fit === "story" ? 1080 : 1440;
  const s = Math.min(1, max / w, (fit === "story" ? 1920 : 1800) / h);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

async function decode(file: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const b = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { src: b, w: b.width, h: b.height, close: () => b.close() };
    } catch {
      /* fall through to <img>, which some browsers decode more formats with (Safari HEIC) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ApiError(415, "This browser can't open that photo. Save it as a JPEG or PNG and try again.");
  }
}

const encode = (c: HTMLCanvasElement, q: number) => new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", q));

/** The picture as an Instagram-ready JPEG, with its final size. */
export async function makeJpeg(file: Blob, fit: Fit): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.size > MAX_SOURCE_BYTES) throw new ApiError(413, "That photo is over 40 MB. Pick a smaller one.");
  const img = await decode(file);
  try {
    const box = cropBox(img.w, img.h, fit);
    const out = outSize(box.w, box.h, fit);
    const c = document.createElement("canvas");
    c.width = out.w;
    c.height = out.h;
    const g = c.getContext("2d");
    if (!g) throw new ApiError(500, "This browser couldn't prepare the photo.");
    g.fillStyle = "#fff"; // a transparent PNG gets white behind it, not black
    g.fillRect(0, 0, out.w, out.h);
    g.imageSmoothingQuality = "high";
    g.drawImage(img.src, box.x, box.y, box.w, box.h, 0, 0, out.w, out.h);
    for (const q of [0.9, 0.82, 0.72, 0.6]) {
      const blob = await encode(c, q);
      if (blob && blob.size <= MAX_SEND) return { blob, width: out.w, height: out.h };
    }
    throw new ApiError(413, "That photo stays too big even after shrinking it. Try a simpler one.");
  } finally {
    img.close();
  }
}

/** Convert, then store. Resolves with the stored media (ready to post). */
export async function uploadPhoto(file: File, fit: Fit, signal?: AbortSignal): Promise<{ media: MediaView; width: number; height: number; preview: string }> {
  const { blob, width, height } = await makeJpeg(file, fit);
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  const r = await api<{ media: MediaView }>(`/api/media/image?name=${encodeURIComponent(name.slice(0, 180))}`, { method: "POST", body: blob, headers: { "content-type": "image/jpeg" }, signal });
  return { media: r.media, width, height, preview: URL.createObjectURL(blob) };
}

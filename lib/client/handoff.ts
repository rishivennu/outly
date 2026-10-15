"use client";
/** Hands a dropped file from Home to the Create workspace without waiting for the upload. */
let pending: { file: File; objectUrl: string } | null = null;

export function handoffFile(file: File) {
  if (pending) URL.revokeObjectURL(pending.objectUrl);
  pending = { file, objectUrl: URL.createObjectURL(file) };
}
export function takeHandoff() {
  const p = pending;
  pending = null;
  return p;
}

/** Mirrors MAX_UPLOAD_MB (Supabase Free caps one object at 50 MB). The server enforces it either way. */
export const MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB) || 50;
export function validateVideoFile(f: File): string | null {
  const okType = ["video/mp4", "video/quicktime"].includes(f.type) || /\.(mp4|mov)$/i.test(f.name);
  if (!okType) return "That one isn't a video we can use yet. Try an MP4 or MOV.";
  if (f.size > MAX_MB * 1024 * 1024) return `That's a big one. Keep it under ${MAX_MB} MB.`;
  return null;
}

/** A video shared to Outlly from the phone's share sheet, kept by the service worker (public/sw.js). Read once. */
export async function takeSharedFile(): Promise<File | null> {
  if (typeof caches === "undefined") return null;
  try {
    const c = await caches.open("outly-share");
    const res = await c.match("/__shared-media");
    if (!res) return null;
    await c.delete("/__shared-media");
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get("x-name") ?? "shared-video.mp4");
    return new File([blob], name, { type: res.headers.get("content-type") || blob.type || "video/mp4" });
  } catch {
    return null;
  }
}

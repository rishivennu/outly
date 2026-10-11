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

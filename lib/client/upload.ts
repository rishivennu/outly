"use client";

import { api, ApiError, uploadWithProgress } from "./api";

/**
 * Uploads a video the best way the server supports:
 *  - Supabase: straight from the browser to the private bucket using a one-time signed token.
 *    Files over one chunk use TUS resumable upload (6 MB chunks), so a dropped connection or a reload
 *    resumes from the last chunk instead of starting over.
 *  - Otherwise: streamed through POST /api/media.
 * Progress reports fraction (0-1) and an ETA in seconds once there's enough signal.
 */
export type UploadProgress = (fraction: number, etaSec: number | null) => void;
export interface UploadedMedia<M> { media: M }

interface DirectInit {
  mediaId: string;
  key: string;
  bucket: string;
  token: string;
  uploadUrl: string;
  resumableUrl: string;
  chunkSize: number;
}
interface Saved extends DirectInit { location?: string; at: number }

const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const fp = (f: File) => `outly-up:${f.name}:${f.size}:${f.lastModified}`;
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

function eta() {
  const pts: { t: number; b: number }[] = [];
  return (bytes: number, total: number) => {
    const t = performance.now();
    pts.push({ t, b: bytes });
    while (pts.length > 2 && t - pts[0].t > 8000) pts.shift();
    const a = pts[0];
    const dt = (t - a.t) / 1000;
    if (dt < 1.2 || bytes <= a.b) return null;
    return Math.max(0, Math.round((total - bytes) / ((bytes - a.b) / dt)));
  };
}

function xhr(method: string, url: string, body: Blob | null, headers: Record<string, string>, onUp: (loaded: number) => void, signal?: AbortSignal) {
  return new Promise<XMLHttpRequest>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => onUp(e.loaded);
    x.onload = () => resolve(x);
    x.onerror = () => reject(new ApiError(0, "We lost the connection. We'll pick up where we left off."));
    x.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => x.abort(), { once: true });
    x.send(body);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadVideo<M>(file: File, onProgress: UploadProgress, signal?: AbortSignal): Promise<UploadedMedia<M>> {
  const cfg = await api<{ direct: boolean; maxBytes: number }>("/api/media/direct");
  if (file.size > cfg.maxBytes) throw new ApiError(413, `That's a big one. Keep it under ${Math.round(cfg.maxBytes / 1048576)} MB for now.`, "TOO_LARGE");
  if (!cfg.direct) return uploadWithProgress<UploadedMedia<M>>(`/api/media?name=${encodeURIComponent(file.name)}`, file, (p) => onProgress(p, null), signal);

  const est = eta();
  const report = (bytes: number) => onProgress(Math.min(0.999, bytes / file.size), est(bytes, file.size));

  // Resume a recent unfinished upload of this exact file.
  let saved: Saved | null = null;
  try {
    const raw = localStorage.getItem(fp(file));
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (Date.now() - s.at < 100 * 60_000) saved = s; // signed tokens live ~2h
    }
  } catch {}
  const init: Saved = saved ?? {
    ...(await api<DirectInit>("/api/media/direct", { method: "POST", json: { name: file.name, type: file.type, size: file.size }, signal })),
    at: Date.now(),
  };
  const remember = () => {
    try {
      localStorage.setItem(fp(file), JSON.stringify(init));
    } catch {}
  };
  remember();

  const auth = { apikey: ANON, "x-signature": init.token, "Tus-Resumable": "1.0.0" };

  if (file.size <= init.chunkSize && !init.location) {
    const r = await xhr("PUT", init.uploadUrl, file, { "content-type": file.type || "video/mp4", "x-upsert": "true" }, report, signal);
    if (r.status >= 300) throw new ApiError(r.status, uploadError(r));
  } else {
    if (!init.location) {
      const r = await xhr("POST", init.resumableUrl, null, {
        ...auth,
        "Upload-Length": String(file.size),
        "Upload-Metadata": [`bucketName ${b64(init.bucket)}`, `objectName ${b64(init.key)}`, `contentType ${b64(file.type || "video/mp4")}`, `cacheControl ${b64("3600")}`].join(","),
        "x-upsert": "true",
      }, () => {}, signal);
      const loc = r.getResponseHeader("Location");
      if (r.status !== 201 || !loc) throw new ApiError(r.status, uploadError(r));
      init.location = loc;
      remember();
    }
    // Where does the server think we are?
    let offset = 0;
    const head = await xhr("HEAD", init.location, null, auth, () => {}, signal);
    if (head.status === 200) offset = Number(head.getResponseHeader("Upload-Offset") ?? 0);
    else if (head.status === 404 || head.status === 410) {
      localStorage.removeItem(fp(file));
      throw new ApiError(410, "That upload expired. Drop the video again and we'll start fresh.");
    }
    report(offset);
    let tries = 0;
    while (offset < file.size) {
      const chunk = file.slice(offset, Math.min(file.size, offset + init.chunkSize));
      try {
        const r = await xhr("PATCH", init.location, chunk, { ...auth, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" }, (l) => report(offset + l), signal);
        if (r.status === 409) {
          // Offset drifted (e.g. a chunk landed but the response was lost); ask the server.
          const h = await xhr("HEAD", init.location, null, auth, () => {}, signal);
          offset = Number(h.getResponseHeader("Upload-Offset") ?? offset);
          continue;
        }
        if (r.status !== 204) throw new ApiError(r.status, uploadError(r));
        offset = Number(r.getResponseHeader("Upload-Offset") ?? offset + chunk.size);
        tries = 0;
      } catch (e) {
        if ((e as Error).name === "AbortError" || signal?.aborted) throw e;
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 409) throw e;
        if (++tries > 4) throw e;
        await sleep(800 * 2 ** tries);
        const h = await xhr("HEAD", init.location, null, auth, () => {}, signal).catch(() => null);
        if (h?.status === 200) offset = Number(h.getResponseHeader("Upload-Offset") ?? offset);
      }
    }
  }

  const done = await api<UploadedMedia<M>>("/api/media/direct/complete", { method: "POST", json: { mediaId: init.mediaId }, signal });
  localStorage.removeItem(fp(file));
  onProgress(1, 0);
  return done;
}

function uploadError(r: XMLHttpRequest) {
  try {
    const j = JSON.parse(r.responseText);
    if (r.status === 413 || j.statusCode === "413") return "That file is bigger than your storage plan allows.";
    return j.message ?? j.error ?? "The upload didn't go through.";
  } catch {
    return r.status === 413 ? "That file is bigger than your storage plan allows." : "The upload didn't go through.";
  }
}

"use client";

import { api, ApiError, uploadWithProgress } from "./api";

/**
 * Uploads a video the best way the server supports:
 *  - Supabase: straight from the browser to the private bucket using a one-time signed token.
 *    Files over one chunk use TUS resumable upload (6 MB chunks), so a dropped connection or a reload
 *    resumes from the last chunk instead of starting over.
 *  - R2 / S3: one presigned PUT for small files; above one part, S3 multipart with presigned part
 *    URLs, 4 parts in flight, each retried on its own. A reload resumes: the server lists the parts
 *    the bucket already has and only the rest are sent.
 *  - Otherwise: streamed through POST /api/media.
 * Progress reports fraction (0-1) and an ETA in seconds once there's enough signal.
 */
export type UploadProgress = (fraction: number, etaSec: number | null) => void;
export interface UploadedMedia<M> { media: M }

interface DirectInit {
  mediaId: string;
  key: string;
  /** absent on uploads saved by an older build = Supabase TUS */
  mode?: "tus" | "put" | "multipart";
  contentType?: string;
  bucket: string;
  token: string;
  uploadUrl: string;
  resumableUrl: string;
  chunkSize: number;
  uploadId?: string;
  partSize?: number;
  parts?: number;
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
    // A connection that goes quiet never errors on its own; treat 60 s with no bytes moving as a drop
    // so the caller's retry (and TUS/multipart resume) kicks in instead of hanging forever.
    let last = Date.now();
    let stalled = false;
    const dog = setInterval(() => {
      if (Date.now() - last > STALL_MS) {
        stalled = true;
        x.abort();
      }
    }, 5_000);
    const done = () => clearInterval(dog);
    x.upload.onprogress = (e) => {
      last = Date.now();
      onUp(e.loaded);
    };
    x.onprogress = () => (last = Date.now());
    x.onload = () => (done(), resolve(x));
    x.onerror = () => (done(), reject(new ApiError(0, "We lost the connection. We'll pick up where we left off.")));
    x.onabort = () => (done(), reject(stalled ? new ApiError(0, "The upload stalled. Check your connection and try again.") : new DOMException("Aborted", "AbortError")));
    signal?.addEventListener("abort", () => x.abort(), { once: true });
    x.send(body);
  });
}

const STALL_MS = 60_000;
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
      // Supabase tokens live ~2h; an R2 presigned PUT only 1h and cannot be re-signed, so start fresh sooner.
      if (Date.now() - s.at < (s.mode === "put" ? 50 : 100) * 60_000) saved = s;
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

  if (init.mode === "put" || init.mode === "multipart") {
    await (init.mode === "put" ? putWhole(file, init, report, signal) : multipart(file, init, report, signal, !!saved));
    const done = await api<UploadedMedia<M>>("/api/media/direct/complete", { method: "POST", json: { mediaId: init.mediaId, uploadId: init.uploadId }, signal });
    localStorage.removeItem(fp(file));
    onProgress(1, 0);
    return done;
  }

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

const retryable = (e: unknown, signal?: AbortSignal) =>
  !((e as Error).name === "AbortError" || signal?.aborted || (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 403 && e.status !== 408 && e.status !== 429));

/** R2/S3, small file: one presigned PUT. */
async function putWhole(file: File, init: DirectInit, report: (b: number) => void, signal?: AbortSignal) {
  for (let tries = 0; ; tries++) {
    try {
      const r = await xhr("PUT", init.uploadUrl, file, { "content-type": init.contentType || file.type || "video/mp4" }, report, signal);
      if (r.status >= 300) throw new ApiError(r.status, s3Error(r));
      return;
    } catch (e) {
      if (!retryable(e, signal) || tries >= 3) throw e;
      await sleep(800 * 2 ** tries);
    }
  }
}

/** R2/S3, big file: presigned multipart, a few parts in parallel, resumable across reloads. */
async function multipart(file: File, init: DirectInit, report: (b: number) => void, signal: AbortSignal | undefined, resuming: boolean) {
  const size = init.partSize!;
  const total = Math.ceil(file.size / size);
  const bytes = (n: number) => (n < total ? size : file.size - size * (total - 1));
  const done = new Set<number>();
  const urls = new Map<number, string>();
  const inFlight = new Map<number, number>();
  const progress = () => {
    let b = 0;
    for (const n of done) b += bytes(n);
    for (const v of inFlight.values()) b += v;
    report(b);
  };
  type Signed = { urls: Record<string, string>; uploaded?: { n: number; size: number }[] };
  const sign = async (nums: number[], list = false) => {
    const r = await api<Signed>("/api/media/direct/parts", { method: "POST", json: { mediaId: init.mediaId, uploadId: init.uploadId, parts: nums, list }, signal });
    for (const [k, v] of Object.entries(r.urls)) urls.set(Number(k), v);
    for (const p of r.uploaded ?? []) if (p.size === bytes(p.n)) done.add(p.n);
  };
  if (resuming) await sign([], true).catch((e) => {
    if (e instanceof ApiError && e.status === 410) localStorage.removeItem(`outly-up:${file.name}:${file.size}:${file.lastModified}`);
    throw e;
  });
  progress();
  const queue = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !done.has(n));
  let next = 0;
  let signing: Promise<void> | null = null;
  const urlFor = async (n: number) => {
    while (!urls.has(n)) {
      if (!signing) {
        const batch = queue.slice(queue.indexOf(n), queue.indexOf(n) + 12).filter((m) => !urls.has(m) && !done.has(m));
        signing = sign(batch.length ? batch : [n]).finally(() => (signing = null));
      }
      await signing;
    }
    return urls.get(n)!;
  };
  const worker = async () => {
    while (next < queue.length) {
      const n = queue[next++];
      for (let tries = 0; ; tries++) {
        try {
          const url = await urlFor(n);
          const r = await xhr("PUT", url, file.slice((n - 1) * size, (n - 1) * size + bytes(n)), {}, (l) => (inFlight.set(n, l), progress()), signal);
          if (r.status === 403) urls.delete(n); // URL expired (or clock skew): sign again
          if (r.status >= 300) throw new ApiError(r.status, s3Error(r));
          inFlight.delete(n);
          done.add(n);
          progress();
          break;
        } catch (e) {
          inFlight.delete(n);
          if (!retryable(e, signal) || tries >= 4) throw e;
          await sleep(800 * 2 ** tries);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
}

function s3Error(r: XMLHttpRequest) {
  if (r.status === 403) return "The upload link expired. Try again and we'll pick up where we left off.";
  const m = /<Message>([^<]*)<\/Message>/.exec(r.responseText || "");
  return m?.[1] || "The upload didn't go through.";
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

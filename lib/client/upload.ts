"use client";

import { useEffect, useState } from "react";
import { refusal } from "@/lib/storage/quota-core";
import type { QuotaView } from "@/components/billing/QuotaCard";
import { api, ApiError, cachedApi, offerUpgrade, uploadWithProgress } from "./api";
import { track } from "@/lib/analytics/track";

/**
 * Uploads a video the best way the server supports:
 *  - Supabase: straight from the browser to the private bucket using a one-time signed token.
 *    Files over one chunk use TUS resumable upload (6 MB chunks), so a dropped connection or a reload
 *    resumes from the last chunk instead of starting over.
 *  - R2 / S3: one presigned PUT for small files; above one part, S3 multipart with presigned part URLs.
 *    R1193: 16 MB parts (grown for a file that would need more than 10,000), up to 6 in flight on a desktop
 *    (fewer on phones and slow connections) and adapted to what the connection sustains, each retried on its own
 *    with jittered backoff. A link lasts 15 minutes and is signed again as it runs out. A reload or a dropped
 *    connection resumes: the server lists the parts the bucket already has (for the very same file, checked by
 *    fingerprint) and only the rest are sent.
 *  - Otherwise: streamed through POST /api/media.
 * Progress reports fraction (0-1), an ETA in seconds once there's enough signal and, for direct uploads, an
 * UploadInfo: the phase, bytes, speed and parts behind "750 MB of 1 GB, 18 MB/s, part 47 of 63".
 */
export type UploadPhase = "preparing" | "uploading" | "reconnecting" | "resuming" | "finalizing" | "processing";
export interface UploadInfo {
  phase: UploadPhase;
  bytes: number;
  total: number;
  /** Bytes a second over the last few seconds. Null until there's enough signal, and whenever nothing is moving. */
  speed: number | null;
  partsDone: number;
  partsTotal: number;
  /** Parts (or TUS chunks) on the wire right now. */
  active: number;
}
export type UploadProgress = (fraction: number, etaSec: number | null, info?: UploadInfo) => void;
export interface UploadedMedia<M> { media: M }

/** What GET /api/media/direct says about this account's uploads. */
export interface UploadLimits {
  direct: boolean;
  maxBytes: number;
  maxMb?: number;
  planLimited?: boolean;
  planName?: string;
  /** R1209: the limit that binds. `kind` "monthly" is the upload allowance (Free), "storage" what may be kept. */
  storage?: { usedBytes?: number; limitBytes: number; remainingBytes: number; over: boolean; label: string; kind?: "monthly" | "storage" };
  /** R1209: both figures, the warning state and the renewal date (GET /api/storage/usage). Missing on an older server. */
  quota?: QuotaView;
  /** Missing on a server older than Phase 2: MP4 and MOV were the only formats then too. */
  formats?: { extensions: string[]; mimeTypes: string[]; label: string };
}

const LIMITS_URL = "/api/media/direct";
const FALLBACK_FORMATS = { extensions: [".mp4", ".mov"], mimeTypes: ["video/mp4", "video/quicktime"], label: "MP4 or MOV" };

/** One request shared by the limits line on the drop zone and the upload that follows it. Any POST forgets it. */
export const loadUploadLimits = () => cachedApi<UploadLimits>(LIMITS_URL, 30_000);

export const formatBytes = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1).replace(/\.0$/, "")} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`);

export const acceptedFormats = (lim: UploadLimits | null | undefined) => lim?.formats ?? FALLBACK_FORMATS;

/** The value for a file input's accept attribute, from the server's list (MP4 and MOV until it answers). */
export const acceptAttr = (lim: UploadLimits | null | undefined) => {
  const f = acceptedFormats(lim);
  return [...f.mimeTypes, ...f.extensions].join(",");
};

/** Only the format half of limitsProblem: the size and storage checks wait for the upload, which has the plan's numbers. */
export function formatProblem(file: { name: string; type: string }, lim: UploadLimits | null | undefined): string | null {
  const f = acceptedFormats(lim);
  const ext = /\.[^.]+$/.exec(file.name)?.[0]?.toLowerCase() ?? "";
  const ok = (!!file.type && f.mimeTypes.includes(file.type)) || f.extensions.includes(ext);
  return ok ? null : `That one isn't a video we can use yet. Try an ${f.label}.`;
}

/** The shared limits request as React state. Null while loading or when it failed (callers fall back to MP4 or MOV). */
export function useUploadLimits(enabled = true): UploadLimits | null {
  const [lim, setLim] = useState<UploadLimits | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadUploadLimits().then(
      (l) => alive && setLim(l),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [enabled]);
  return lim;
}

/** "MP4 or MOV, up to 500 MB per file" plus the storage that is left when the plan has a cap. */
export function limitsLine(lim: UploadLimits) {
  const f = acceptedFormats(lim);
  const mb = lim.maxMb ?? Math.round(lim.maxBytes / 1048576);
  const size = `${f.label}, up to ${mb >= 1024 ? formatBytes(mb * 1048576) : `${mb} MB`} per file`;
  const st = lim.storage;
  if (!st || st.limitBytes <= 0) return size;
  if (st.kind === "monthly") return st.over ? `${size}. This month's uploads are used up.` : `${size}. ${formatBytes(st.remainingBytes)} of this month's uploads left.`;
  return st.over ? `${size}. Storage is full (${st.label}).` : `${size}. ${formatBytes(st.remainingBytes)} of storage left.`;
}

/**
 * Why this file can't go up, checked against the server's own limits before a byte moves. Null = fine.
 * "storage", "monthly" and "upload" are plan limits, so the caller can offer a bigger plan. The server checks again.
 */
export type LimitProblem = { kind: "type" | "storage" | "monthly" | "upload" | "size"; message: string };

/** R1209: which upgrade the popup sells for a refused pick, or null when a bigger plan would not help. */
export const upgradeFor = (k: LimitProblem["kind"]) => (k === "monthly" ? "uploads" : k === "storage" || k === "upload" ? k : null);
export function limitsProblem(file: { name: string; type: string; size: number }, lim: UploadLimits): LimitProblem | null {
  const f = acceptedFormats(lim);
  const ext = /\.[^.]+$/.exec(file.name)?.[0]?.toLowerCase() ?? "";
  const typeOk = (!!file.type && f.mimeTypes.includes(file.type)) || f.extensions.includes(ext);
  if (!typeOk) return { kind: "type", message: `That one isn't a video we can use yet. Try an ${f.label}.` };
  const st = lim.storage;
  const plan = lim.planName ?? "Your plan";
  // R1209: on Free the limit that binds is the monthly upload allowance. A delete never gives it back, so the way out
  // is the renewal date or a bigger plan, in the server's own words (quota-core refusal).
  if (st && st.kind === "monthly" && st.limitBytes > 0 && (st.over || file.size > st.remainingBytes)) {
    const m = lim.quota?.monthly;
    const room = st.over ? 0 : st.remainingBytes;
    return {
      kind: "monthly",
      message: m
        ? refusal("quota_monthly", file.size, { ...m, remainingBytes: room }, null, plan)
        : room < 1
          ? `You've used this month's upload allowance on ${plan}. Upgrade your plan to upload more now.`
          : `This file is ${formatBytes(file.size)} and you have ${formatBytes(room)} of this month's uploads left. Upgrade to upload more now.`,
    };
  }
  if (st && st.limitBytes > 0 && st.over) return { kind: "storage", message: `${plan} storage is full (${st.label}), so new uploads are paused. Your files are safe. Delete some, or upgrade for more room.` };
  if (st && st.limitBytes > 0 && file.size > st.remainingBytes)
    return { kind: "storage", message: `This file needs ${formatBytes(file.size)} and ${plan} has ${formatBytes(st.remainingBytes)} of storage left. Delete some files, or upgrade for more room.` };
  if (file.size > lim.maxBytes) {
    const mb = lim.maxMb ?? Math.round(lim.maxBytes / 1048576);
    return lim.planLimited
      ? { kind: "upload", message: `${plan} uploads are limited to ${mb} MB per file. Upgrade to upload bigger videos, or compress this one.` }
      : { kind: "size", message: `That's a big one. Keep it under ${mb} MB for now.` };
  }
  return null;
}

/**
 * R1193: the limits for picking an upload back up. Its "uploading" row already holds this file's size against the
 * allowance, so that space is given back before the check, or a resume would be refused by its own reservation.
 */
export function limitsForResume(lim: UploadLimits, size: number): UploadLimits {
  const st = lim.storage;
  if (!st || st.limitBytes <= 0) return lim;
  const used = Math.max(0, (st.usedBytes ?? st.limitBytes - st.remainingBytes) - size);
  return { ...lim, storage: { ...st, usedBytes: used, remainingBytes: Math.max(0, st.limitBytes - used), over: used >= st.limitBytes } };
}

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
  /** R1193: the server's UploadSession for a multipart upload, when it ends, and how long a signed link lasts (seconds). */
  sessionId?: string;
  expiresAt?: number;
  ttl?: number;
}
interface Saved extends DirectInit {
  location?: string;
  at: number;
  /** R1193: the file's identity when it started (fileFingerprint), checked before anything is resumed. */
  fp?: string;
}

const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
/**
 * Where an unfinished upload is remembered. A File rebuilt from this browser's draft copy gets a new
 * lastModified, so the caller can pass a stable key (the draft's id) to resume it after a reload.
 */
export const resumeSlot = (f: Pick<File, "name" | "size" | "lastModified">, key?: string) => (key ? `outly-up:k:${key}:${f.name}:${f.size}` : `outly-up:${f.name}:${f.size}:${f.lastModified}`);
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

/** "18 MB/s", "4.2 MB/s", "640 KB/s": the speed line on the upload card. */
export function formatSpeed(bytesPerSec: number) {
  if (!(bytesPerSec > 0)) return "0 KB/s";
  const mb = bytesPerSec / 1048576;
  if (mb >= 10) return `${Math.round(mb)} MB/s`;
  if (mb >= 1) return `${mb.toFixed(1).replace(/\.0$/, "")} MB/s`;
  return `${Math.max(1, Math.round(bytesPerSec / 1024))} KB/s`;
}

/** Speed and time left over the last 8 seconds of bytes, so a burst or a stall never swings the numbers wildly. */
export function meter(now: () => number = () => performance.now()) {
  const pts: { t: number; b: number }[] = [];
  return (bytes: number, total: number): { speed: number | null; eta: number | null } => {
    const t = now();
    pts.push({ t, b: bytes });
    while (pts.length > 2 && t - pts[0].t > 8000) pts.shift();
    const a = pts[0];
    const dt = (t - a.t) / 1000;
    if (dt < 1.2 || bytes <= a.b) return { speed: null, eta: null };
    const speed = (bytes - a.b) / dt;
    return { speed, eta: Math.max(0, Math.round((total - bytes) / speed)) };
  };
}

/** Full-jitter exponential backoff (AWS's recipe): a random wait up to base x 2^attempt, capped, so retries never stampede. */
export const backoffMs = (attempt: number, rand: () => number = Math.random, base = 1000, cap = 30_000) => Math.round(rand() * Math.min(cap, base * 2 ** attempt));

/** How many parts may be in flight to begin with, and at most: fewer on phones and slow or data-saving connections. */
export function startConcurrency(nav?: { userAgent?: string; connection?: { effectiveType?: string; saveData?: boolean } }) {
  const c = nav?.connection;
  if (c?.saveData || /^(slow-2g|2g|3g)$/.test(c?.effectiveType ?? "")) return { start: 2, max: 3 };
  return /Android|iPhone|iPad|iPod|Mobile/i.test(nav?.userAgent ?? "") ? { start: 3, max: 4 } : { start: 4, max: 6 };
}

/**
 * R1193: adaptive parallelism. After a clean round (as many parts landed as are allowed in flight) and a few seconds
 * at this level, it tries one more part in flight; if that did not make the upload at least 8% faster it steps back
 * and stays there. A failed part drops one level; the far end pushing back (429, 503) halves it. Never below `min`,
 * never above `max`.
 */
export function concurrency({ start, max, min = 1, settleMs = 4000 }: { start: number; max: number; min?: number; settleMs?: number }) {
  let limit = Math.max(min, Math.min(max, start));
  let ceiling = max;
  let streak = 0;
  let raisedFrom: number | null = null;
  let at = -Infinity;
  return {
    get limit() {
      return limit;
    },
    ok(speed: number | null, now: number) {
      streak++;
      if (streak < limit || speed == null || now - at < settleMs) return limit;
      if (raisedFrom != null && speed < raisedFrom * 1.08) {
        limit = Math.max(min, limit - 1);
        ceiling = limit;
        raisedFrom = null;
      } else if (limit < ceiling) {
        raisedFrom = speed;
        limit++;
      } else raisedFrom = null;
      streak = 0;
      at = now;
      return limit;
    },
    fail(pushback: boolean, now = 0) {
      streak = 0;
      raisedFrom = null;
      at = now;
      limit = Math.max(min, pushback ? Math.floor(limit / 2) : limit - 1);
      return limit;
    },
  };
}

/**
 * Who this file is, for a resume: name, size and a SHA-256 of its first and last 64 KB. A different file that
 * happens to share a name and size is caught before any of it is stitched onto the old upload. Without Web Crypto
 * (an insecure origin) it falls back to name, size and, when the File is the original, its modified time.
 */
export async function fileFingerprint(file: Pick<File, "name" | "size" | "lastModified" | "slice">, stable = false): Promise<string> {
  const base = `${file.name}:${file.size}`;
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("no crypto");
    const edge = 65536;
    const head = await file.slice(0, Math.min(edge, file.size)).arrayBuffer();
    const tail = file.size > edge ? await file.slice(Math.max(edge, file.size - edge), file.size).arrayBuffer() : new ArrayBuffer(0);
    const both = new Uint8Array(head.byteLength + tail.byteLength);
    both.set(new Uint8Array(head), 0);
    both.set(new Uint8Array(tail), head.byteLength);
    const d = new Uint8Array(await subtle.digest("SHA-256", both));
    return `${base}:${Array.from(d.slice(0, 12), (x) => x.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return stable ? base : `${base}:${file.lastModified}`;
  }
}

const STALL_MS = 60_000;
/** A part (or a whole small file) gets this many tries while online; waiting for a connection does not use them up. */
const MAX_TRIES = 6;
/** Parts signed per request, ahead of the workers. */
const SIGN_AHEAD = 12;
/** Progress is reported at most this often (several parts each fire upload events many times a second). */
const REPORT_MS = 200;

const abortError = () => new DOMException("Aborted", "AbortError");
const isAbort = (e: unknown, signal?: AbortSignal) => (e as Error)?.name === "AbortError" || !!signal?.aborted;
const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * Waits `ms`, but wakes early when the connection comes back, the network changes (Wi-Fi to cellular) or the page is
 * shown again (a phone that suspended the tab), so a retry never sleeps through the moment it could work.
 */
function nap(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const conn = typeof navigator !== "undefined" ? (navigator as { connection?: EventTarget }).connection : undefined;
    const vis = () => document.visibilityState === "visible" && wake();
    const stop = () => {
      clearTimeout(t);
      if (typeof window !== "undefined") window.removeEventListener("online", wake);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", vis);
      conn?.removeEventListener?.("change", wake);
      signal?.removeEventListener("abort", quit);
    };
    function wake() {
      stop();
      resolve();
    }
    function quit() {
      stop();
      reject(abortError());
    }
    const t = setTimeout(wake, ms);
    if (typeof window !== "undefined") window.addEventListener("online", wake);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", vis);
    conn?.addEventListener?.("change", wake);
    signal?.addEventListener("abort", quit, { once: true });
  });
}

/** Holds while the browser says it is offline. Checks again every 30 s in case the online event never comes. */
async function untilOnline(signal?: AbortSignal, onWait?: () => void) {
  while (offline()) {
    onWait?.();
    await nap(30_000, signal);
  }
}

function xhr(method: string, url: string, body: Blob | null, headers: Record<string, string>, onUp: (loaded: number) => void, signal?: AbortSignal) {
  return new Promise<XMLHttpRequest>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
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
    const stop = () => x.abort();
    const done = () => (clearInterval(dog), signal?.removeEventListener("abort", stop));
    x.upload.onprogress = (e) => {
      last = Date.now();
      onUp(e.loaded);
    };
    x.onprogress = () => (last = Date.now());
    x.onload = () => (done(), resolve(x));
    x.onerror = () => (done(), reject(new ApiError(0, "We lost the connection. We'll pick up where we left off.")));
    x.onabort = () => (done(), reject(stalled ? new ApiError(0, "The upload stalled. Check your connection and try again.") : abortError()));
    signal?.addEventListener("abort", stop, { once: true });
    x.send(body);
  });
}

/** Worth another try: a dropped connection, a timeout, an expired link, the far end busy. Not: a refusal or a stop. */
const retryable = (e: unknown, signal?: AbortSignal) =>
  !(isAbort(e, signal) || (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 403 && e.status !== 408 && e.status !== 429));
/** 429 and 503 mean "slow down", so the parallelism halves rather than steps down. */
const pushback = (e: unknown) => e instanceof ApiError && (e.status === 429 || e.status === 503);

type ReportedPart = { n: number; etag: string; size: number };

/** One upload's progress: bytes, speed, parts and phase, reported at most every REPORT_MS (phase changes at once). */
/** Nothing is reported once `signal` aborts: the parts unwinding after a Pause must not flip the card back to uploading. */
function reporter(file: { size: number }, onProgress: UploadProgress, signal?: AbortSignal) {
  const m = meter();
  const st = { phase: "preparing" as UploadPhase, bytes: 0, partsDone: 0, partsTotal: 1, active: 0, waiting: 0 };
  let speed: number | null = null;
  let eta: number | null = null;
  let lastAt = 0;
  let lastShown: UploadPhase | null = null;
  // Waiting on a retry or a connection with nothing moving reads as "Reconnecting".
  const shown = (): UploadPhase => (st.waiting > 0 && st.active === 0 && st.phase !== "processing" ? "reconnecting" : st.phase);
  const emit = (force = false) => {
    if (signal?.aborted) return;
    const now = Date.now();
    const phase = shown();
    if (!force && phase === lastShown && now - lastAt < REPORT_MS) return;
    lastAt = now;
    lastShown = phase;
    const end = phase === "processing";
    const moving = phase === "uploading";
    onProgress(end ? 1 : Math.min(0.999, st.bytes / Math.max(1, file.size)), end ? 0 : moving ? eta : null, {
      phase,
      bytes: end ? file.size : st.bytes,
      total: file.size,
      speed: moving ? speed : null,
      partsDone: end ? st.partsTotal : st.partsDone,
      partsTotal: st.partsTotal,
      active: st.active,
    });
  };
  return {
    st,
    get speed() {
      return speed;
    },
    phase(p: UploadPhase) {
      st.phase = p;
      emit(true);
    },
    bytes(b: number) {
      st.bytes = b;
      ({ speed, eta } = m(b, file.size));
      emit();
    },
    active(d: number) {
      st.active += d;
      emit(st.active === 0);
    },
    async wait(p: Promise<unknown>) {
      st.waiting++;
      emit(true);
      try {
        await p;
      } finally {
        st.waiting--;
        emit(true);
      }
    },
  };
}
type Rep = ReturnType<typeof reporter>;

/** Calls `fn` until it works: waits out an offline spell for free, backs off with jitter on a failure, MAX_TRIES at most. */
async function retrying<T>(fn: () => Promise<T>, rep: Rep, signal?: AbortSignal): Promise<T> {
  for (let i = 0; ; i++) {
    if (offline()) await rep.wait(untilOnline(signal));
    try {
      return await fn();
    } catch (e) {
      if (!retryable(e, signal) || i + 1 >= MAX_TRIES) throw e;
      await rep.wait(nap(backoffMs(i), signal));
    }
  }
}

const remember = (slot: string, init: Saved) => {
  try {
    localStorage.setItem(slot, JSON.stringify(init));
  } catch {}
};
const forget = (slot: string) => {
  try {
    localStorage.removeItem(slot);
  } catch {}
};
/** Tells the server to drop an upload that will never finish (its parts and the space it holds). Fire and forget. */
const abandon = (s: Pick<DirectInit, "mediaId" | "uploadId">) =>
  void fetch("/api/media/direct/abort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mediaId: s.mediaId, uploadId: s.uploadId }), credentials: "same-origin", keepalive: true }).catch(() => {});

/** This file's unfinished upload, if it can still be picked up: not expired, and the very same file (fingerprint). */
function readSaved(slot: string, fp: string): Saved | null {
  try {
    const raw = localStorage.getItem(slot);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    const now = Date.now();
    // A multipart session lasts a day and its links are signed again; a single put link can't be, so it lives as long as its link.
    const alive = s.expiresAt ? now < s.expiresAt - 10 * 60_000 : s.mode === "put" ? now - s.at < (s.ttl ? s.ttl * 1000 - 60_000 : 50 * 60_000) : now - s.at < 100 * 60_000;
    if (alive && (!s.fp || s.fp === fp)) return s;
    localStorage.removeItem(slot);
    if (s.mediaId) abandon(s);
  } catch {}
  return null;
}

/** Server answers that mean the remembered upload can't go on, so the file starts once more from scratch. */
const STALE = new Set(["EXPIRED", "FILE_CHANGED", "UPLOAD_MISMATCH", "NOT_UPLOADING", "LINK_EXPIRED", "PART_SIZE"]);

export async function uploadVideo<M>(file: File, onProgress: UploadProgress, signal?: AbortSignal, opts?: { resumeKey?: string }): Promise<UploadedMedia<M>> {
  const cfg = await loadUploadLimits();
  const slot = resumeSlot(file, opts?.resumeKey);
  // An unfinished upload of this very file is looked for first: its space is already held, so it isn't counted twice.
  const fp = cfg.direct ? await fileFingerprint(file, !!opts?.resumeKey) : "";
  let saved = cfg.direct ? readSaved(slot, fp) : null;
  // Checked here so nobody waits through an upload the server will refuse anyway.
  const bad = limitsProblem(file, saved ? limitsForResume(cfg, file.size) : cfg);
  if (bad) {
    const sell = upgradeFor(bad.kind);
    if (sell) {
      offerUpgrade(bad.message, sell);
      throw new ApiError(402, bad.message, "PLAN_LIMIT");
    }
    throw new ApiError(bad.kind === "size" ? 413 : 415, bad.message, bad.kind === "size" ? "TOO_LARGE" : "BAD_TYPE");
  }
  if (!cfg.direct) {
    const done = await uploadWithProgress<UploadedMedia<M>>(`/api/media?name=${encodeURIComponent(file.name)}`, file, (p) => onProgress(p, null), signal);
    track("library_upload", { kind: file.type.split("/")[0] || "file" });
    return done;
  }

  const rep = reporter(file, onProgress, signal);
  rep.phase("preparing");
  for (let attempt = 0; ; attempt++) {
    const resuming = !!saved;
    const init: Saved =
      saved ??
      { ...(await retrying(() => api<DirectInit>("/api/media/direct", { method: "POST", json: { name: file.name, type: file.type, size: file.size, fingerprint: fp }, signal }), rep, signal)), at: Date.now(), fp };
    remember(slot, init);
    try {
      let mp: ReturnType<typeof multipart> | null = null;
      if (init.mode === "put") await putWhole(file, init, rep, signal);
      else if (init.mode === "multipart") {
        mp = multipart(file, init, rep, signal, fp);
        await mp.start(resuming);
      } else await tus(file, init, rep, signal, slot);
      const done = await complete<M>(init, rep, signal, mp);
      forget(slot);
      rep.phase("processing");
      track("library_upload", { kind: file.type.split("/")[0] || "file" });
      return done;
    } catch (e) {
      if (isAbort(e, signal)) throw e;
      const code = e instanceof ApiError ? (e.code ?? (e.status === 410 ? "EXPIRED" : "")) : "";
      // Finished by an earlier visit whose answer never arrived: ask once more and use it.
      if (code === "NOT_UPLOADING") {
        const r = await api<UploadedMedia<M>>("/api/media/direct/complete", { method: "POST", json: { mediaId: init.mediaId, uploadId: init.uploadId }, signal }).catch(() => null);
        if (r && (r.media as { status?: string } | null)?.status !== "failed") {
          forget(slot);
          rep.phase("processing");
          return r;
        }
      }
      if (attempt === 0 && STALE.has(code) && (resuming || code === "LINK_EXPIRED" || code === "PART_SIZE")) {
        forget(slot);
        abandon(init);
        saved = null;
        rep.st.bytes = 0;
        rep.st.partsDone = 0;
        continue;
      }
      throw e;
    }
  }
}

/** R1193: Cancel. Forgets this file's unfinished upload and tells the server to drop it. Safe to call when there is none. */
export function discardUpload(file: Pick<File, "name" | "size" | "lastModified">, opts?: { resumeKey?: string }) {
  const slot = resumeSlot(file, opts?.resumeKey);
  try {
    const raw = localStorage.getItem(slot);
    localStorage.removeItem(slot);
    const s = raw ? (JSON.parse(raw) as Saved) : null;
    if (s?.mediaId) abandon(s);
  } catch {}
}

/** The last step for every transport: the server checks what landed and queues processing. Waits out a racing completion. */
async function complete<M>(init: DirectInit, rep: Rep, signal: AbortSignal | undefined, mp: ReturnType<typeof multipart> | null): Promise<UploadedMedia<M>> {
  rep.phase("finalizing");
  let redone = false;
  for (let tries = 0, waits = 0; ; ) {
    if (offline()) await rep.wait(untilOnline(signal));
    const reports = mp?.take() ?? [];
    try {
      return await api<UploadedMedia<M>>("/api/media/direct/complete", { method: "POST", json: { mediaId: init.mediaId, uploadId: init.uploadId, done: reports }, signal });
    } catch (e) {
      if (isAbort(e, signal)) throw e;
      mp?.give(reports);
      // 100 x 1.5 s outlasts FINALIZE_STALE_MS (2 min), so a stitch that crashed is taken over without a retry press.
      if (e instanceof ApiError && e.code === "FINALIZING" && waits++ < 100) {
        await nap(1500, signal);
        continue;
      }
      // The bucket is missing a part we thought landed: list again, send just those, then finish.
      if (e instanceof ApiError && e.code === "PARTS_MISSING" && mp && !redone) {
        redone = true;
        await mp.redo();
        rep.phase("finalizing");
        continue;
      }
      if (!retryable(e, signal) || ++tries >= MAX_TRIES) throw e;
      await rep.wait(nap(backoffMs(tries), signal));
    }
  }
}

/** R2/S3, small file: one presigned PUT. Its link can't be signed again, so a 403 starts the file afresh (uploadVideo). */
async function putWhole(file: File, init: DirectInit, rep: Rep, signal?: AbortSignal) {
  rep.st.partsTotal = 1;
  rep.phase("uploading");
  for (let tries = 0; ; ) {
    if (offline()) await rep.wait(untilOnline(signal));
    rep.active(1);
    try {
      const r = await xhr("PUT", init.uploadUrl, file, { "content-type": init.contentType || file.type || "video/mp4" }, (l) => rep.bytes(l), signal);
      if (r.status === 403) throw new ApiError(403, s3Error(r), "LINK_EXPIRED");
      if (r.status >= 300) throw new ApiError(r.status, s3Error(r));
      rep.st.partsDone = 1;
      rep.bytes(file.size);
      return;
    } catch (e) {
      if ((e instanceof ApiError && e.code === "LINK_EXPIRED") || !retryable(e, signal) || ++tries >= MAX_TRIES) throw e;
      await rep.wait(nap(backoffMs(tries - 1), signal));
    } finally {
      rep.active(-1);
    }
  }
}

type Signed = { urls: Record<string, string>; uploaded?: { n: number; size: number }[]; partSize?: number; total?: number; ttl?: number };

/**
 * R2/S3, big file: presigned multipart. Parts go up in parallel, as many at once as the adaptive limit allows
 * (concurrency), each retried on its own. Links are signed a batch ahead of the workers and signed again when one
 * runs out (a 403, or older than its lifetime less a minute). Each landed part's ETag rides along on the next call,
 * so the server keeps count. A resume asks the bucket which parts it already has and sends only the rest: a part
 * that landed is never sent again.
 */
function multipart(file: File, init: DirectInit, rep: Rep, signal: AbortSignal | undefined, fp: string) {
  const size = init.partSize!;
  const total = Math.ceil(file.size / size);
  const bytes = (n: number) => (n < total ? size : file.size - size * (total - 1));
  const done = new Set<number>();
  const urls = new Map<number, { url: string; at: number }>();
  const inFlight = new Map<number, number>();
  let outbox: ReportedPart[] = [];
  let ttlMs = (init.ttl ?? 900) * 1000;
  const ctl = concurrency(startConcurrency(typeof navigator === "undefined" ? undefined : (navigator as Parameters<typeof startConcurrency>[0])));
  rep.st.partsTotal = total;

  const progress = () => {
    let b = 0;
    for (const n of done) b += bytes(n);
    for (const v of inFlight.values()) b += v;
    rep.st.partsDone = done.size;
    rep.bytes(b);
  };
  /** The landed parts not yet told to the server (at most 48 per call), and a way to put them back when a call fails. */
  const take = () => outbox.splice(0, 48);
  const give = (parts: ReportedPart[]) => {
    outbox = [...parts, ...outbox];
  };
  const fresh = (n: number) => {
    const u = urls.get(n);
    return !!u && Date.now() - u.at < ttlMs - Math.min(60_000, ttlMs / 4);
  };

  async function sign(nums: number[], list: boolean, sig: AbortSignal | undefined) {
    const reports = take();
    let r: Signed;
    try {
      r = await retrying(() => api<Signed>("/api/media/direct/parts", { method: "POST", json: { mediaId: init.mediaId, uploadId: init.uploadId, parts: nums, list, done: reports, fingerprint: fp }, signal: sig }), rep, sig);
    } catch (e) {
      give(reports);
      throw e;
    }
    // Cut with a different size than this browser remembers (an upload saved before the server's size changed).
    if (r.partSize && r.partSize !== size) throw new ApiError(409, "This upload was split differently. Starting it fresh.", "PART_SIZE");
    const at = Date.now();
    if (r.ttl) ttlMs = r.ttl * 1000;
    for (const [k, v] of Object.entries(r.urls)) urls.set(Number(k), { url: v, at });
    for (const p of r.uploaded ?? []) if (p.size === bytes(p.n)) done.add(p.n);
  }

  /** Sends every part that isn't done yet, keeping `ctl.limit` of them in flight. The first part that fails for good stops the rest. */
  async function run() {
    const queue = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !done.has(n));
    if (!queue.length) return;
    const inner = new AbortController();
    const stop = () => inner.abort();
    if (signal?.aborted) throw abortError();
    signal?.addEventListener("abort", stop, { once: true });
    const sig = inner.signal;
    let signing: Promise<void> | null = null;

    const urlFor = async (n: number) => {
      for (let asked = 0; !fresh(n); ) {
        if (!signing) {
          if (asked++ >= 3) throw new ApiError(409, "We couldn't get a link for part of the video. Starting it fresh.", "PART_SIZE");
          const i = queue.indexOf(n);
          const batch = queue.slice(i, i + SIGN_AHEAD).filter((m) => !done.has(m) && !fresh(m));
          signing = sign(batch.length ? batch : [n], false, sig).finally(() => (signing = null));
        }
        await signing;
      }
      return urls.get(n)!.url;
    };

    const one = async (n: number) => {
      for (let tries = 0; ; ) {
        if (offline()) await rep.wait(untilOnline(sig));
        rep.active(1);
        try {
          const url = await urlFor(n);
          const from = (n - 1) * size;
          const r = await xhr("PUT", url, file.slice(from, from + bytes(n)), {}, (l) => (inFlight.set(n, l), progress()), sig);
          if (r.status === 403) urls.delete(n); // the link ran out (or the clock is off): sign it again
          if (r.status >= 300) throw new ApiError(r.status, s3Error(r));
          inFlight.delete(n);
          done.add(n);
          // Needs ETag in the bucket's CORS ExposeHeaders. Without it the part still counts; the stitch lists the bucket.
          const etag = r.getResponseHeader("ETag");
          if (etag) outbox.push({ n, etag, size: bytes(n) });
          progress();
          ctl.ok(rep.speed, Date.now());
          return;
        } catch (e) {
          inFlight.delete(n);
          progress();
          if (!retryable(e, sig)) throw e;
          // Dropped because the connection went: wait for it at the top, without spending a try.
          if (offline()) continue;
          if (++tries >= MAX_TRIES) throw e;
          // A link that ran out says nothing about the connection; anything else steps the parallelism down.
          if (!(e instanceof ApiError && e.status === 403)) ctl.fail(pushback(e), Date.now());
        } finally {
          rep.active(-1);
        }
        await rep.wait(nap(backoffMs(tries - 1), sig));
      }
    };

    let next = 0;
    let running = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        let failed = false;
        const pump = () => {
          if (failed) return;
          if (next >= queue.length && running === 0) return resolve();
          while (running < ctl.limit && next < queue.length) {
            const n = queue[next++];
            running++;
            one(n).then(
              () => {
                running--;
                pump();
              },
              (e) => {
                running--;
                if (failed) return;
                failed = true;
                inner.abort();
                reject(signal?.aborted ? abortError() : e);
              },
            );
          }
        };
        pump();
      });
    } finally {
      signal?.removeEventListener("abort", stop);
    }
  }

  /** The bucket's own list: what landed, by number and size. Used on a resume and when /complete finds a gap. */
  async function relist() {
    rep.phase("resuming");
    done.clear();
    await sign([], true, signal);
    rep.phase("uploading");
    progress();
  }

  return {
    async start(resuming: boolean) {
      if (resuming) await relist();
      else {
        rep.phase("uploading");
        progress();
      }
      await run();
    },
    take,
    give,
    /** /complete said parts are missing: list again and send just those. */
    async redo() {
      await relist();
      await run();
    },
  };
}

/** Supabase: one PUT for a file that fits in a chunk, else TUS resumable that always picks up from the server's offset. */
async function tus(file: File, init: Saved, rep: Rep, signal: AbortSignal | undefined, slot: string) {
  const auth = { apikey: ANON, "x-signature": init.token, "Tus-Resumable": "1.0.0" };
  const total = Math.max(1, Math.ceil(file.size / init.chunkSize));
  rep.st.partsTotal = total;

  if (file.size <= init.chunkSize && !init.location) {
    rep.phase("uploading");
    await retrying(async () => {
      rep.active(1);
      try {
        const r = await xhr("PUT", init.uploadUrl, file, { "content-type": file.type || "video/mp4", "x-upsert": "true" }, (l) => rep.bytes(l), signal);
        if (r.status >= 300) throw new ApiError(r.status, uploadError(r));
      } finally {
        rep.active(-1);
      }
    }, rep, signal);
    rep.st.partsDone = 1;
    rep.bytes(file.size);
    return;
  }

  if (!init.location) {
    const r = await retrying(
      () =>
        xhr("POST", init.resumableUrl, null, {
          ...auth,
          "Upload-Length": String(file.size),
          "Upload-Metadata": [`bucketName ${b64(init.bucket)}`, `objectName ${b64(init.key)}`, `contentType ${b64(file.type || "video/mp4")}`, `cacheControl ${b64("3600")}`].join(","),
          "x-upsert": "true",
        }, () => {}, signal),
      rep,
      signal,
    );
    const loc = r.getResponseHeader("Location");
    if (r.status !== 201 || !loc) throw new ApiError(r.status, uploadError(r));
    init.location = loc;
    remember(slot, init);
  } else rep.phase("resuming");
  const location = init.location;

  /** Where the server thinks we are. Null when it didn't say (try again from where we are). */
  const where = async () => {
    const h = await retrying(() => xhr("HEAD", location, null, auth, () => {}, signal), rep, signal);
    if (h.status === 404 || h.status === 410) {
      forget(slot);
      throw new ApiError(410, "That upload expired. Drop the video again and we'll start fresh.", "EXPIRED");
    }
    return h.status === 200 ? Number(h.getResponseHeader("Upload-Offset") ?? 0) : null;
  };
  let offset = (await where()) ?? 0;
  const show = () => {
    rep.st.partsDone = offset >= file.size ? total : Math.floor(offset / init.chunkSize);
    rep.bytes(offset);
  };
  rep.phase("uploading");
  show();
  for (let tries = 0; offset < file.size; ) {
    if (offline()) await rep.wait(untilOnline(signal));
    const chunk = file.slice(offset, Math.min(file.size, offset + init.chunkSize));
    rep.active(1);
    try {
      const r = await xhr("PATCH", location, chunk, { ...auth, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" }, (l) => rep.bytes(offset + l), signal);
      if (r.status === 409) {
        // Offset drifted (a chunk landed but its answer was lost): ask the server.
        offset = (await where()) ?? offset;
        show();
        continue;
      }
      if (r.status !== 204) throw new ApiError(r.status, uploadError(r));
      offset = Number(r.getResponseHeader("Upload-Offset") ?? offset + chunk.size);
      tries = 0;
      show();
      continue;
    } catch (e) {
      if (!retryable(e, signal)) throw e;
      if (offline()) continue;
      if (++tries >= MAX_TRIES) throw e;
    } finally {
      rep.active(-1);
    }
    await rep.wait(nap(backoffMs(tries - 1), signal));
    offset =
      (await where().catch((x) => {
        if (!retryable(x, signal)) throw x;
        return null;
      })) ?? offset;
    show();
  }
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

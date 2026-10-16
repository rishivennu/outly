"use client";
/**
 * Drafts kept in this browser (IndexedDB), video included, so a draft survives even after the
 * server copy expires (untouched drafts leave Outlly after DRAFT_TTL_DAYS, see lib/retention/prune.ts).
 * Everything here fails soft: private windows, full disks and old browsers simply keep no copy.
 */

import { DRAFT_TTL_DAYS } from "@/lib/domain";

export { DRAFT_TTL_DAYS };
const DB = "outlly-drafts";
const META = "drafts";
const VIDEO = "videos";
const KEEP = 8;

export interface DeviceTarget {
  enabled: boolean;
  title: string;
  caption: string;
  description: string;
  hashtags: string;
  /** Missing on drafts saved before first comments existed. */
  firstComment?: string;
}

export interface DeviceDraft {
  id: string;
  /** The server draft this copy belongs to, while it exists. */
  postId: string | null;
  updatedAt: number;
  title: string;
  story: string;
  hook: string | null;
  targets: Record<string, DeviceTarget>;
  filename: string | null;
  /** name:size of the stored video, so the same file is never written twice (a File rebuilt from IndexedDB has a new lastModified). */
  videoKey: string | null;
  videoType: string | null;
  poster: Blob | null;
}

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
        if (!db.objectStoreNames.contains(VIDEO)) db.createObjectStore(VIDEO);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening.then((db) => {
    if (!db) opening = null; // try again next time
    return db;
  });
}

function run<T>(stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(stores, mode);
          const req = body(tx);
          tx.oncomplete = () => resolve(req ? req.result : undefined);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const newDeviceId = () => `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
export const fileKey = (f: File) => `${f.name}:${f.size}`;

export async function listDeviceDrafts(): Promise<DeviceDraft[]> {
  const all = (await run<DeviceDraft[]>([META], "readonly", (tx) => tx.objectStore(META).getAll() as IDBRequest<DeviceDraft[]>)) ?? [];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDeviceDraft(id: string): Promise<{ draft: DeviceDraft; video: File | null } | null> {
  const draft = await run<DeviceDraft>([META], "readonly", (tx) => tx.objectStore(META).get(id) as IDBRequest<DeviceDraft>);
  if (!draft) return null;
  const blob = draft.videoKey ? await run<Blob>([VIDEO], "readonly", (tx) => tx.objectStore(VIDEO).get(id) as IDBRequest<Blob>) : undefined;
  const video = blob ? new File([blob], draft.filename ?? "video.mp4", { type: draft.videoType || blob.type || "video/mp4" }) : null;
  return { draft, video };
}

export async function findDeviceDraftByPost(postId: string): Promise<DeviceDraft | null> {
  return (await listDeviceDrafts()).find((d) => d.postId === postId) ?? null;
}

export async function removeDeviceDraft(id: string): Promise<void> {
  await run([META, VIDEO], "readwrite", (tx) => {
    tx.objectStore(META).delete(id);
    tx.objectStore(VIDEO).delete(id);
  });
}

/** Room for a video of this size, with a margin, if the browser says how much it has. */
async function fits(bytes: number) {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est?.quota) return true;
    return (est.usage ?? 0) + bytes < est.quota * 0.8;
  } catch {
    return true;
  }
}

let askedPersist = false;

/**
 * Writes the text right away and the video only when it changed. Keeps the newest KEEP drafts.
 * Returns false when nothing could be stored (no IndexedDB, or quota).
 */
export async function saveDeviceDraft(d: Omit<DeviceDraft, "updatedAt" | "videoKey" | "videoType">, video?: File | null): Promise<boolean> {
  if (!(await open())) return false;
  if (!askedPersist) {
    askedPersist = true;
    navigator.storage?.persist?.().catch(() => {});
  }
  const prev = await run<DeviceDraft>([META], "readonly", (tx) => tx.objectStore(META).get(d.id) as IDBRequest<DeviceDraft>);
  let videoKey = prev?.videoKey ?? null;
  let videoType = prev?.videoType ?? null;
  const writeVideo = !!video && fileKey(video) !== videoKey && (await fits(video.size));
  if (writeVideo && video) {
    videoKey = fileKey(video);
    videoType = video.type || "video/mp4";
  }
  const record: DeviceDraft = { ...d, filename: d.filename ?? prev?.filename ?? null, poster: d.poster ?? prev?.poster ?? null, videoKey, videoType, updatedAt: Date.now() };
  const ok = await run([META, VIDEO], "readwrite", (tx) => {
    const req = tx.objectStore(META).put(record);
    if (writeVideo && video) tx.objectStore(VIDEO).put(video, d.id);
    return req;
  });
  if (ok === undefined) {
    // Most likely the video blew the quota: keep the words at least.
    if (!writeVideo) return false;
    const textOnly = { ...record, videoKey: prev?.videoKey ?? null, videoType: prev?.videoType ?? null };
    if ((await run([META], "readwrite", (tx) => tx.objectStore(META).put(textOnly))) === undefined) return false;
  }
  const all = await listDeviceDrafts();
  const stale = all.filter((x, i) => i >= KEEP || (record.postId && x.postId === record.postId && x.id !== record.id));
  for (const s of stale) await removeDeviceDraft(s.id);
  return true;
}

export function ago(ms: number, now = Date.now()) {
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

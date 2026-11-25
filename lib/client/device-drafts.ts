"use client";
/**
 * Drafts kept in this browser (IndexedDB), video included, so a draft survives even when the server copy is
 * deleted (R1209: saved drafts on Outlly are kept until deleted; only unused uploads move to Trash, see lib/storage/lifecycle.ts).
 * Phase 2: one database per account ("outlly-drafts:<hashed user id>"), so a shared device never shows one
 * person's drafts to another. Sign-out deletes them all (lib/client/forget-billing.ts). The unscoped database
 * older builds wrote has no owner we can prove, so it is never adopted by itself: an empty one is deleted, one
 * with drafts stays until the signed-in person moves them into their account (adoptLegacy) or signs out.
 * Only draft words, media and sync bookkeeping are stored: never a token, cookie or session.
 * Everything here fails soft: private windows, full disks and old browsers simply keep no copy.
 */

import { DRAFT_TTL_DAYS } from "@/lib/domain";
import { hashKey } from "@/components/shell/UserContext";
import { clientKeyFor, isClientKey, isValidLocal, latestValid } from "./draft-sync-core";

export { DRAFT_TTL_DAYS };
export const LEGACY_DB = "outlly-drafts";
const PREFIX = "outlly-drafts:";
/** Names of the per-account databases this browser created (hashed, never an id), for clearing where indexedDB.databases() is missing. */
const REGISTRY = "outlly-drafts-dbs";
const META = "drafts";
const VIDEO = "videos";
const KEEP = 8;

export type DraftSyncState = "local" | "pending" | "synced" | "failed" | "conflict";

export interface DeviceTarget {
  enabled: boolean;
  title: string;
  caption: string;
  description: string;
  hashtags: string;
  /** Missing on drafts saved before first comments existed. */
  firstComment?: string;
  /** 1162: the account picked for this place, when the creator has several there. */
  accountId?: string | null;
}

export interface DeviceDraft {
  id: string;
  /** The server draft this copy belongs to, while it exists. */
  postId: string | null;
  updatedAt: number;
  title: string;
  story: string;
  /** R1209 A1: Your Story's two boxes, the mode picked and Outlly's untouched caption (components/create/story-meta). */
  storyMeta?: string;
  hook: string | null;
  targets: Record<string, DeviceTarget>;
  filename: string | null;
  /** name:size of the stored video, so the same file is never written twice (a File rebuilt from IndexedDB has a new lastModified). */
  videoKey: string | null;
  videoType: string | null;
  poster: Blob | null;
  syncState: DraftSyncState;
  /** The server copy's updatedAt this one was last in step with: PATCH sends it, so a newer edit elsewhere is a conflict, not an overwrite. */
  baseUpdatedAt?: string;
  /** Sent once with POST /api/posts, so a draft made offline is created on the server once however often it retries. */
  clientKey: string;
  schedule?: { at: string | null; tz: string };
  /** The caption track as the editor holds it. */
  captions?: unknown;
  /** 1190: what Pip wrote for each place, so "Restore Pip's version" survives a reload. */
  adapted?: unknown;
  /**
   * R1330: the video is already on Outlly (a Clipper render, or an upload that finished), so a reload adopts that Media
   * instead of asking for the file again. Null once a different file takes over.
   */
  mediaId?: string | null;
  /** R1330: the Clipper clip this draft came from; the first server save still links the post to it after a reload. */
  clipId?: string | null;
}

export type DeviceDraftInput = Omit<DeviceDraft, "updatedAt" | "videoKey" | "videoType" | "syncState" | "clientKey"> & Partial<Pick<DeviceDraft, "syncState" | "clientKey">>;
/** `baseUpdatedAt: null` forgets the base (the server copy is gone). */
export type DeviceDraftPatch = Partial<Pick<DeviceDraft, "postId" | "syncState">> & { baseUpdatedAt?: string | null };

export const draftsDbName = (userId: string) => `${PREFIX}${hashKey(`drafts|${userId}`)}`;

const handles = new Map<string, Promise<IDBDatabase | null>>();
let legacyChecked = false;
let lastUser: string | null = null;

function remember(name: string) {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(REGISTRY) ?? "[]");
    if (!list.includes(name)) localStorage.setItem(REGISTRY, JSON.stringify([...list, name].slice(-20)));
  } catch {
    /* storage blocked */
  }
}

function drop(name: string): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  const open = handles.get(name);
  handles.delete(name);
  return (open ?? Promise.resolve(null))
    .then((db) => db?.close())
    .catch(() => {})
    .then(
      () =>
        new Promise<void>((resolve) => {
          try {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            // Another tab still holds it: it closes on versionchange (below), and the delete finishes then.
            req.onblocked = () => resolve();
          } catch {
            resolve();
          }
        }),
    );
}

/** The pre-Phase-2 database, only if it already exists (opening never leaves a new empty one behind). */
function openLegacy(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise<IDBDatabase | null>((resolve) => {
    try {
      let fresh = false;
      const req = indexedDB.open(LEGACY_DB);
      req.onupgradeneeded = () => {
        fresh = true;
      };
      req.onsuccess = () => {
        const db = req.result;
        if (fresh || !db.objectStoreNames.contains(META)) {
          db.close();
          void drop(LEGACY_DB).then(() => resolve(null));
        } else resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function inDb<T>(db: IDBDatabase | null, stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
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
  });
}

/** Drafts an older build left in the legacy database that can still be opened. */
async function legacyRecords(): Promise<{ db: IDBDatabase | null; rows: DeviceDraft[] }> {
  const db = await openLegacy();
  const all = (await inDb<DeviceDraft[]>(db, [META], "readonly", (tx) => tx.objectStore(META).getAll() as IDBRequest<DeviceDraft[]>)) ?? [];
  return { db, rows: all.filter(isValidLocal).map(upgrade) };
}

let legacyCount: Promise<number> | null = null;
/**
 * How many drafts an older version of Outlly left on this device, outside any account. A legacy database
 * with none it can open is deleted; one with drafts is kept, so nothing unsynced disappears without a word.
 */
export function legacyDraftCount(): Promise<number> {
  legacyCount ??= legacyRecords().then(({ db, rows }) => {
    db?.close();
    if (!rows.length && db) return drop(LEGACY_DB).then(() => 0);
    return rows.length;
  });
  return legacyCount;
}

function openDb(userId: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined" || !userId) return Promise.resolve(null);
  if (!legacyChecked) {
    legacyChecked = true;
    void legacyDraftCount();
  }
  const name = draftsDbName(userId);
  // A different account in this tab: let go of the last one's database.
  if (lastUser !== userId) {
    for (const [other] of handles) if (other !== name) {
      void handles.get(other)?.then((db) => db?.close());
      handles.delete(other);
    }
    lastUser = userId;
  }
  let opening = handles.get(name);
  if (!opening) {
    opening = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
          if (!db.objectStoreNames.contains(VIDEO)) db.createObjectStore(VIDEO);
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            db.close();
            handles.delete(name);
          };
          remember(name);
          resolve(db);
        };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    handles.set(name, opening);
  }
  return opening.then((db) => {
    if (!db && handles.get(name) === opening) handles.delete(name); // try again next time
    return db;
  });
}

function runIn<T>(userId: string, stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb(userId).then((db) => inDb(db, stores, mode, body));
}

export const newDeviceId = () => `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
export const fileKey = (f: File) => `${f.name}:${f.size}`;

/** Records written before Phase 2 (or by an older tab) get the sync fields they lack. */
function upgrade(d: DeviceDraft): DeviceDraft {
  return { ...d, syncState: d.syncState ?? (d.postId ? "synced" : "local"), clientKey: isClientKey(d.clientKey) ? d.clientKey : clientKeyFor(d.id) };
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

/** Every draft call for one account. The handle is cheap: make one wherever the user id is known. */
export function openDrafts(userId: string) {
  const run = <T,>(stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => IDBRequest<T> | void) => runIn<T>(userId, stores, mode, body);
  const raw = (id: string) => run<DeviceDraft>([META], "readonly", (tx) => tx.objectStore(META).get(id) as IDBRequest<DeviceDraft>);

  async function list(): Promise<DeviceDraft[]> {
    const all = (await run<DeviceDraft[]>([META], "readonly", (tx) => tx.objectStore(META).getAll() as IDBRequest<DeviceDraft[]>)) ?? [];
    return all.map(upgrade).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function get(id: string): Promise<{ draft: DeviceDraft; video: File | null } | null> {
    const found = await raw(id);
    if (!found) return null;
    const draft = upgrade(found);
    const blob = draft.videoKey ? await run<Blob>([VIDEO], "readonly", (tx) => tx.objectStore(VIDEO).get(id) as IDBRequest<Blob>) : undefined;
    const video = blob ? new File([blob], draft.filename ?? "video.mp4", { type: draft.videoType || blob.type || "video/mp4" }) : null;
    return { draft, video };
  }

  /** The record without its video, for bookkeeping. */
  async function peek(id: string): Promise<DeviceDraft | null> {
    const found = await raw(id);
    return found ? upgrade(found) : null;
  }

  async function findByPost(postId: string): Promise<DeviceDraft | null> {
    return latestValid((await list()).filter((d) => d.postId === postId));
  }

  async function remove(id: string): Promise<void> {
    await run([META, VIDEO], "readwrite", (tx) => {
      tx.objectStore(META).delete(id);
      tx.objectStore(VIDEO).delete(id);
    });
  }

  /**
   * Writes the text right away and the video only when it changed. Keeps the newest KEEP drafts.
   * A save is a change the server does not have yet, so it is "pending" unless the caller says otherwise.
   * Returns false when nothing could be stored (no IndexedDB, or quota).
   */
  async function save(d: DeviceDraftInput, video?: File | null): Promise<boolean> {
    if (!(await openDb(userId))) return false;
    if (!askedPersist) {
      askedPersist = true;
      navigator.storage?.persist?.().catch(() => {});
    }
    const prev = await raw(d.id);
    let videoKey = prev?.videoKey ?? null;
    let videoType = prev?.videoType ?? null;
    const writeVideo = !!video && fileKey(video) !== videoKey && (await fits(video.size));
    if (writeVideo && video) {
      videoKey = fileKey(video);
      videoType = video.type || "video/mp4";
    }
    // Named fields only: whatever else a caller passes (a token by mistake) never reaches the disk.
    const record: DeviceDraft = {
      id: d.id,
      postId: d.postId ?? prev?.postId ?? null,
      title: d.title,
      story: d.story,
      hook: d.hook,
      targets: d.targets,
      filename: d.filename ?? prev?.filename ?? null,
      poster: d.poster ?? prev?.poster ?? null,
      videoKey,
      videoType,
      updatedAt: Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1),
      syncState: d.syncState ?? (prev?.syncState === "conflict" ? "conflict" : "pending"),
      baseUpdatedAt: d.baseUpdatedAt ?? prev?.baseUpdatedAt,
      clientKey: isClientKey(prev?.clientKey) ? prev!.clientKey : isClientKey(d.clientKey) ? d.clientKey : clientKeyFor(d.id),
      ...("schedule" in d ? { schedule: d.schedule } : prev?.schedule !== undefined ? { schedule: prev.schedule } : {}),
      ...("captions" in d ? { captions: d.captions } : prev?.captions !== undefined ? { captions: prev.captions } : {}),
      ...("adapted" in d ? { adapted: d.adapted } : prev?.adapted !== undefined ? { adapted: prev.adapted } : {}),
      ...("mediaId" in d ? { mediaId: typeof d.mediaId === "string" ? d.mediaId : null } : prev?.mediaId !== undefined ? { mediaId: prev.mediaId } : {}),
      ...("clipId" in d ? { clipId: typeof d.clipId === "string" ? d.clipId : null } : prev?.clipId !== undefined ? { clipId: prev.clipId } : {}),
      ...(typeof d.storyMeta === "string" ? { storyMeta: d.storyMeta.slice(0, 20_000) } : typeof prev?.storyMeta === "string" ? { storyMeta: prev.storyMeta } : {}),
    };
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
    const all = await list();
    // Only copies Outlly already has may go: an unsynced draft (and its video) is never pruned.
    const stale = all.filter((x, i) => x.syncState === "synced" && (i >= KEEP || (record.postId && x.postId === record.postId && x.id !== record.id)));
    for (const s of stale) await remove(s.id);
    return true;
  }

  /**
   * Sync bookkeeping only (state, server id, base time); the words stay as they are.
   * With `ifUpdatedAt`, only when no newer local change landed meanwhile: a slow request
   * can never mark a later edit as synced.
   */
  async function update(id: string, patch: DeviceDraftPatch, ifUpdatedAt?: number): Promise<boolean> {
    const prev = await raw(id);
    if (!prev) return false;
    if (ifUpdatedAt !== undefined && prev.updatedAt > ifUpdatedAt && patch.syncState === "synced") patch = { ...patch, syncState: "pending" };
    const next: DeviceDraft = { ...upgrade(prev) };
    if (patch.postId !== undefined) next.postId = patch.postId;
    if (patch.syncState !== undefined) next.syncState = patch.syncState;
    if (patch.baseUpdatedAt === null) delete next.baseUpdatedAt;
    else if (patch.baseUpdatedAt !== undefined) next.baseUpdatedAt = patch.baseUpdatedAt;
    return (await run([META], "readwrite", (tx) => tx.objectStore(META).put(next))) !== undefined;
  }

  /**
   * Moves the older version's drafts (legacyDraftCount) into this account, videos included, then deletes the
   * legacy database. Only on the signed-in person's say-so. A draft this account already has is left as it is.
   * Returns how many moved.
   */
  async function adoptLegacy(): Promise<number> {
    const { db, rows } = await legacyRecords();
    if (!db) return 0;
    let moved = 0;
    let kept = 0;
    for (const d of rows) {
      if (await raw(d.id)) {
        kept += 1;
        continue;
      }
      const video = d.videoKey ? await inDb<Blob>(db, [VIDEO], "readonly", (tx) => tx.objectStore(VIDEO).get(d.id) as IDBRequest<Blob>) : undefined;
      const record: DeviceDraft = {
        id: d.id,
        postId: d.postId ?? null,
        title: d.title,
        story: d.story,
        hook: d.hook,
        targets: d.targets,
        filename: d.filename ?? null,
        poster: d.poster ?? null,
        videoKey: video ? d.videoKey : null,
        videoType: video ? d.videoType : null,
        updatedAt: d.updatedAt,
        syncState: d.syncState,
        ...(d.baseUpdatedAt ? { baseUpdatedAt: d.baseUpdatedAt } : {}),
        clientKey: d.clientKey,
        ...(d.schedule !== undefined ? { schedule: d.schedule } : {}),
        ...(d.captions !== undefined ? { captions: d.captions } : {}),
        ...(d.adapted !== undefined ? { adapted: d.adapted } : {}),
        ...(typeof d.storyMeta === "string" ? { storyMeta: d.storyMeta } : {}),
      };
      const ok = await run([META, VIDEO], "readwrite", (tx) => {
        const req = tx.objectStore(META).put(record);
        if (video) tx.objectStore(VIDEO).put(video, d.id);
        return req;
      });
      if (ok !== undefined) moved += 1;
    }
    db.close();
    // Anything that could not be copied (quota) stays where it was.
    if (moved + kept === rows.length) {
      await drop(LEGACY_DB);
      legacyCount = Promise.resolve(0);
    } else legacyCount = null;
    return moved;
  }

  return { list, get, peek, findByPost, save, update, remove, adoptLegacy, clear: () => clearDeviceDrafts(userId) };
}
export type DraftStore = ReturnType<typeof openDrafts>;

/**
 * Deletes this browser's drafts: one account's, or with no id every account's plus the legacy database
 * (sign-out and account deletion). Never throws.
 */
export async function clearDeviceDrafts(userId?: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  if (userId) {
    await drop(draftsDbName(userId));
    return;
  }
  const names = new Set<string>([LEGACY_DB, ...handles.keys()]);
  try {
    for (const n of JSON.parse(localStorage.getItem(REGISTRY) ?? "[]") as string[]) if (typeof n === "string" && n.startsWith(PREFIX)) names.add(n);
  } catch {
    /* storage blocked */
  }
  try {
    for (const d of (await indexedDB.databases?.()) ?? []) if (d.name && (d.name === LEGACY_DB || d.name.startsWith(PREFIX))) names.add(d.name);
  } catch {
    /* not supported */
  }
  await Promise.all([...names].map(drop));
  lastUser = null;
  legacyCount = null;
  try {
    localStorage.removeItem(REGISTRY);
  } catch {
    /* storage blocked */
  }
}

/* -------- Pre-Phase-2 names, kept until every caller passes a user (openDrafts). -------- */
/* They act for the account last opened in this tab, and keep nothing when there is none:  */
/* without an owner there is no safe database to read.                                       */

const legacy = () => (lastUser ? openDrafts(lastUser) : null);
/** @deprecated use openDrafts(userId).list() */
export const listDeviceDrafts = async (): Promise<DeviceDraft[]> => (await legacy()?.list()) ?? [];
/** @deprecated use openDrafts(userId).get() */
export const getDeviceDraft = async (id: string) => (await legacy()?.get(id)) ?? null;
/** @deprecated use openDrafts(userId).findByPost() */
export const findDeviceDraftByPost = async (postId: string) => (await legacy()?.findByPost(postId)) ?? null;
/** @deprecated use openDrafts(userId).remove() */
export const removeDeviceDraft = async (id: string) => void (await legacy()?.remove(id));
/** @deprecated use openDrafts(userId).save() */
export const saveDeviceDraft = async (d: DeviceDraftInput, video?: File | null) => (await legacy()?.save(d, video)) ?? false;

export function ago(ms: number, now = Date.now()) {
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

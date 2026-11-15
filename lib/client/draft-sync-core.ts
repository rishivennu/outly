/**
 * The pure half of draft sync (lib/client/draft-sync.ts): the status a draft shows, the request it sends,
 * how an error is treated, the retry timing and the single-flight runner. No React, no IndexedDB, no fetch,
 * so every rule here is tested directly (tests/p2-offline-core.test.ts).
 */

export type SyncStatus = "online" | "offline" | "saving" | "waiting" | "synced" | "failed" | "conflict";

export const SYNC_LABEL: Record<SyncStatus, string> = {
  online: "Online",
  offline: "Offline",
  saving: "Saving locally",
  waiting: "Waiting to sync",
  synced: "Sync completed",
  failed: "Sync failed",
  conflict: "Conflict",
};

export interface SyncFacts {
  online: boolean;
  /** A local write is under way. */
  saving: boolean;
  /** Local changes the server does not have yet (or a request carrying them is in flight). */
  dirty: boolean;
  conflict: boolean;
  /** The last attempt failed and nothing has succeeded since. */
  failed: boolean;
  lastSyncedAt: number | null;
}

export function deriveStatus(f: SyncFacts): SyncStatus {
  if (f.conflict) return "conflict";
  if (f.saving) return "saving";
  if (f.dirty) return f.failed && f.online ? "failed" : "waiting";
  if (f.failed) return "failed";
  if (!f.online) return "offline";
  return f.lastSyncedAt ? "synced" : "online";
}

/** Exponential, capped, with jitter so many tabs coming back online never retry in lockstep. */
export function backoffMs(attempt: number, base = 2_000, max = 60_000, rand: () => number = Math.random) {
  const n = Math.max(0, Math.min(attempt, 20));
  const raw = Math.min(max, base * 2 ** n);
  return Math.round(raw * (0.75 + rand() * 0.5));
}
/** After this many failed tries in a row the runner waits for the network to come back, or for Retry. */
export const MAX_AUTO_TRIES = 6;

const CLIENT_KEY = /^[A-Za-z0-9_-]{1,64}$/;
export const isClientKey = (k: unknown): k is string => typeof k === "string" && CLIENT_KEY.test(k);
/** A key for POST /api/posts dedupe, from the device draft id when it already fits the server's rule. */
export function clientKeyFor(id: string, fresh: () => string = () => `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`) {
  const k = id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return isClientKey(k) ? k : fresh();
}

/**
 * Keys a sync request may never carry: sync only saves a draft. Scheduling or launching goes through the
 * explicit Launch flow (PATCH with scheduledAt on a failed post would even relaunch it).
 */
const NEVER_SENT = ["scheduledAt", "mode", "confirmed", "launch", "publish", "publishAt", "status", "requireApproval", "clientKey", "baseUpdatedAt", "postId"] as const;

export interface SyncRequest {
  url: string;
  method: "POST" | "PATCH";
  json: Record<string, unknown>;
}

export function buildSyncRequest(o: { postId: string | null; payload: Record<string, unknown>; clientKey: string; baseUpdatedAt: string | null }): SyncRequest {
  const json: Record<string, unknown> = { ...o.payload };
  for (const k of NEVER_SENT) delete json[k];
  if (o.postId) return { url: `/api/posts/${encodeURIComponent(o.postId)}`, method: "PATCH", json: o.baseUpdatedAt ? { ...json, baseUpdatedAt: o.baseUpdatedAt } : json };
  return { url: "/api/posts", method: "POST", json: { ...json, clientKey: o.clientKey } };
}

/**
 * Sends one sync. A PATCH whose post was deleted elsewhere (404) is sent again once as a POST with the same
 * clientKey, so the words on this device become a new draft instead of failing for good. `gone` runs first, to
 * forget the old id.
 */
export async function sendSync<T>(o: { postId: string | null; payload: Record<string, unknown>; clientKey: string; baseUpdatedAt: string | null; call: (r: SyncRequest) => Promise<T>; gone: () => Promise<unknown> | void }): Promise<{ result: T; recreated: boolean }> {
  const first = buildSyncRequest(o);
  try {
    return { result: await o.call(first), recreated: false };
  } catch (e) {
    if (first.method !== "PATCH" || (e as { status?: unknown } | null)?.status !== 404) throw e;
    await o.gone();
    return { result: await o.call(buildSyncRequest({ ...o, postId: null, baseUpdatedAt: null })), recreated: true };
  }
}

export type SyncErrorKind = "conflict" | "retry" | "fatal";

/** Anything shaped like lib/client/api's ApiError. A thrown non-HTTP error (fetch's TypeError) means no network. */
export function classifySyncError(e: unknown): { kind: SyncErrorKind; message: string; server?: unknown } {
  const err = e as { status?: unknown; code?: unknown; message?: unknown; data?: { server?: unknown } } | null;
  const status = typeof err?.status === "number" ? err.status : 0;
  const message = typeof err?.message === "string" && status ? err.message : "Couldn't reach Outlly.";
  if (status === 409 && err?.code === "draft_conflict") return { kind: "conflict", message: "This draft changed on another device.", server: err.data?.server };
  if (!status || status === 408 || status === 425 || status === 429 || status >= 500) return { kind: "retry", message };
  return { kind: "fatal", message };
}

export interface ServerTarget {
  platform: string;
  socialAccountId?: string | null;
  title?: string | null;
  caption?: string | null;
  description?: string | null;
  hashtags?: string | null;
  firstComment?: string | null;
  enabled?: boolean;
}
export interface ServerDraft {
  id: string;
  title?: string | null;
  story?: string | null;
  hook?: string | null;
  updatedAt: string;
  targets?: ServerTarget[];
}
/** The local side, in the same words: what the editor holds right now. */
export interface LocalDraft {
  title?: string | null;
  story?: string | null;
  hook?: string | null;
  targets?: Record<string, Partial<Omit<ServerTarget, "platform">>> | ServerTarget[];
}

export interface FieldDiff {
  key: string;
  label: string;
  platform: string | null;
  mine: string;
  theirs: string;
}

const TOP: [keyof LocalDraft & keyof ServerDraft, string][] = [
  ["title", "Title"],
  ["story", "Story"],
  ["hook", "Hook"],
];
const TARGET: [keyof ServerTarget, string][] = [
  ["enabled", "Posting here"],
  ["title", "Title"],
  ["caption", "Caption"],
  ["description", "Description"],
  ["hashtags", "Hashtags"],
  ["firstComment", "First comment"],
];

const text = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "boolean" ? (v ? "On" : "Off") : String(v));
const same = (a: unknown, b: unknown) => text(a).trim() === text(b).trim();

function targetMap(t: LocalDraft["targets"] | ServerTarget[] | undefined) {
  const out: Record<string, Partial<ServerTarget>> = {};
  if (Array.isArray(t)) for (const x of t) out[x.platform] = x;
  else if (t) for (const [p, x] of Object.entries(t)) out[p] = x;
  return out;
}

/**
 * Every field the two versions disagree on, so the conflict dialog shows exactly what each choice keeps.
 * A field only one side has an opinion on (undefined locally) is not a disagreement.
 */
export function diffDrafts(local: LocalDraft, server: ServerDraft, names: (platform: string) => string = (p) => p): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const [k, label] of TOP) {
    if (local[k] === undefined) continue;
    if (!same(local[k], server[k])) out.push({ key: k, label, platform: null, mine: text(local[k]), theirs: text(server[k]) });
  }
  const mine = targetMap(local.targets);
  const theirs = targetMap(server.targets);
  for (const p of Object.keys({ ...mine, ...theirs }).sort()) {
    const a = mine[p];
    const b = theirs[p] ?? {};
    if (!a) continue;
    for (const [k, label] of TARGET) {
      if (a[k] === undefined) continue;
      if (!same(a[k], b[k])) out.push({ key: `${p}.${k}`, label: `${names(p)} ${label.toLowerCase()}`, platform: p, mine: text(a[k]), theirs: text(b[k]) });
    }
  }
  return out;
}

/** A local record worth keeping: the shape the editor can open again. */
export function isValidLocal(d: unknown): d is { id: string; updatedAt: number } {
  const x = d as { id?: unknown; updatedAt?: unknown; targets?: unknown } | null;
  return !!x && typeof x.id === "string" && !!x.id && typeof x.updatedAt === "number" && Number.isFinite(x.updatedAt) && typeof x.targets === "object" && x.targets !== null;
}
/** Two local copies of one draft (two tabs, an old copy): the latest valid change wins. */
export function latestValid<T extends { updatedAt: number }>(copies: (T | null | undefined)[]): T | null {
  let best: T | null = null;
  for (const c of copies) if (isValidLocal(c) && (!best || c.updatedAt > best.updatedAt)) best = c;
  return best;
}

/* ---------------- single-flight runner ---------------- */

export type SendOutcome =
  | { kind: "ok" }
  /** Not ready to go up yet (no video uploaded): stays local, no retry until the next change. */
  | { kind: "skip" }
  | { kind: "conflict"; server: unknown }
  | { kind: "retry"; error: string }
  | { kind: "fatal"; error: string };

export interface RunnerState {
  inFlight: boolean;
  /** Bumped by every local change. */
  version: number;
  /** The version the server last confirmed. */
  syncedVersion: number;
  attempt: number;
  failed: boolean;
  conflict: boolean;
  error: string | null;
  lastSyncedAt: number | null;
  /** When the next automatic try is due, if one is. */
  nextAt: number | null;
  /** The last try found nothing sendable yet (no uploaded video): the change waits on this device. */
  blocked: boolean;
}

export interface RunnerDeps {
  send: () => Promise<SendOutcome>;
  isOnline: () => boolean;
  onChange: (s: Readonly<RunnerState>) => void;
  onConflict?: (server: unknown) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  backoff?: (attempt: number) => number;
}

/**
 * One request at a time. A change during a request is sent right after it, with the newest payload
 * (send() reads it when it runs), so the latest change always lands last. Never runs offline.
 */
export function createSyncRunner(deps: RunnerDeps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const backoff = deps.backoff ?? ((a) => backoffMs(a));
  const s: RunnerState = { inFlight: false, version: 0, syncedVersion: 0, attempt: 0, failed: false, conflict: false, error: null, lastSyncedAt: null, nextAt: null, blocked: false };
  let timer: unknown = null;
  let again = false;
  let disposed = false;
  /** Another writer (the Save draft button) holds the post: nothing is sent until it lets go. */
  let held = 0;
  let current: Promise<void> | null = null;

  const emit = () => {
    if (!disposed) deps.onChange({ ...s });
  };
  const dirty = () => s.version > s.syncedVersion;
  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    s.nextAt = null;
  };
  const later = (ms: number) => {
    cancelTimer();
    s.nextAt = now() + ms;
    timer = setTimer(() => {
      timer = null;
      s.nextAt = null;
      void run();
    }, ms);
  };

  async function run(): Promise<void> {
    if (disposed || s.conflict || !dirty() || !deps.isOnline() || held) return emit();
    if (s.inFlight) {
      again = true;
      return current ?? undefined;
    }
    cancelTimer();
    const sending = s.version;
    s.inFlight = true;
    again = false;
    emit();
    const flight = (async () => {
      let out: SendOutcome;
      try {
        out = await deps.send();
      } catch (e) {
        out = { kind: "retry", error: e instanceof Error ? e.message : "Couldn't reach Outlly." };
      }
      s.inFlight = false;
      if (disposed) return;
      s.blocked = out.kind === "skip";
      if (out.kind === "ok") {
        s.syncedVersion = Math.max(s.syncedVersion, sending);
        s.attempt = 0;
        s.failed = false;
        s.error = null;
        s.lastSyncedAt = now();
      } else if (out.kind === "conflict") {
        s.conflict = true;
        s.error = null;
        again = false;
        emit();
        deps.onConflict?.(out.server);
        return;
      } else if (out.kind === "retry") {
        s.failed = true;
        s.error = out.error;
        s.attempt += 1;
        if (s.attempt < MAX_AUTO_TRIES && !again) later(backoff(s.attempt - 1));
      } else if (out.kind === "fatal") {
        s.failed = true;
        s.error = out.error;
        again = false;
      } else {
        // Nothing was tried, so an older failure no longer describes this copy.
        s.failed = false;
        s.error = null;
      }
      emit();
      if (again && !s.conflict) {
        again = false;
        await run();
      }
    })();
    current = flight;
    await flight;
    if (current === flight) current = null;
  }

  return {
    get state(): Readonly<RunnerState> {
      return { ...s };
    },
    /** A local change happened. Sends after `delayMs` (debounce), or right away. */
    change(delayMs = 0) {
      s.version += 1;
      if (s.failed && s.attempt >= MAX_AUTO_TRIES) s.attempt = 0;
      if (s.inFlight) again = true;
      else if (deps.isOnline() && !s.conflict) later(delayMs);
      emit();
    },
    /** Send now if there is anything to send. */
    flush: () => run(),
    /** The Retry button: clears the failure count and tries at once. */
    retry() {
      s.attempt = 0;
      s.failed = s.failed && dirty();
      return run();
    },
    /** Connectivity came back: a fresh round of tries. */
    online() {
      s.attempt = 0;
      return run();
    },
    offline() {
      cancelTimer();
      emit();
    },
    /**
     * The server copy the user chose to keep, or a save made elsewhere. `upTo` = the last change that save
     * carried: anything newer is still pending and goes up next.
     */
    settle(at = now(), upTo?: number) {
      cancelTimer();
      s.syncedVersion = Math.max(s.syncedVersion, upTo ?? s.version);
      s.conflict = false;
      s.failed = false;
      s.blocked = false;
      s.error = null;
      s.attempt = 0;
      s.lastSyncedAt = at;
      if (dirty() && !held && deps.isOnline()) later(0);
      emit();
    },
    /**
     * Runs another write to the same post (the Save draft button) with the runner out of the way: it waits
     * for a request in flight and sends nothing until `fn` is done, so the two never race each other.
     */
    async exclusive<T>(fn: () => Promise<T>): Promise<T> {
      held += 1;
      cancelTimer();
      try {
        while (current) {
          const c = current;
          await c;
          if (current === c) break;
        }
        return await fn();
      } finally {
        held -= 1;
        if (!held && !disposed) {
          if (dirty() && !s.conflict && deps.isOnline()) later(0);
          else emit();
        }
      }
    },
    /** "Keep mine": the conflict is resolved in favour of this device, so send again. */
    resolveMine() {
      s.conflict = false;
      s.attempt = 0;
      if (!dirty()) s.version += 1;
      return run();
    },
    /** Nothing changes server-side, but the copy here is marked as not yet sendable. */
    skip() {
      emit();
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
    isDirty: dirty,
  };
}
export type SyncRunner = ReturnType<typeof createSyncRunner>;

/* ---------------- app-wide signal (Connectivity banner) ---------------- */

export interface DraftSyncSignal {
  status: SyncStatus | null;
  /** True while a draft has changes the server does not have. */
  pending: boolean;
}
let signal: DraftSyncSignal = { status: null, pending: false };
const listeners = new Set<() => void>();
export const draftSyncSignal = {
  get: () => signal,
  set(next: DraftSyncSignal) {
    if (next.status === signal.status && next.pending === signal.pending) return;
    signal = next;
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

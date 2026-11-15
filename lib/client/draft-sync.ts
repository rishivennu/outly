"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { openDrafts } from "@/lib/client/device-drafts";
import { useOnline } from "@/lib/client/use-online";
import { classifySyncError, clientKeyFor, createSyncRunner, deriveStatus, draftSyncSignal, type RunnerState, type SendOutcome, type ServerDraft, type SyncRunner, type SyncStatus, sendSync } from "./draft-sync-core";

export type { SyncStatus, ServerDraft };

/** Quiet time after the last local change before it goes up. */
const SYNC_DEBOUNCE_MS = 1_500;

export interface DraftSyncOptions {
  userId: string;
  /** The device draft id (lib/client/device-drafts), null before there is one. */
  draftKey: string | null;
  postId: string | null;
  /** The server payload for the draft as it is now (title, story, hook, targets, mediaId...), or null while it can't go up yet (no uploaded video). */
  getPayload: () => object | null;
  /** `recreated`: the server copy had been deleted elsewhere, so this device's copy was saved as a new draft. */
  onSynced: (post: { id: string; updatedAt: string; recreated?: boolean }) => void;
  onConflict: (server: ServerDraft) => void;
  /** The server copy is gone (deleted on another device): forget its id before the copy here is saved again. */
  onGone?: () => void;
  /** The server copy's updatedAt the editor opened with. */
  baseUpdatedAt?: string | null;
}

const IDLE: RunnerState = { inFlight: false, version: 0, syncedVersion: 0, attempt: 0, failed: false, conflict: false, error: null, lastSyncedAt: null, nextAt: null, blocked: false };

/**
 * Keeps a draft's server copy in step with the copy in this browser: single-flight, exponential backoff,
 * sends as soon as the connection is back, dedupes creates by clientKey and detects edits made elsewhere by
 * baseUpdatedAt. Only ever saves a draft: it never schedules, launches or publishes.
 */
export function useDraftSync(opts: DraftSyncOptions) {
  const online = useOnline();
  const o = useRef(opts);
  o.current = opts;
  const store = useMemo(() => openDrafts(opts.userId), [opts.userId]);
  const postId = useRef<string | null>(opts.postId);
  const base = useRef<string | null>(opts.baseUpdatedAt ?? null);
  const key = useRef<string | null>(null);
  const [rs, setRs] = useState<RunnerState>(IDLE);
  const [saving, setSaving] = useState(0);
  /** Whether the last local write really reached IndexedDB (private windows and full disks keep nothing). null = not known yet. */
  const [storedHere, setStoredHere] = useState<boolean | null>(null);
  const runner = useRef<SyncRunner | null>(null);

  if (opts.postId && opts.postId !== postId.current) postId.current = opts.postId;
  if (opts.baseUpdatedAt && opts.baseUpdatedAt !== base.current && !runner.current?.isDirty()) base.current = opts.baseUpdatedAt;

  useEffect(() => {
    let alive = true;
    // A different device draft has its own clientKey.
    key.current = null;
    const send = async (): Promise<SendOutcome> => {
      const payload = o.current.getPayload() as Record<string, unknown> | null;
      const id = o.current.draftKey;
      const rec = id ? (await store.peek(id)) ?? null : null;
      if (!payload) {
        if (id && rec) await store.update(id, { syncState: "local" });
        return { kind: "skip" };
      }
      key.current ??= rec?.clientKey ?? clientKeyFor(id ?? `k_${Date.now().toString(36)}`);
      try {
        const { result: r, recreated } = await sendSync({
          postId: postId.current ?? rec?.postId ?? null,
          payload,
          clientKey: key.current,
          baseUpdatedAt: base.current ?? rec?.baseUpdatedAt ?? null,
          call: (req) => api<{ post: { id: string; updatedAt: string } }>(req.url, { method: req.method, json: req.json }),
          // Deleted on another device: the words here are the only copy left, so they go up as a new draft.
          gone: async () => {
            postId.current = null;
            base.current = null;
            if (id) await store.update(id, { postId: null, baseUpdatedAt: null });
            if (alive) o.current.onGone?.();
          },
        });
        if (!alive) return { kind: "ok" };
        postId.current = r.post.id;
        base.current = r.post.updatedAt;
        if (id) await store.update(id, { postId: r.post.id, syncState: "synced", baseUpdatedAt: r.post.updatedAt }, rec?.updatedAt);
        o.current.onSynced({ id: r.post.id, updatedAt: r.post.updatedAt, ...(recreated ? { recreated } : {}) });
        return { kind: "ok" };
      } catch (e) {
        const c = classifySyncError(e);
        if (id) await store.update(id, { syncState: c.kind === "conflict" ? "conflict" : "failed" });
        if (c.kind === "conflict") return { kind: "conflict", server: c.server };
        return { kind: c.kind, error: c.message };
      }
    };
    const r = createSyncRunner({
      send,
      isOnline: () => navigator.onLine,
      onChange: (s) => alive && setRs(s),
      onConflict: (server) => alive && o.current.onConflict(server as ServerDraft),
    });
    runner.current = r;
    setRs(r.state);
    // A change from an earlier visit that never made it up goes now.
    const id = o.current.draftKey;
    if (id)
      void store.peek(id).then((rec) => {
        if (!alive || !rec) return;
        if (rec.baseUpdatedAt && !base.current) base.current = rec.baseUpdatedAt;
        setStoredHere(true);
        if (rec.syncState === "pending" || rec.syncState === "failed") r.change(0);
      });
    return () => {
      alive = false;
      r.dispose();
      if (runner.current === r) runner.current = null;
    };
  }, [store, opts.draftKey]);

  useEffect(() => {
    if (online) void runner.current?.online();
    else runner.current?.offline();
  }, [online]);

  const dirty = rs.version > rs.syncedVersion || rs.inFlight;
  const status: SyncStatus = deriveStatus({ online, saving: saving > 0, dirty, conflict: rs.conflict, failed: rs.failed, lastSyncedAt: rs.lastSyncedAt });

  useEffect(() => {
    draftSyncSignal.set({ status, pending: dirty || rs.conflict });
  }, [status, dirty, rs.conflict]);
  useEffect(() => () => draftSyncSignal.set({ status: null, pending: false }), []);

  /** Call after each local save (pass its promise to show "Saving locally" until it lands). */
  const saveLocal = useCallback((done?: Promise<unknown>) => {
    if (done) {
      setSaving((n) => n + 1);
      void done.then(
        (ok) => typeof ok === "boolean" && setStoredHere(ok),
        () => setStoredHere(false),
      ).finally(() => {
        setSaving((n) => Math.max(0, n - 1));
        runner.current?.change(SYNC_DEBOUNCE_MS);
      });
    } else runner.current?.change(SYNC_DEBOUNCE_MS);
  }, []);
  const syncNow = useCallback(async () => {
    const r = runner.current;
    if (!r) return;
    if (!r.isDirty()) r.change(0);
    await r.flush();
  }, []);
  const retry = useCallback(() => void runner.current?.retry(), []);
  /** The latest local change so far: pass it to markSynced for a save that carries exactly what is in the editor now. */
  const version = useCallback(() => runner.current?.state.version ?? 0, []);
  /** Another write to this post (Save draft): the runner waits for it and never sends alongside it. */
  const exclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => (runner.current ? runner.current.exclusive(fn) : fn()), []);
  /**
   * The conflict dialog's answer. "local": this device's copy goes up over the other one. "server": the caller
   * has put the other device's copy into the editor; nothing is sent.
   */
  const resolveConflict = useCallback(
    (choice: "local" | "server", server: Pick<ServerDraft, "id" | "updatedAt">) => {
      base.current = server.updatedAt;
      postId.current = server.id;
      const id = o.current.draftKey;
      if (choice === "server") {
        if (id) void store.update(id, { syncState: "synced", baseUpdatedAt: server.updatedAt, postId: server.id });
        runner.current?.settle();
      } else void runner.current?.resolveMine();
    },
    [store],
  );
  /**
   * A save that went up some other way (the explicit Save draft button): adopt its server time as the new base.
   * `upTo` = version() when that save was asked for: a change typed while it was in flight still goes up.
   */
  const markSynced = useCallback(
    (post: { id: string; updatedAt: string }, upTo?: number) => {
      postId.current = post.id;
      base.current = post.updatedAt;
      runner.current?.settle(undefined, upTo);
      const id = o.current.draftKey;
      if (id) void store.update(id, { postId: post.id, syncState: runner.current?.isDirty() ? "pending" : "synced", baseUpdatedAt: post.updatedAt });
    },
    [store],
  );

  return { status, lastSyncedAt: rs.lastSyncedAt, error: rs.error, needsMedia: rs.blocked && dirty, storedHere, saveLocal, syncNow, retry, version, exclusive, resolveConflict, markSynced };
}

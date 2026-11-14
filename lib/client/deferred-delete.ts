/**
 * 1148: deleting with Undo, without a schema change. The item leaves the screen at once and the real DELETE
 * waits until the Undo toast goes (timed out or dismissed). Undo puts it back and nothing is sent. If the page is
 * closed first, `flushAll` sends what is pending with fetch keepalive, so a delete the creator meant still happens.
 */
export type DeferredJob = {
  /** Sends the delete. A throw puts the item back (restore) and calls onFail. */
  commit: () => Promise<unknown>;
  /** The same delete, fire-and-forget, for a page that is closing (fetch keepalive). */
  flush: () => void;
  /** Puts the item back on screen. */
  restore: () => void;
  onFail?: (e: unknown) => void;
  onDone?: () => void;
};

export function deferredQueue() {
  const jobs = new Map<string, DeferredJob>();
  const commit = async (key: string): Promise<boolean> => {
    const j = jobs.get(key);
    if (!j) return false;
    jobs.delete(key);
    try {
      await j.commit();
    } catch (e) {
      j.restore();
      j.onFail?.(e);
      return false;
    }
    j.onDone?.();
    return true;
  };
  return {
    /** A second delete of the same key while one waits: the first one is sent now, so nothing is lost. */
    add(key: string, job: DeferredJob) {
      if (jobs.has(key)) void commit(key);
      jobs.set(key, job);
    },
    /** true if it was still waiting (and is now back); false if it was already sent. */
    undo(key: string) {
      const j = jobs.get(key);
      if (!j) return false;
      jobs.delete(key);
      j.restore();
      return true;
    },
    commit,
    flushAll() {
      for (const [k, j] of [...jobs]) {
        jobs.delete(k);
        try {
          j.flush();
        } catch {}
      }
    },
    has: (key: string) => jobs.has(key),
    get size() {
      return jobs.size;
    },
  };
}
export type DeferredQueue = ReturnType<typeof deferredQueue>;

/** A scheduled post this close to its time could go out while the Undo toast is up, so it is deleted at once. */
export const UNDO_SAFE_MS = 10 * 60_000;

type Target = { status: string; platformPostId: string | null; removeMode: string | null };
const live = (t: Target) => t.status === "published" && !!t.platformPostId && t.removeMode !== "deleted";

/**
 * Which post deletes wait for the Undo toast: only a studio removal of something that is on no platform (a draft,
 * a failed post that never went live, a scheduled one not due soon). Anything live ("delete everywhere", "studio
 * only") or mid-send is deleted at once behind its confirm step: a platform delete can't be called back.
 */
export function undoablePost(p: { status: string; scheduledAt: string | null; targets: Target[] }, now = Date.now()) {
  if (p.targets.some(live) || p.targets.some((t) => ["queued", "uploading", "processing"].includes(t.status))) return false;
  if (p.status === "draft" || p.status === "failed") return true;
  if (p.status === "scheduled") return !!p.scheduledAt && new Date(p.scheduledAt).getTime() - now > UNDO_SAFE_MS;
  return false;
}

/** Back where it was: same index if the list did not move on, else as close as it can, never twice. */
export function reinsert<T extends { id: string }>(list: T[], item: T, index: number): T[] {
  if (list.some((x) => x.id === item.id)) return list;
  const at = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

/** A delete that outlives the page (pagehide). Same-origin, so the session cookie and Origin header go with it. */
export function keepaliveDelete(url: string, body?: unknown) {
  if (typeof fetch === "undefined") return;
  void fetch(url, {
    method: "DELETE",
    keepalive: true,
    credentials: "same-origin",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  }).catch(() => {});
}

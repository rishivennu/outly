"use client";

export class ApiError extends Error {
  /** `data` = the whole error body, for routes that send more than a message (e.g. the post's new state). */
  constructor(public status: number, message: string, public code?: string, public data?: Record<string, unknown>) {
    super(message);
  }
}

export const UPGRADE_EVENT = "outlly:upgrade";
export type UpgradeDetail = { message: string; feature?: string };

/** Opens the global "Upgrade to post more" popup (UpgradeDialog in the studio layout). */
export function offerUpgrade(message: string, feature?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<UpgradeDetail>(UPGRADE_EVENT, { detail: { message, feature } }));
}

/** Any 402 PLAN_LIMIT from the server opens the upgrade popup; the caller still gets the error. */
function planLimit(status: number, data: { error?: string; code?: string; feature?: string }) {
  if (status === 402 && data.code === "PLAN_LIMIT" && data.error) offerUpgrade(data.error, data.feature);
}

/*
 * Short-lived memory of GET answers (1039), so a tab can be warmed before it is opened and opened
 * again without waiting. In memory only: a reload, sign-out or another browser starts empty.
 * Any change sent through api() (POST, PATCH, DELETE: a profile switch, a disconnect, a new review)
 * forgets everything, so a cached answer never outlives the thing that changed it.
 */
const memo = new Map<string, { at: number; p: Promise<unknown> }>();

/** The same GET as api(), shared with anyone who asked for it in the last `maxAge` ms (in flight included). */
export function cachedApi<T>(url: string, maxAge = 60_000): Promise<T> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < maxAge) return hit.p as Promise<T>;
  const p = api<T>(url);
  memo.set(url, { at: Date.now(), p });
  // A failure is never remembered: the next ask tries again.
  p.catch(() => memo.get(url)?.p === p && memo.delete(url));
  return p;
}

/**
 * Stale-while-revalidate: hand over what is remembered (up to `keep` ms old) at once, then, if it is
 * older than `fresh` ms, fetch again and hand that over too. Throws only when nothing could be shown.
 */
export async function swrApi<T>(url: string, show: (d: T) => void, { fresh = 30_000, keep = 5 * 60_000 } = {}) {
  const hit = memo.get(url);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < keep) {
    const d = await (hit.p as Promise<T>).catch(() => null);
    if (d) {
      show(d);
      if (age < fresh) return;
      return cachedApi<T>(url, 0).then(show, () => {}); // keep showing the older numbers if this fails
    }
  }
  show(await cachedApi<T>(url, 0));
}

/** Forget remembered answers: all of them, or those whose URL starts with `prefix`. */
export function forgetCached(prefix?: string) {
  if (!prefix) return memo.clear();
  for (const k of Array.from(memo.keys())) if (k.startsWith(prefix)) memo.delete(k);
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const writes = (rest.method ?? "GET").toUpperCase() !== "GET";
  if (writes) memo.clear();
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  // Again once the change has landed, so a warm-up that ran meanwhile cannot keep the old answer.
  if (writes) memo.clear();
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth")) {
    window.location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!res.ok) {
    planLimit(res.status, data);
    throw new ApiError(res.status, data.error ?? "Something got in the way.", data.code, data);
  }
  return data as T;
}

/** Streams a file with real progress (fetch has no upload progress). */
export function uploadWithProgress<T>(url: string, file: File, onProgress: (p: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("content-type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { error?: string; code?: string; feature?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else {
        planLimit(xhr.status, data);
        reject(new ApiError(xhr.status, data.error ?? "Something got in the way.", data.code));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "We lost the connection. Let's try again."));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

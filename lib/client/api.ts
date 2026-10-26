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

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
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

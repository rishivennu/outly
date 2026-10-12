"use client";
import { ApiError } from "./api";

/** Same as api(), but an expired admin session goes back to the admin sign-in, not the customer one. */
export async function adminApi<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !url.includes("/api/admin/login") && !url.includes("/api/admin/password")) {
    window.location.href = `/admin/login?next=${encodeURIComponent(location.pathname)}`;
  }
  if (!res.ok) throw Object.assign(new ApiError(res.status, data.error ?? "Something got in the way.", data.code), { data });
  return data as T;
}

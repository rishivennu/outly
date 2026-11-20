// R1264: the maintenance page must answer 503 + Retry-After, or search engines index it as the real page.
// Pure helpers for middleware.ts (a rewrite cannot change the rewritten page's status, so middleware serves the page itself).

export function wantsHtml(method: string, accept: string | null | undefined) {
  if (method !== "GET" && method !== "HEAD") return false;
  const a = (accept ?? "").trim().toLowerCase();
  return !a || a.includes("text/html") || a.includes("*/*");
}

const RETRY_DEFAULT = 300;
const RETRY_MIN = 60;
const RETRY_MAX = 3600;

export function retryAfterSeconds(endsAt: string | null | undefined, now = Date.now()) {
  const t = endsAt ? Date.parse(endsAt) : NaN;
  if (!Number.isFinite(t) || t <= now) return RETRY_DEFAULT;
  return Math.min(RETRY_MAX, Math.max(RETRY_MIN, Math.ceil((t - now) / 1000)));
}

// Hop-by-hop and body-framing headers belong to the inner fetch, not to our answer; set-cookie belongs to the
// inner request (made by the server), so a stranger must never receive it.
const DROP = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "set-cookie"]);

export function wrapHeaders(inner: Headers, retryAfter: number) {
  const out = new Headers();
  inner.forEach((v, k) => {
    if (!DROP.has(k.toLowerCase())) out.append(k, v);
  });
  out.set("retry-after", String(retryAfter));
  out.set("cache-control", "no-store");
  return out;
}

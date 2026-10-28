/**
 * Content Security Policy (1033: enforced). Scripts run only if they carry this request's nonce, or were
 * loaded by one that does ('strict-dynamic': Next's chunks, Razorpay's checkout). An injected <script> or
 * inline handler has no nonce, so it doesn't run. 'unsafe-inline' and https: are only fallbacks for
 * browsers too old for nonces; every current browser ignores them once a nonce is present.
 * Edge-safe: no Node imports, middleware builds it on every page request.
 */
export const CSP_REPORT_PATH = "/api/csp-report";

export function newNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

export function buildCsp(nonce: string, dev = process.env.NODE_ENV !== "production") {
  return [
    "default-src 'self'",
    // Dev only: React Refresh evaluates modules with eval.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    // Framer Motion, Next's font and route styles write inline style attributes; styles can't run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data: https://checkout.razorpay.com",
    // Direct uploads go to the storage bucket, sign-in to Supabase, live updates over wss.
    "connect-src 'self' https: wss:",
    "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://www.youtube.com https://www.youtube-nocookie.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Forms only post back to us (form-action has no default-src fallback).
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
    `report-uri ${CSP_REPORT_PATH}`,
    "report-to csp",
  ].join("; ");
}

/**
 * Where to send someone after sign-in, a notification tap or an app hand-off. Only a path on this
 * site passes. Safe in client and server code (no server-only imports).
 *
 * Blocks "//evil.com" and "/\evil.com" (browsers read both as another site), any control character
 * (the URL parser strips tab and newline, so "/<tab>/evil.com" turns into "//evil.com"), and
 * "javascript:" or full URLs, which never start with a single slash. The final check resolves the
 * path against a fake origin and insists it stays there, so a parser quirk we missed still fails closed.
 */
const BASE = "http://outlly.invalid";

export function sameSitePath(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2000) return null;
  if (!/^\/(?![/\\])/.test(v) || /[\u0000-\u001f\u007f]/.test(v)) return null;
  try {
    return new URL(v, BASE).origin === BASE ? v : null;
  } catch {
    return null;
  }
}

/**
 * The only places /app-auth may open in the browser: Google sign-in or an account connect. Mirrors
 * browserTarget() in lib/app-handoff.ts, so a crafted /app-auth?to= link can't send a signed-in
 * visitor anywhere else (or run a javascript: URL on this site).
 */
export function appAuthTarget(v: unknown): string | null {
  const p = sameSitePath(v);
  if (!p) return null;
  const path = new URL(p, BASE).pathname;
  return path === "/api/auth/google" || /^\/api\/accounts\/[a-z]{1,20}\/connect$/.test(path) ? p : null;
}

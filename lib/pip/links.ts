import "server-only";
import { hmac, safeEqual } from "../crypto";

/**
 * Short-lived download links for Pip (1049). The link names the documents and whose they are, and expires
 * after LINK_TTL_MS; the download route ALSO requires that same person's session, so a forwarded link is useless.
 */
export const LINK_TTL_MS = 10 * 60_000;
/** Keeps the link a few KB, under proxy request-line limits. */
export const MAX_DOCS = 100;
export type PipDoc = { kind: "inv" | "cn"; number: string };
type Claims = { u: string; d: string[]; e: number };

export function signDocs(userId: string, docs: PipDoc[], now = Date.now()) {
  const claims: Claims = { u: userId, d: docs.slice(0, MAX_DOCS).map((x) => `${x.kind}:${x.number}`), e: now + LINK_TTL_MS };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `/api/pip/file?t=${body}.${hmac(`pip-file:${body}`)}`;
}

export function readDocs(token: string, now = Date.now()): { userId: string; docs: PipDoc[] } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sig, hmac(`pip-file:${body}`))) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
    if (typeof c.u !== "string" || !Array.isArray(c.d) || typeof c.e !== "number" || c.e < now) return null;
    const docs = c.d
      .map((s) => s.split(":"))
      .filter(([k, n]) => (k === "inv" || k === "cn") && /^[A-Za-z0-9-]{3,40}$/.test(n ?? ""))
      .map(([k, n]) => ({ kind: k as PipDoc["kind"], number: n }));
    return docs.length ? { userId: c.u, docs } : null;
  } catch {
    return null;
  }
}

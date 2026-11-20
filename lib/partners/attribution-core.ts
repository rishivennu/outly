/** Pure partner-link helpers (no DB), shared by the server, the visit beacon and the tests. */
import { PARTNER_REF_COOKIE } from "./types";

export { PARTNER_REF_COOKIE };

export const PARTNER_CODE_RE = /^[a-z0-9]{4,20}$/;
export const isPartnerCode = (c: unknown): c is string => typeof c === "string" && PARTNER_CODE_RE.test(c);

/** Lowercase letters and digits from the brand name or handle, at most 18, so two digits always fit. */
export function codeBase(...candidates: (string | null | undefined)[]) {
  for (const c of candidates) {
    const s = (c ?? "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 18);
    if (s.length >= 2) return s;
  }
  return "partner";
}

export function makePartnerCode(base: string, rand: (n: number) => number, digits = 2) {
  let tail = "";
  for (let i = 0; i < digits; i++) tail += String(rand(10));
  return `${base.slice(0, 20 - digits)}${tail}`;
}

const VISITOR_RE = /^[0-9a-f-]{36}$/;

/** The ol_pref cookie holds "<code>.<visitorKey>": which link, and one random id for this visitor. */
export const partnerCookie = (code: string, visitorKey: string) => `${code}.${visitorKey}`;
export function parsePartnerCookie(raw: string | null | undefined): { code: string; visitorKey: string } | null {
  if (!raw) return null;
  const [code, visitorKey, ...rest] = raw.split(".");
  if (rest.length || !isPartnerCode(code) || !visitorKey || !VISITOR_RE.test(visitorKey)) return null;
  return { code, visitorKey };
}

/**
 * The consent cookie CookieConsent.tsx writes ("a" analytics, "m" marketing, "n" necessary). A partner visit is only
 * counted once the visitor allowed analytics or marketing; no answer yet counts as no, so the numbers may undercount.
 */
export const attributionAllowed = (consentCookie: string | null | undefined) => !!consentCookie && /[am]/.test(consentCookie);

/**
 * R1197: the one way Outlly shows a social handle. Providers do not agree on the "@": Instagram, Threads, TikTok and X
 * accounts are stored with it, the others without, and a few screens used to add one more on top ("@@justzrishi").
 * Stored values stay exactly as the provider returned them; this only shapes what a screen prints.
 *
 *   fmtHandle("justzrishi")    -> "@justzrishi"
 *   fmtHandle("@@justzrishi")  -> "@justzrishi"
 *   fmtHandle("Rishi Vennu")   -> "Rishi Vennu"   (a page or channel name with spaces is a name, not a handle)
 *   fmtHandle("a@b.com")       -> "a@b.com"       (emails and URLs are left alone)
 *   fmtHandle(null)            -> ""
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_LIKE = /^(https?:\/\/|www\.)/i;

/** The handle without any leading "@" (trimmed); "" for nothing. */
export function bareHandle(u: string | null | undefined): string {
  const v = (u ?? "").trim();
  if (!v || EMAIL.test(v) || URL_LIKE.test(v)) return v;
  return v.replace(/^@+/, "").trim();
}

/** Exactly one leading "@" for a handle; names with spaces, emails and URLs come back unchanged; "" for nothing. */
export function fmtHandle(u: string | null | undefined): string {
  const v = (u ?? "").trim();
  if (!v || EMAIL.test(v) || URL_LIKE.test(v)) return v;
  const core = bareHandle(v);
  if (!core) return "";
  return /\s/.test(core) ? core : `@${core}`;
}

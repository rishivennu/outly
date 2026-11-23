import { SUPPORT_EMAIL } from "./support";

/**
 * R1306: RFC 9116 security.txt body. The contact is the support queue with the same subject the /security page asks
 * for, so a report reaches the same place whichever route a researcher takes. Expires is the first day of the month
 * six months out: it rolls forward on its own and is never in the past, and the file still changes rarely enough to
 * cache.
 */
export function expiresAt(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 6, 1)).toISOString();
}

export function securityTxt(origin: string, now = new Date()): string {
  return [
    `Contact: mailto:${SUPPORT_EMAIL}?subject=Security%20report`,
    `Contact: ${origin}/contact`,
    `Expires: ${expiresAt(now)}`,
    "Preferred-Languages: en",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/security`,
    "",
  ].join("\n");
}

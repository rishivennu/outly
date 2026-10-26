import "server-only";
import { db } from "../db";
import { hmac, safeEqual } from "../crypto";

/**
 * 10-26b. Which email goes out from which sender, and how people opt out of the marketing ones.
 *
 * Two senders on two subdomains (mail. for account email, news. for marketing) so a spam complaint about
 * a nudge only hurts news.'s reputation and sign-in codes keep reaching the inbox. Marketing email also
 * carries List-Unsubscribe + List-Unsubscribe-Post (RFC 8058), which Gmail and Yahoo require from bulk
 * senders: it puts an "Unsubscribe" button next to our name, and pressing it POSTs to our link.
 */

/** Lists someone can leave. "weekly" flips User.weeklyReport; "news" adds an EmailOptOut row. */
export type List = "news" | "weekly";

/** Marketing kinds and the list each belongs to. Everything else is account email: always delivered, from `from`. */
export const MARKETING: Partial<Record<string, List>> = {
  nudge: "news",
  winback: "news",
  growth: "news",
  weekly_report: "weekly",
};

export const listFor = (kind: string): List | null => MARKETING[kind] ?? null;

const norm = (email: string) => email.trim().toLowerCase();
const LISTS: List[] = ["news", "weekly"];

/**
 * A link that is its own credential: whoever holds it can unsubscribe that one address from that one list,
 * nothing else. No expiry on purpose (an old email's button must still work). Signed with AUTH_SECRET.
 */
export function unsubToken(email: string, list: List): string {
  const e = norm(email);
  return `${Buffer.from(`${e}|${list}`).toString("base64url")}.${hmac(`unsub|${e}|${list}`)}`;
}

export function readUnsubToken(token: string | null | undefined): { email: string; list: List } | null {
  if (!token || token.length > 600) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let raw: string;
  try {
    raw = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const i = raw.lastIndexOf("|");
  const email = raw.slice(0, i);
  const list = raw.slice(i + 1) as List;
  if (i < 1 || !LISTS.includes(list) || !email.includes("@")) return null;
  if (!safeEqual(sig, hmac(`unsub|${email}|${list}`))) return null;
  return { email, list };
}

/** Email links must be absolute (a relative List-Unsubscribe is invalid and mail clients can't open it). */
const base = () => {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return (process.env.APP_URL || (vercel ? `https://${vercel}` : "") || "http://localhost:3040").replace(/\/$/, "");
};
/** The page a person lands on from the footer link (asks before doing anything, so link scanners can't unsubscribe). */
export const unsubPageUrl = (email: string, list: List) => `${base()}/unsubscribe?t=${unsubToken(email, list)}`;
/** The one-click endpoint mail providers POST to. */
export const unsubPostUrl = (email: string, list: List) => `${base()}/api/email/unsubscribe?t=${unsubToken(email, list)}`;

export async function optOut(email: string, list: List): Promise<void> {
  const e = norm(email);
  if (list === "weekly") {
    const r = await db.user.updateMany({ where: { email: e }, data: { weeklyReport: false } });
    // No account on that address any more (email changed since the report went out): keep a row so the
    // page can still say "unsubscribed" instead of looking broken.
    if (r.count > 0) return;
  }
  await db.emailOptOut.upsert({ where: { email_list: { email: e, list } }, create: { email: e, list }, update: {} });
}

/** Undo from the confirmation page ("I didn't mean to"). */
export async function optIn(email: string, list: List): Promise<void> {
  const e = norm(email);
  if (list === "weekly") await db.user.updateMany({ where: { email: e }, data: { weeklyReport: true } });
  await db.emailOptOut.deleteMany({ where: { email: e, list } });
}

/** True when this address has left the list this kind belongs to. Account email is never blocked. */
export async function isOptedOut(email: string, kind: string): Promise<boolean> {
  const list = listFor(kind);
  if (!list) return false;
  const e = norm(email);
  if (list === "weekly") {
    // An account's own switch (Settings) wins; the row only covers an address with no account.
    const u = await db.user.findFirst({ where: { email: e }, select: { weeklyReport: true } });
    if (u) return !u.weeklyReport;
  }
  return !!(await db.emailOptOut.findUnique({ where: { email_list: { email: e, list } }, select: { email: true } }));
}

export async function isSubscribed(email: string, list: List): Promise<boolean> {
  return !(await isOptedOut(email, list === "weekly" ? "weekly_report" : "nudge"));
}

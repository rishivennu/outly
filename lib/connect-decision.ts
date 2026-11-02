/**
 * What to do with an account a platform just handed back (1095). Pure, so every path that links an account
 * (OAuth callback, the Android app's held connect, Continue with Google) decides the same way and tests can
 * pin it without a database.
 *
 * Identity is always the platform's stable id (Instagram user_id, YouTube channel id, X user id, TikTok
 * open_id, Threads id, Facebook Page id, LinkedIn sub), never the display name.
 *
 * The rules:
 * - An account this studio has seen before (connected, waiting for a reconnect, or disconnected) is never
 *   saved silently: the creator chooses to reconnect it or to sign in with a different one. The one
 *   exception is the Reconnect button on that very account, where the choice was already made.
 * - On a plan with one account per platform, a different account never silently replaces the current one.
 * - Nothing here merges two accounts: a row is only ever updated by the account with the same stable id.
 */

export type ConnectIntent = "auto" | "new" | "reconnect";

export interface KnownAccount {
  id: string;
  platformUserId: string;
  status: string;
  username: string;
}

export type ConnectDecision =
  | { kind: "save"; replaces: KnownAccount[] }
  /** Seen before. `again`: the creator asked for a different account and the platform still returned this one. */
  | { kind: "known"; existing: KnownAccount; again: boolean; expected?: KnownAccount; replaces: KnownAccount[] }
  /** Reconnect was pressed on one account and the platform signed in as another, never seen before. */
  | { kind: "mismatch"; expected: KnownAccount; replaces: KnownAccount[] }
  /** A new account on a one-per-platform plan while another is connected. */
  | { kind: "replace"; replaces: KnownAccount[] };

export const INTENTS: readonly ConnectIntent[] = ["auto", "new", "reconnect"];

export function parseIntent(intent: string | null | undefined, add?: string | null): ConnectIntent {
  if (add === "1") return "new"; // "Add another account" always means a different one
  return INTENTS.includes(intent as ConnectIntent) ? (intent as ConnectIntent) : "auto";
}

/** Prisma cuid-style ids only, so a crafted `expect=` can't smuggle anything into a query or a URL. */
export const ACCOUNT_ID = /^[a-z0-9]{8,40}$/i;

export function decideConnect(a: { rows: KnownAccount[]; platformUserId: string; intent: ConnectIntent; expectId?: string | null; multi: boolean }): ConnectDecision {
  const match = a.rows.find((r) => r.platformUserId === a.platformUserId);
  const replaces = a.multi ? [] : a.rows.filter((r) => r.status !== "disconnected" && r.platformUserId !== a.platformUserId);
  const expected = a.intent === "reconnect" && a.expectId ? a.rows.find((r) => r.id === a.expectId) : undefined;
  if (expected) {
    if (match?.id === expected.id) return replaces.length ? { kind: "replace", replaces } : { kind: "save", replaces };
    if (!match) return { kind: "mismatch", expected, replaces };
  }
  if (match) return { kind: "known", existing: match, again: a.intent === "new", ...(expected ? { expected } : {}), replaces };
  if (replaces.length) return { kind: "replace", replaces };
  return { kind: "save", replaces };
}

/**
 * One sign-in can stand for several accounts (a Facebook login manages several Pages). "Connect a different
 * account" takes the first one this studio has never seen, then the first one not connected right now;
 * Reconnect takes the account it was pressed on. Anything else keeps the platform's first choice.
 */
export function pickIdentity<T extends { platformUserId: string }>(first: T, others: T[], rows: KnownAccount[], intent: ConnectIntent, expectId?: string | null): T {
  const all = [first, ...others];
  if (all.length === 1) return first;
  if (intent === "reconnect" && expectId) {
    const pid = rows.find((r) => r.id === expectId)?.platformUserId;
    return all.find((p) => p.platformUserId === pid) ?? first;
  }
  if (intent === "new") {
    const known = new Set(rows.map((r) => r.platformUserId));
    const active = new Set(rows.filter((r) => r.status !== "disconnected").map((r) => r.platformUserId));
    return all.find((p) => !known.has(p.platformUserId)) ?? all.find((p) => !active.has(p.platformUserId)) ?? first;
  }
  return first;
}

/**
 * Continue with Google links the channel only when nothing needs asking: a channel the creator disconnected
 * stays disconnected, and it never replaces another channel. Refreshing the same, still-connected channel is fine.
 */
export function googleMayLink(rows: KnownAccount[], channelId: string, multi: boolean) {
  const d = decideConnect({ rows, platformUserId: channelId, intent: "auto", multi });
  if (d.kind === "save") return true;
  return d.kind === "known" && d.existing.status !== "disconnected" && d.replaces.length === 0;
}

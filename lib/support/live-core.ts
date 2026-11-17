/**
 * R1184 Live Assist: the pure rules both sides share (no database, no server-only imports), so the widget,
 * the admin console and the tests all read the same states, codes and limits.
 *
 * Words used here:
 * - conversation mode: who answers right now. ai = Pip, waiting = asked for a person, human = a specialist is
 *   in the chat (Pip stays silent), resolved = a specialist closed it.
 * - session: one request for a person (SupportSession). waiting -> active -> resolved, or it ends early as
 *   cancelled (the customer went back to Pip), returned (handed back to Pip) or ticket (left a message).
 * - seq: every message in a conversation gets the next number. Both sides read in seq order, ask for "after N",
 *   and receipts are numbers too: delivered = that side fetched up to N, read = it had them on screen.
 */

export type LiveMode = "ai" | "waiting" | "human" | "resolved";
export type SessionStatus = "waiting" | "active" | "resolved" | "cancelled" | "returned" | "ticket";
/** What the customer is shown. connecting and reconnecting are added by the widget itself (request in flight, sync failing). */
export type CustomerState = "none" | "waiting" | "unavailable" | "connected" | "resolved";
export type WidgetState = CustomerState | "connecting" | "reconnecting";
export type LivePriority = "normal" | "high" | "urgent";
export type LiveCategory = "billing" | "account" | "publishing" | "technical" | "other";
export type WireRole = "user" | "pip" | "agent" | "system";

export const LIVE_PRIORITIES = ["normal", "high", "urgent"] as const satisfies readonly LivePriority[];
export const LIVE_CATEGORIES = ["billing", "account", "publishing", "technical", "other"] as const satisfies readonly LiveCategory[];
export const CATEGORY_LABEL: Record<LiveCategory, string> = { billing: "Billing", account: "Account", publishing: "Publishing", technical: "Technical", other: "Other" };
export const STATUS_WORD: Record<SessionStatus, string> = { waiting: "Waiting", active: "Active", resolved: "Resolved", cancelled: "Cancelled", returned: "Back with Pip", ticket: "Left a message" };

/** A specialist counts as online while their console checked in within this window (it does every few seconds). */
export const AGENT_ONLINE_MS = 90_000;
/** "is typing" lasts this long after the last keystroke report. */
export const TYPING_MS = 6_000;
/** The customer's browser counts as there while it checked in within this window (it polls every 2 to 15 s). */
export const CUSTOMER_ONLINE_MS = 45_000;
/** Waiting longer than this with nobody accepting: tell the customer the team is unavailable (the request stays queued). */
export const WAIT_GIVE_UP_MS = 10 * 60_000;
/** A waiting request whose browser hasn't checked in for this long is abandoned: it no longer counts toward
 *  anyone's place in line, and the sweep closes it (endedBy "system") so the queue doesn't fill with ghosts. */
export const ABANDON_MS = 30 * 60_000;
/** Place in line only counts requests whose browser checked in within this window. */
export const QUEUE_SEEN_MS = 5 * 60_000;
export const LIVE_MAX_TEXT = 2000;
export const NOTE_MAX = 2000;

/** Status lines are stored as codes (PipMessage role "system") so each side shows them in its own words and language. */
export const SYS = {
  requested: "live.requested",
  connected: "live.connected", // live.connected|<first name>
  transferred: "live.transferred", // live.transferred|<first name>
  pipBack: "live.pip_back",
  resolved: "live.resolved",
  reopened: "live.reopened", // live.reopened|<first name>
  cancelled: "live.cancelled",
  customerLeft: "live.customer_left",
  ticket: "live.ticket", // live.ticket|<T-ref>
} as const;
export type SysCode = (typeof SYS)[keyof typeof SYS];
export const sysText = (code: SysCode, arg?: string) => (arg ? `${code}|${arg.replace(/\|/g, " ").slice(0, 60)}` : code);
export function parseSys(text: string): { code: SysCode | null; arg: string } {
  const [code, ...rest] = text.split("|");
  const known = (Object.values(SYS) as string[]).includes(code);
  return { code: known ? (code as SysCode) : null, arg: rest.join("|") };
}

/** Only the first name goes to the customer ("Priya", not "Priya Raman, Support Lead"). */
export const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0]?.slice(0, 40) || "Outlly";

/**
 * Plain text only: control characters, zero-width and bidi-override characters are removed (they can disguise
 * a link or flip what an agent sees), runs of blank lines are folded, and the length is capped. Nothing is
 * ever rendered as HTML on either side, so this is about honest display, not escaping.
 */
export function cleanText(input: unknown, max = LIVE_MAX_TEXT): string {
  if (typeof input !== "string") return "";
  return input
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, max);
}

/** A client id is ours to dedupe on, so it must look like one: 8 to 64 url-safe characters. */
export const isClientId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);

const MONEY = /\b(charged|debited|deducted|refund|double|twice|money)\b/i;
const CATS: [LiveCategory, RegExp][] = [
  ["billing", /\b(bill|billing|invoice|payment|paid|pay|charged?|refund|subscription|plan|upi|card|price|pricing|debited|deducted|money|receipt|gst|renew(al)?)\b/i],
  ["account", /\b(account|log ?in|sign ?in|password|email|otp|verify|verification|2fa|two.step|profile|team|workspace|delete)\b/i],
  ["publishing", /\b(post|posts|publish(ed|ing)?|schedul(e|ed|ing)|instagram|youtube|facebook|tiktok|linkedin|threads|reels?|videos?|upload|caption|connect|reconnect)\b/i],
  ["technical", /\b(error|bug|crash(es|ed)?|broken|not working|doesn'?t work|slow|blank|stuck|loading|fail(s|ed)?|freez(e|es|ing))\b/i],
];
/** First matching topic wins, billing first: a refund question that also mentions Instagram is a billing question. */
export function classify(texts: string[]): { category: LiveCategory; priority: LivePriority } {
  const all = texts.join(" ").slice(0, 8000);
  const category = CATS.find(([, re]) => re.test(all))?.[0] ?? "other";
  // Same rule as tickets: money leaving someone's account is urgent.
  return { category, priority: MONEY.test(all) ? "urgent" : "normal" };
}

/** What the customer sees for a session, from real rows only. Nobody online, or waiting too long = unavailable (still queued). */
export function customerState(
  s: { status: string; requestedAt: Date | string } | null,
  o: { agentsOnline: number; now?: number },
): CustomerState {
  if (!s) return "none";
  if (s.status === "active") return "connected";
  if (s.status === "resolved") return "resolved";
  if (s.status !== "waiting") return "none";
  const waited = (o.now ?? Date.now()) - new Date(s.requestedAt).getTime();
  return o.agentsOnline < 1 || waited > WAIT_GIVE_UP_MS ? "unavailable" : "waiting";
}

export type Receipt = "sending" | "failed" | "sent" | "delivered" | "read";
export function receipt(m: { seq?: number | null; pending?: boolean; failed?: boolean }, r: { delivered: number; read: number }): Receipt {
  if (m.failed) return "failed";
  if (m.pending || m.seq == null) return "sending";
  if (m.seq <= r.read) return "read";
  if (m.seq <= r.delivered) return "delivered";
  return "sent";
}

export const isTyping = (at: Date | string | null | undefined, now = Date.now()) => !!at && now - new Date(at).getTime() < TYPING_MS;
export const isOnline = (at: Date | string | null | undefined, windowMs: number, now = Date.now()) => !!at && now - new Date(at).getTime() < windowMs;

/** One message on the wire. */
export type WireMsg = { id: string; seq: number | null; role: WireRole; text: string; cid: string | null; author: string | null; at: string };

/**
 * Folds server messages into a local list without duplicates and in seq order.
 * - Same server id: already here, skipped.
 * - Same client id: our own optimistic message, now confirmed: it takes the server id and seq.
 * - Otherwise it goes before the first later message (or before our still-pending ones), else at the end.
 * Items without a seq that aren't pending are older history (written before Live Assist) and stay on top.
 */
export type LocalLive = { sid?: string; seq?: number; cid?: string; pending?: boolean };
export function mergeLive<T extends LocalLive>(list: T[], incoming: WireMsg[], make: (m: WireMsg) => T): T[] {
  let out = list.slice();
  for (const m of [...incoming].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    if (out.some((x) => x.sid === m.id)) continue;
    const mine = m.cid ? out.findIndex((x) => x.cid === m.cid) : -1;
    if (mine >= 0) {
      out[mine] = { ...out[mine], sid: m.id, seq: m.seq ?? undefined, pending: false, failed: false } as T;
      continue;
    }
    const at = out.findIndex((x) => (x.seq != null ? m.seq != null && x.seq > m.seq : !!x.pending));
    const item = make(m);
    out = at < 0 ? [...out, item] : [...out.slice(0, at), item, ...out.slice(at)];
  }
  return out;
}

/** "45 s", "3 min", "1 h 5 min": wait and response times in the console and reports. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "None yet";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 48) return r ? `${h} h ${r} min` : `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Queue order for "Priority": urgent first, then high, then the longest wait. */
const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2 };
export function byPriority<T extends { priority: string; requestedAt: string | Date }>(a: T, b: T) {
  return (PRIO_RANK[a.priority] ?? 3) - (PRIO_RANK[b.priority] ?? 3) || +new Date(a.requestedAt) - +new Date(b.requestedAt);
}

/** Midnight today in a time zone, as a Date (reports and "Resolved today" use the business day in India). */
export function startOfDay(tz = "Asia/Kolkata", now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const sinceMidnight = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnight);
}

/** The console's own words for a status line (the customer sees lib/i18n/live.ts liveSysLine instead). */
export function staffSysLine(text: string): string | null {
  const { code, arg } = parseSys(text);
  switch (code) {
    case SYS.requested:
      return "The customer asked for a specialist";
    case SYS.connected:
      return `${arg || "A specialist"} joined the chat`;
    case SYS.transferred:
      return `Transferred to ${arg || "another specialist"}`;
    case SYS.pipBack:
      return "Handed back to Pip";
    case SYS.resolved:
      return "Marked resolved";
    case SYS.reopened:
      return `${arg || "A specialist"} reopened the chat`;
    case SYS.cancelled:
      return "The customer cancelled the request";
    case SYS.customerLeft:
      return "The customer ended the chat";
    case SYS.ticket:
      return `The customer left a message${arg ? ` (${arg})` : ""}`;
    default:
      return null;
  }
}

/** The assignment history's action words, for the console. */
export const HISTORY_WORD: Record<string, string> = {
  request: "Asked for a specialist",
  accept: "Accepted",
  assign: "Assigned",
  transfer: "Transferred",
  takeover: "Took over",
  priority: "Priority changed",
  return_pip: "Handed back to Pip",
  resolve: "Resolved",
  reopen: "Reopened",
  cancel: "Ended by the customer",
  ticket: "Left a message",
};

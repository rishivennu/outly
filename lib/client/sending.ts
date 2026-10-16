import { PLATFORM_META, isPlatform, type Platform } from "@/lib/domain";

/**
 * Phase 1 (10-16g): keeping people in the loop while a post sends.
 * - A tiny event so any screen that starts or watches a send can wake the studio's sending pill.
 * - Send-time estimates measured on this device: we only ever show "usually about N min" from real,
 *   observed sends (3 or more per platform), never a made-up countdown. Platforms don't report upload %.
 * - Browser notifications, opt-in only, at most one per post.
 * The pure parts (summaries, medians) take plain data so they are unit-tested without a browser.
 */

export type SendTarget = { platform: string; status: string; errorCode?: string | null };
export const SENDING_EVENT = "outlly:sending";
const ACTIVE = ["pending", "queued", "uploading", "processing"];

const nameOf = (p: string) => (isPlatform(p) ? PLATFORM_META[p].name : p);

/** "Instagram, YouTube and X" */
export function listNames(ps: string[]) {
  const n = ps.map(nameOf);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** One line for the pill / notification: what a post amounts to right now. */
export function sendSummary(targets: SendTarget[]) {
  const live = targets.filter((t) => t.status === "published");
  const bad = targets.filter((t) => t.status === "failed");
  const active = targets.some((t) => ACTIVE.includes(t.status));
  const total = targets.length;
  if (active) {
    const tail = bad.length ? `, ${listNames(bad.map((t) => t.platform))} ${bad.length === 1 ? "needs" : "need"} a hand` : "";
    return { active, tone: bad.length ? ("bad" as const) : ("work" as const), text: `${live.length} of ${total} live${tail}` };
  }
  if (live.length === total) return { active, tone: "live" as const, text: `Live on ${listNames(live.map((t) => t.platform))}` };
  if (!live.length) return { active, tone: "bad" as const, text: bad.length && bad.every((t) => t.errorCode === "CANCELED") ? "Stopped. Nothing went out" : "Nothing went out yet" };
  return { active, tone: "bad" as const, text: `Live on ${listNames(live.map((t) => t.platform))}. ${listNames(bad.map((t) => t.platform))} ${bad.length === 1 ? "needs" : "need"} a hand` };
}

/** Tell the pill something is sending (same tab now, other tabs through storage). */
export function pingSending() {
  try {
    window.dispatchEvent(new Event(SENDING_EVENT));
    localStorage.setItem("outlly-sending-ping", String(Date.now()));
  } catch {
    /* private mode: the pill still checks on its own */
  }
}

/* ---------- send-time estimates ---------- */
const TIMES_KEY = "outlly-send-times";
const KEEP = 7;
export const MIN_SAMPLES = 3;

export function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Add one observed send (seconds) to a platform's history, newest last, capped. Pure. */
export function addSample(all: Record<string, number[]>, p: Platform, seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 6 * 3600) return all;
  return { ...all, [p]: [...(all[p] ?? []), Math.round(seconds)].slice(-KEEP) };
}

/** "about 2 min" once there are enough real samples, otherwise null. Pure. */
export function typicalLabel(samples: number[] | undefined) {
  if (!samples || samples.length < MIN_SAMPLES) return null;
  const s = median(samples)!;
  if (s < 50) return "under a minute";
  const min = Math.round(s / 60);
  return min >= 60 ? `about ${Math.round(min / 60)} h` : `about ${min} min`;
}

export function readTimes(): Record<string, number[]> {
  try {
    const v = JSON.parse(localStorage.getItem(TIMES_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
export function recordSendTime(p: Platform, seconds: number) {
  try {
    localStorage.setItem(TIMES_KEY, JSON.stringify(addSample(readTimes(), p, seconds)));
  } catch {
    /* storage full or blocked: no estimate, no harm */
  }
}

/* ---------- browser notifications (opt-in) ---------- */
const ASKED_KEY = "outlly-notify";
const SENT_KEY = "outlly-notified";

export type NotifyState = "unsupported" | "off" | "on" | "blocked";
export function notifyState(): NotifyState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission === "granted") return localStorage.getItem(ASKED_KEY) === "off" ? "off" : "on";
  return "off";
}
/** Must run from a click: browsers only show the prompt after a user gesture. */
export async function askNotify(): Promise<NotifyState> {
  if (notifyState() === "unsupported") return "unsupported";
  try {
    const r = await Notification.requestPermission();
    if (r === "granted") localStorage.setItem(ASKED_KEY, "on");
  } catch {
    /* old Safari threw on the promise form; treat as no answer */
  }
  return notifyState();
}
export function muteNotify() {
  try {
    localStorage.setItem(ASKED_KEY, "off");
  } catch {}
}

/** At most one notification per post and outcome, across tabs. Returns true if it showed one. */
export function notifyOnce(postId: string, title: string, body: string, href: string) {
  if (notifyState() !== "on") return false;
  try {
    const sent: string[] = JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]");
    const key = `${postId}:${title}`;
    if (sent.includes(key)) return false;
    localStorage.setItem(SENT_KEY, JSON.stringify([...sent, key].slice(-40)));
    const n = new Notification(title, { body, icon: "/icon.png", tag: `outlly-${postId}` });
    n.onclick = () => {
      window.focus();
      window.location.href = href;
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

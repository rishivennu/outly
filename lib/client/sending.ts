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

/* ---------- 1139: the publishing tracker (web + installed PWA) ---------- */

/**
 * What one destination is doing, in the creator's words. Mapped from the real platformStatus and error code
 * the publisher wrote; nothing here is inferred from how long something has been running.
 */
export type LiveState = "scheduled" | "queued" | "uploading" | "publishing" | "published" | "failed" | "attention";

export const LIVE_LABEL: Record<LiveState, string> = {
  scheduled: "Scheduled",
  queued: "Queued",
  uploading: "Uploading",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  attention: "Requires attention",
};

/** Codes only the creator can clear (reconnect, approve, permissions, a file a platform refuses). The rest are ours to retry. */
export const ATTENTION_CODES = ["AUTH_EXPIRED", "NOT_CONNECTED", "NEEDS_APPROVAL", "FORBIDDEN", "MEDIA_REJECTED", "DUPLICATE"] as const;

export type LiveTargetLike = { status: string; errorCode?: string | null };

export function liveState(t: LiveTargetLike, postStatus?: string | null): LiveState {
  if (t.status === "published") return "published";
  if (t.status === "failed") {
    if (t.errorCode === "CANCELED") return "failed"; // the creator stopped it: theirs to send again, not broken
    return (ATTENTION_CODES as readonly string[]).includes(t.errorCode ?? "") ? "attention" : "failed";
  }
  if (t.status === "uploading") return "uploading";
  if (t.status === "processing") return "publishing";
  // pending or queued: a post still waiting for its booked time is Scheduled, not Queued.
  return postStatus === "scheduled" && t.status === "pending" ? "scheduled" : "queued";
}

/** A destination the creator stopped themselves. The state stays Failed; the words say what really happened. */
export const stoppedByYou = (t: LiveTargetLike) => t.status === "failed" && t.errorCode === "CANCELED";

export const liveLabel = (t: LiveTargetLike, postStatus?: string | null) => (stoppedByYou(t) ? "Stopped by you" : LIVE_LABEL[liveState(t, postStatus)]);

/** The four real steps of a send. There is no fifth, and no platform reports a percentage in between. */
export const LIVE_STEPS = ["Queued", "Uploading", "Publishing", "Published"] as const;

export interface StepView {
  state: LiveState;
  total: number;
  /** How many of the four steps are finished. The bar shows exactly this, never a guess. */
  index: number;
  /** Which step it is on now, 1 to 4. */
  stepNumber: number;
  /** The step's own name, or what stopped it. */
  current: string;
  /** Finished steps over total, for the bar. 0 for anything stopped. */
  fraction: number;
  done: boolean;
  stalled: boolean;
}

/** Honest step progress: where a destination has actually got to. No time-based easing, no synthesised fill. */
export function liveStep(t: LiveTargetLike, postStatus?: string | null): StepView {
  const state = liveState(t, postStatus);
  const total = LIVE_STEPS.length;
  const stalled = state === "failed" || state === "attention";
  const index = state === "published" ? total : state === "publishing" ? 2 : state === "uploading" ? 1 : 0;
  return {
    state,
    total,
    index,
    stepNumber: Math.min(total, index + 1),
    current: stalled ? (stoppedByYou(t) ? "Stopped by you" : "Stopped") : state === "scheduled" ? "Scheduled" : LIVE_STEPS[Math.min(total - 1, index)],
    fraction: stalled ? 0 : index / total,
    done: state === "published",
    stalled,
  };
}

/** "Step 2 of 4, Uploading": the only progress wording used while no real figure exists. */
export function stepText(s: StepView) {
  if (s.state === "scheduled") return "Waiting for its time";
  if (s.stalled) return s.current;
  return `Step ${s.stepNumber} of ${s.total}, ${s.current}`;
}

/** A measured upload figure, when the server really has one. Anything missing or nonsense gives null, and the UI shows steps instead. */
export function realPercent(p?: { sent: number; total: number } | null) {
  if (!p || !Number.isFinite(p.sent) || !Number.isFinite(p.total) || p.total <= 0 || p.sent < 0) return null;
  return Math.max(0, Math.min(100, Math.round((p.sent / p.total) * 100)));
}

/** "just now", "45 sec ago", "2 min ago", "3 h ago", "yesterday". A missing or unreadable time gives null. */
export function sinceLabel(iso?: string | null, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const sec = Math.round((now - t) / 1000);
  if (sec < 20) return "just now";
  if (sec < 90) return `${sec} sec ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  return day <= 1 ? "yesterday" : `${day} days ago`;
}

export function updatedLabel(iso?: string | null, now = Date.now()) {
  const s = sinceLabel(iso, now);
  return s ? `Updated ${s}` : null;
}

/* ---------- tracker data ---------- */

export interface LiveAccount {
  name: string;
  username: string | null;
  avatar: string | null;
}
export interface LiveTarget {
  id: string;
  platform: string;
  status: string;
  errorCode: string | null;
  url: string | null;
  /** When the platform last told us something about this destination. */
  updatedAt: string | null;
  account: LiveAccount | null;
  practice: boolean;
  caption: string | null;
  /** Only ever set when the bytes are really counted. Absent today, so the UI shows steps. */
  progress?: { sent: number; total: number } | null;
}
export interface LivePost {
  id: string;
  title: string;
  caption: string | null;
  thumbnailUrl: string | null;
  format: string;
  status: string;
  updatedAt: string | null;
  targets: LiveTarget[];
}

/** The tracker's facts for every post of yours that is sending (or for one post, whatever its state). */
export async function fetchSending(postId?: string): Promise<LivePost[]> {
  const { api } = await import("./api");
  const r = await api<{ posts: LivePost[] }>(`/api/posts/sending${postId ? `?id=${encodeURIComponent(postId)}` : ""}`);
  return r.posts ?? [];
}

/** The message every open page gets from the service worker when a push lands (public/sw.js). */
export const SW_NOTICE = "outlly:notice";

/**
 * Everything that means "ask the server again": a send started in this tab or another, a push arrived on this
 * device (so something changed, possibly on another one), the tab came back, or the window took focus. The
 * caller decides what to do; this only listens. Returns the unsubscribe.
 */
export function onSendingWake(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const wake = () => cb();
  const onStorage = (e: StorageEvent) => {
    if (e.key === "outlly-sending-ping") cb();
  };
  const onBack = () => {
    if (!document.hidden) cb();
  };
  const onMessage = (e: MessageEvent) => {
    const d = e.data as { type?: string } | null;
    if (d && typeof d === "object" && d.type === SW_NOTICE) cb();
  };
  window.addEventListener(SENDING_EVENT, wake);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onBack);
  document.addEventListener("visibilitychange", onBack);
  navigator.serviceWorker?.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener(SENDING_EVENT, wake);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onBack);
    document.removeEventListener("visibilitychange", onBack);
    navigator.serviceWorker?.removeEventListener("message", onMessage);
  };
}

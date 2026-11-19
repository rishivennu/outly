/**
 * R1209: the pure half of the storage and upload quota service (lib/storage/quota.ts). No database, so the cycle
 * maths, policy rules and warning states are unit-tested and the browser can share the labels.
 *
 * Four separate figures, never interchangeable:
 *   stored     = bytes of files the account keeps right now (Trash included until it is purged)
 *   consumed   = bytes successfully uploaded this cycle (UploadLedger); deleting a file never gives it back
 *   allowance  = the most that may be uploaded this cycle (Plan.uploadMonthlyMb)
 *   capacity   = the most that may be kept (Plan.storageMb)
 */
export const MB = 1024 * 1024;

/** The Free monthly upload allowance when the plan row leaves uploadMonthlyMb empty. The admin value always wins. */
export const DEFAULT_MONTHLY_UPLOAD_MB = 2048;
/** Payments and invoices are in India, so a "calendar" cycle starts on the 1st at midnight here. */
export const BILLING_TZ = "Asia/Kolkata";
/** Files stay in Trash this long, then the daily retention job deletes them for good. */
export const TRASH_DAYS = 30;
export const WARNING_PCT = 80;
export const CRITICAL_PCT = 95;

export const QUOTA_POLICIES = ["auto", "monthly", "storage", "both"] as const;
export const CYCLE_ANCHORS = ["billing", "signup", "calendar"] as const;
export type QuotaPolicySetting = (typeof QUOTA_POLICIES)[number];
export type QuotaPolicy = Exclude<QuotaPolicySetting, "auto">;
export type CycleAnchor = (typeof CYCLE_ANCHORS)[number];
export type UsageState = "normal" | "warning" | "critical" | "full";

/** "auto": a free plan gets the monthly upload allowance, a paid plan is measured by the storage it keeps. */
export function resolvePolicy(setting: string | null | undefined, paid: boolean): QuotaPolicy {
  if (setting === "monthly" || setting === "storage" || setting === "both") return setting;
  return paid ? "storage" : "monthly";
}
export const usesMonthly = (p: QuotaPolicy) => p !== "storage";
export const usesStorage = (p: QuotaPolicy) => p !== "monthly";

export function resolveAnchor(setting: string | null | undefined): CycleAnchor {
  return setting === "signup" || setting === "calendar" ? setting : "billing";
}

/** Null = the server default; 0 = no monthly cap. Never negative. */
export function monthlyAllowanceMb(uploadMonthlyMb: number | null | undefined) {
  return uploadMonthlyMb == null ? DEFAULT_MONTHLY_UPLOAD_MB : Math.max(0, Math.floor(uploadMonthlyMb));
}

/** `anchor` moved by k months, keeping its UTC time of day. Day 31 in a 30-day month becomes the 30th. */
export function addMonthsClamped(anchor: Date, k: number) {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + k;
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(anchor.getUTCDate(), last), anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()));
}

export interface CycleWindow {
  start: Date;
  end: Date;
  key: string;
}

export const cycleKeyOf = (start: Date) => `${start.toISOString().slice(0, 16)}Z`;

/** The monthly window around `now` that starts on the anchor's day of the month. */
export function anchoredWindow(anchor: Date, now: Date): CycleWindow {
  let k = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  while (addMonthsClamped(anchor, k) > now) k--;
  while (addMonthsClamped(anchor, k + 1) <= now) k++;
  const start = addMonthsClamped(anchor, k);
  return { start, end: addMonthsClamped(anchor, k + 1), key: cycleKeyOf(start) };
}

/** Minutes `tz` is ahead of UTC at `at`. */
export function zoneOffsetMin(at: Date, tz = BILLING_TZ) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
  return Math.round((local - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Midnight on the 1st of the month `now` falls in, in the billing timezone, to the next 1st. */
export function calendarWindow(now: Date, tz = BILLING_TZ): CycleWindow {
  const local = new Date(now.getTime() + zoneOffsetMin(now, tz) * 60_000);
  const at = (y: number, m: number) => {
    const guess = new Date(Date.UTC(y, m, 1));
    return new Date(guess.getTime() - zoneOffsetMin(guess, tz) * 60_000);
  };
  const start = at(local.getUTCFullYear(), local.getUTCMonth());
  return { start, end: at(local.getUTCFullYear(), local.getUTCMonth() + 1), key: cycleKeyOf(start) };
}

/**
 * The cycle a request falls in. `billing` follows the subscription (purchase date, then each renewal); with no
 * subscription it falls back to the signup date. `previous` = the anchor before an upgrade: the first cycle of a
 * new subscription reaches back to where the old cycle started, so upgrading never resets the counter.
 */
export function cycleWindow(o: { anchor: CycleAnchor; signupAt: Date; periodStart?: Date | null; subscribedAt?: Date | null; previous?: CycleAnchor; now: Date }): CycleWindow {
  if (o.anchor === "calendar") return calendarWindow(o.now);
  if (o.anchor === "signup" || !o.subscribedAt) return anchoredWindow(o.signupAt, o.now);
  const w = anchoredWindow(o.periodStart ?? o.subscribedAt, o.now);
  if (w.start.getTime() > o.subscribedAt.getTime() + 60_000) return w;
  const before = new Date(o.subscribedAt.getTime() - 1);
  const prior = o.previous === "calendar" ? calendarWindow(before) : anchoredWindow(o.signupAt, before);
  return prior.start < w.start ? { ...w, start: prior.start } : w;
}

export function fmtBytes(bytes: number) {
  const b = Math.max(0, bytes);
  if (b >= 1024 * MB) return `${(b / (1024 * MB)).toFixed(b >= 10 * 1024 * MB ? 0 : 1).replace(/\.0$/, "")} GB`;
  if (b >= MB) return `${(b / MB).toFixed(b >= 10 * MB ? 0 : 1).replace(/\.0$/, "")} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

export const fmtDay = (d: Date | string, tz = BILLING_TZ) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date(d));

const pctOf = (used: number, cap: number) => (cap > 0 ? Math.min(100, Math.round((Math.max(0, used) / cap) * 1000) / 10) : 0);

export interface MonthlyFigures {
  usedBytes: number;
  allowanceBytes: number; // 0 = no monthly cap
  remainingBytes: number;
  reservedBytes: number;
  percent: number;
  unlimited: boolean;
  cycleKey: string;
  startedAt: string;
  resetAt: string;
}
export interface StorageFiguresR1209 {
  usedBytes: number;
  capacityBytes: number; // 0 = no cap
  availableBytes: number;
  reservedBytes: number;
  percent: number;
  unlimited: boolean;
  trashBytes: number;
}

export function monthlyFigures(used: number, reserved: number, allowance: number, w: CycleWindow): MonthlyFigures {
  const u = Math.max(0, used);
  const r = Math.max(0, reserved);
  const a = Math.max(0, allowance);
  return {
    usedBytes: u, allowanceBytes: a, reservedBytes: r, remainingBytes: a > 0 ? Math.max(0, a - u - r) : 0, percent: pctOf(u + r, a), unlimited: a === 0,
    cycleKey: w.key, startedAt: w.start.toISOString(), resetAt: w.end.toISOString(),
  };
}

export function storageFiguresOf(stored: number, reserved: number, capacity: number, trash: number): StorageFiguresR1209 {
  const s = Math.max(0, stored);
  const r = Math.max(0, reserved);
  const c = Math.max(0, capacity);
  return { usedBytes: s, capacityBytes: c, reservedBytes: r, availableBytes: c > 0 ? Math.max(0, c - s - r) : 0, percent: pctOf(s + r, c), unlimited: c === 0, trashBytes: Math.max(0, trash) };
}

/** Room left for one more upload; Infinity when nothing caps it. */
export function roomLeft(m: MonthlyFigures | null, s: StorageFiguresR1209 | null) {
  let room = Infinity;
  if (m && !m.unlimited) room = Math.min(room, m.remainingBytes);
  if (s && !s.unlimited) room = Math.min(room, s.availableBytes);
  return room;
}

export function usageState(m: MonthlyFigures | null, s: StorageFiguresR1209 | null): UsageState {
  if (roomLeft(m, s) < 1) return "full";
  const pct = Math.max(m && !m.unlimited ? m.percent : 0, s && !s.unlimited ? s.percent : 0);
  return pct >= CRITICAL_PCT ? "critical" : pct >= WARNING_PCT ? "warning" : "normal";
}

/** What the meter says under the bar. Null when there is nothing to warn about. */
export function usageMessage(m: MonthlyFigures | null, s: StorageFiguresR1209 | null, state: UsageState) {
  if (state === "normal") return null;
  const monthlyTight = m && !m.unlimited && (m.remainingBytes < 1 || m.percent >= WARNING_PCT);
  if (monthlyTight && m) {
    const day = fmtDay(m.resetAt);
    if (m.remainingBytes < 1) return `You've used your ${fmtBytes(m.allowanceBytes)} upload allowance for this month. Your allowance renews on ${day}. Upgrade your plan to unlock more upload capacity immediately.`;
    return `You've used ${fmtBytes(m.usedBytes + m.reservedBytes)} of your ${fmtBytes(m.allowanceBytes)} upload allowance this month. ${fmtBytes(m.remainingBytes)} left until ${day}.`;
  }
  if (s && !s.unlimited) {
    if (s.availableBytes < 1) return `Your storage is full: ${fmtBytes(s.usedBytes)} used of ${fmtBytes(s.capacityBytes)}. Your files are safe. Delete files you no longer need, or upgrade for more room.`;
    return `You're using ${s.percent}% of your storage: ${fmtBytes(s.availableBytes)} left of ${fmtBytes(s.capacityBytes)}.`;
  }
  return null;
}

/** Why an upload was refused, in a plain sentence the upload card can show as it is. */
export function refusal(kind: "quota_monthly" | "quota_storage", incoming: number, m: MonthlyFigures | null, s: StorageFiguresR1209 | null, planName: string) {
  if (kind === "quota_monthly" && m) {
    const day = fmtDay(m.resetAt);
    if (m.remainingBytes < 1) return `You've used your ${fmtBytes(m.allowanceBytes)} upload allowance for this month. Your allowance renews on ${day}. Upgrade your plan to unlock more upload capacity immediately.`;
    return `This file is ${fmtBytes(incoming)} and you have ${fmtBytes(m.remainingBytes)} of your monthly upload allowance left. It renews on ${day}, or upgrade to upload more now.`;
  }
  if (s && s.usedBytes > s.capacityBytes)
    return `You're using ${fmtBytes(s.usedBytes)} of the ${fmtBytes(s.capacityBytes)} on ${planName}, so new uploads are paused. Your files are safe. Delete some, or upgrade for more room.`;
  return `This file is ${fmtBytes(incoming)} and ${planName} has ${fmtBytes(s?.availableBytes ?? 0)} of storage left. Delete some files, or upgrade for more room.`;
}

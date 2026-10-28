/**
 * Custom alerts (1037), pure so every rule is unit-tested. Stored as JSON on User.alertPrefs; a missing or
 * broken value means the defaults, so nobody silently loses failure alerts because of a bad write.
 */
export type AlertPrefs = {
  /** Tell me when an account's views jump well above its normal day. */
  spike: boolean;
  /** How big a jump counts: last 24 hours vs the daily average of the 7 days before. */
  spikeX: number;
  /** Tell me when a scheduled post fails for good. */
  failed: boolean;
  /** Also email spike alerts (failures always email once per post while `failed` is on). */
  email: boolean;
};

export const ALERT_DEFAULTS: AlertPrefs = { spike: true, spikeX: 2, failed: true, email: false };
export const SPIKE_STEPS = [1.5, 2, 3, 5] as const;
/** Fewer views than this in a day never counts as a spike, so 3 views after a quiet week stays quiet. */
export const SPIKE_FLOOR = 100;

const clampX = (x: unknown) => {
  const n = typeof x === "number" && Number.isFinite(x) ? x : ALERT_DEFAULTS.spikeX;
  return Math.min(10, Math.max(1.5, Math.round(n * 2) / 2));
};

export function parseAlertPrefs(raw: string | null | undefined): AlertPrefs {
  if (!raw) return { ...ALERT_DEFAULTS };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ...ALERT_DEFAULTS };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...ALERT_DEFAULTS };
  const o = v as Record<string, unknown>;
  const bool = (k: keyof AlertPrefs) => (typeof o[k] === "boolean" ? (o[k] as boolean) : (ALERT_DEFAULTS[k] as boolean));
  return { spike: bool("spike"), spikeX: clampX(o.spikeX), failed: bool("failed"), email: bool("email") };
}

export const serializeAlertPrefs = (p: AlertPrefs) => JSON.stringify({ spike: p.spike, spikeX: clampX(p.spikeX), failed: p.failed, email: p.email });

/**
 * Is the last day a spike? `prior7` is the views of the 7 days before it. Returns how many times the usual day
 * it was (null when it isn't a spike). A first big day after a silent week counts, reported as Infinity.
 */
export function spikeRatio(last24: number, prior7: number, x: number, floor = SPIKE_FLOOR): number | null {
  if (!(last24 >= floor)) return null;
  const avg = Math.max(0, prior7) / 7;
  if (avg <= 0) return Infinity;
  const r = last24 / avg;
  return r >= x ? r : null;
}

/** "3x" / "12x" / "your best day yet" for the notice body. */
export const spikeLabel = (r: number) => (Number.isFinite(r) ? `${r >= 10 ? Math.round(r) : Math.round(r * 10) / 10}x your usual day` : "well above anything this past week");

/** The local calendar day, used to dedupe: one spike alert per account per day. */
export function dayStamp(now: Date, tz: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

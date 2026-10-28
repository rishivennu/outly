/**
 * Live counts (1037), pure. "Online" means a signed-in person whose app pinged in the last 5 minutes.
 * Real numbers, never padded or invented. 1038: shown from the first creator (the owner wants the count
 * visible from day one); "online" appears once at least one person is online, so it never reads "0 online".
 */
export const ONLINE_WINDOW_MS = 5 * 60_000;
export const PRESENCE_WRITE_MS = 60_000;
export const LIVE_MIN_TOTAL = 1;
export const LIVE_MIN_ONLINE = 1;

export type LiveStats = { total: number; online: number };
export type LiveView = { total: number | null; online: number | null };

/** What the strip may show. Null parts are hidden; both null hides the strip. */
export function liveView(s: LiveStats | null | undefined): LiveView {
  if (!s || !(s.total >= LIVE_MIN_TOTAL)) return { total: null, online: null };
  return { total: s.total, online: s.online >= LIVE_MIN_ONLINE ? Math.min(s.online, s.total) : null };
}

/** Throttle for the presence write: true when this person's last write is older than a minute. */
export const presenceDue = (last: number | undefined, now: number) => last === undefined || now - last >= PRESENCE_WRITE_MS;

export const compactCount = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(Math.floor(n / 100) / 10).toString()}k` : String(n));

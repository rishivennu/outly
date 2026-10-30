/**
 * Admin live globe (1062), pure: what counts as active, and how people are grouped into markers.
 * Tested in tests/round-1062-live-map.test.ts. Client-safe (no db, no server-only imports).
 *
 * Definitions, shown in the admin UI word for word:
 * - The app records "last seen" for a signed-in member at most once a minute, while the studio is open
 *   (page loads plus the live-count poll every 60 s). See lib/presence.ts.
 * - ACTIVE: last seen within the inactivity timeout (default 5 minutes, the same "online" the site uses).
 * - IDLE: last seen within the last hour, but longer ago than the timeout.
 * - Anyone not seen for an hour is not on the globe at all.
 * - Location is the approximate network place (country, and the city when the CDN sends one) from the member's
 *   last studio visit. A VPN, office proxy or mobile carrier can put it in another city or country.
 */
import { placePoint } from "./geo-points";

export const LIVE_TIMEOUTS_MIN = [2, 5, 10, 15, 30] as const;
export const LIVE_DEFAULT_MIN = 5;
export const LIVE_IDLE_MS = 60 * 60_000;
export const LIVE_POLL_MS = 15_000;
export const LIVE_MAX_PEOPLE = 400;

/** Any input becomes one of the allowed timeouts (never below the 1-minute heartbeat, never above the idle hour). */
export function clampTimeout(v: unknown): number {
  const n = Math.round(Number(v));
  return (LIVE_TIMEOUTS_MIN as readonly number[]).includes(n) ? n : LIVE_DEFAULT_MIN;
}

export type LiveStatus = "active" | "idle";
export type LiveRow = { id: string; name: string; email: string; lastSeenAt: Date | string; country: string | null; region: string | null; city: string | null; via: string | null; locAt: Date | string | null };
export type LivePerson = { id: string; name: string; email: string; status: LiveStatus; lastSeenAt: string; city: string | null; region: string | null; locAt: string | null };
export type LivePlace = {
  key: string;
  lat: number;
  lng: number;
  precision: "city" | "country";
  country: string;
  city: string | null;
  active: number;
  idle: number;
  lastSeenAt: string;
  people: LivePerson[];
};
export type LiveMap = {
  at: string;
  timeoutMin: number;
  active: number;
  idle: number;
  places: LivePlace[];
  /** Seen in the window but with no usable place (local dev, Tor, a header-less proxy, or never visited the studio). */
  unplaced: { active: number; idle: number };
};

const iso = (d: Date | string) => (typeof d === "string" ? new Date(d) : d).toISOString();

export function statusOf(lastSeen: Date | string, now: number, timeoutMin: number): LiveStatus | null {
  const age = now - new Date(lastSeen).getTime();
  if (!(age >= -60_000)) return null; // a future or unreadable time: ignore rather than guess
  if (age <= timeoutMin * 60_000) return "active";
  if (age <= LIVE_IDLE_MS) return "idle";
  return null;
}

/** Groups the rows into markers. One marker per mapped city, or per country when the city isn't known or mapped. */
export function buildLiveMap(rows: LiveRow[], now: number, timeoutMin: number): LiveMap {
  const t = clampTimeout(timeoutMin);
  const places = new Map<string, LivePlace>();
  const unplaced = { active: 0, idle: 0 };
  let active = 0;
  let idle = 0;
  for (const r of rows) {
    const status = statusOf(r.lastSeenAt, now, t);
    if (!status) continue;
    status === "active" ? active++ : idle++;
    const pt = r.via === "tor" ? null : placePoint(r.country, r.city);
    if (!pt || !r.country) {
      unplaced[status]++;
      continue;
    }
    const cc = r.country.toUpperCase();
    const city = pt.precision === "city" ? r.city : null;
    const key = pt.precision === "city" ? `${cc}|${(city ?? "").toLowerCase()}` : cc;
    let p = places.get(key);
    if (!p) {
      p = { key, lat: pt.lat, lng: pt.lng, precision: pt.precision, country: cc, city, active: 0, idle: 0, lastSeenAt: iso(r.lastSeenAt), people: [] };
      places.set(key, p);
    }
    p[status]++;
    if (new Date(r.lastSeenAt) > new Date(p.lastSeenAt)) p.lastSeenAt = iso(r.lastSeenAt);
    p.people.push({ id: r.id, name: r.name, email: r.email, status, lastSeenAt: iso(r.lastSeenAt), city: r.city, region: r.region, locAt: r.locAt ? iso(r.locAt) : null });
  }
  const list = [...places.values()];
  for (const p of list) p.people.sort((a, b) => (a.status === b.status ? +new Date(b.lastSeenAt) - +new Date(a.lastSeenAt) : a.status === "active" ? -1 : 1));
  list.sort((a, b) => b.active - a.active || b.idle - a.idle || a.key.localeCompare(b.key));
  return { at: new Date(now).toISOString(), timeoutMin: t, active, idle, places: list, unplaced };
}

/** "just now", "4 min ago", "1 h ago". */
export function agoLabel(at: string | Date, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

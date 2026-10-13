/* Pure helpers shared by the API wrapper, the studio layout and the maintenance page (no imports, no cycles). */

/**
 * Maintenance keeps members working (user's call, 10-13): anyone whose account existed before the switch
 * went on carries on as normal. Nobody can create an account while it is on, so in practice this is
 * "signed in", but the date check keeps it true even if an account slips in some other way.
 */
export function joinedBeforeMaintenance(user: { createdAt: Date | string } | null | undefined, since: string) {
  if (!user) return false;
  const s = Date.parse(since);
  if (!Number.isFinite(s)) return true; // switch on without a start time: everyone who has an account already joined before it
  return new Date(user.createdAt).getTime() < s;
}

/** Whole minutes left on the countdown (rounded up), or null when there is no countdown. */
export function minutesLeft(endsAt: string, now = Date.now()) {
  const t = Date.parse(endsAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - now) / 60_000));
}

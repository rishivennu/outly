/**
 * Pure access rules (1052), no DB: shared by the server and the tests.
 * Access can come from four places at once: a paid subscription, a gift subscription (beta code, an old
 * referral month), an admin grant, or a referral reward. They never cancel each other: the account simply
 * gets the best plan that is live right now, and every other source keeps its own clock.
 */
export type AccessSource = "free" | "paid" | "gift" | "admin" | "referral";

/** Subscriptions made without a payment. They never stop a paid plan and a payment never ends them. */
export const GIFT_PROVIDERS = ["beta", "referral"] as const;
export const isGiftProvider = (provider: string) => (GIFT_PROVIDERS as readonly string[]).includes(provider);
/** A subscription someone paid for (or a sample one standing in for that). */
export const isPaidSub = (s: { provider: string; priceMinor: number; sample?: boolean }) => !isGiftProvider(s.provider) && (s.priceMinor > 0 || !!s.sample);

const SOURCE_RANK: Record<AccessSource, number> = { paid: 4, admin: 3, referral: 2, gift: 1, free: 0 };

export interface AccessCandidate<P extends { sortOrder: number }> {
  plan: P;
  source: AccessSource;
  endsAt: Date | null;
  id?: string;
}

/**
 * The plan that wins: the highest tier (plan sortOrder) among everything live. On the same tier, what the
 * person paid for is shown first (so Billing manages the real subscription), then admin, referral, gift;
 * then whichever lasts longest.
 */
export function pickAccess<P extends { sortOrder: number }>(cands: AccessCandidate<P>[]): AccessCandidate<P> | null {
  let best: AccessCandidate<P> | null = null;
  for (const c of cands) {
    if (!best) { best = c; continue; }
    const d = c.plan.sortOrder - best.plan.sortOrder || SOURCE_RANK[c.source] - SOURCE_RANK[best.source] || (c.endsAt?.getTime() ?? Infinity) - (best.endsAt?.getTime() ?? Infinity);
    if (d > 0) best = c;
  }
  return best;
}

export const DAY_MS = 86_400_000;
export const MAX_GRANT_DAYS = 3660;

export type GrantState = "pending" | "scheduled" | "active" | "expired" | "revoked";

/**
 * What a grant row means right now. Stored status + time: an active row before its start is "scheduled".
 * A pending grant made by length (durationDays) has only a placeholder end, so it stays "pending" past it.
 */
export function grantState(g: { status: string; startsAt: Date; endsAt: Date; durationDays?: number | null }, now = new Date()): GrantState {
  if (g.status === "revoked") return "revoked";
  if (g.status === "pending" && g.durationDays) return "pending";
  if (g.status === "expired" || g.endsAt <= now) return "expired";
  if (g.status === "pending") return "pending";
  return g.startsAt > now ? "scheduled" : "active";
}

/**
 * End date for a grant from either a number of days or a calendar end date. Throws a plain message the
 * admin can read; the server turns it into a 400.
 */
export function grantEnd(start: Date, opts: { days?: number | null; endsAt?: Date | string | null }, now = new Date()): Date {
  if (opts.endsAt) {
    const end = new Date(opts.endsAt);
    if (Number.isNaN(end.getTime())) throw new Error("That end date isn't a date.");
    if (end <= start) throw new Error("The end date must be after the start.");
    if (end <= now) throw new Error("The end date is already in the past.");
    if (end.getTime() - start.getTime() > MAX_GRANT_DAYS * DAY_MS) throw new Error("A grant can last ten years at most.");
    return end;
  }
  const days = Number(opts.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_GRANT_DAYS) throw new Error("Pick a duration between 1 day and ten years.");
  return new Date(start.getTime() + days * DAY_MS);
}

/** Lowercased, trimmed, and plausibly an address. Grants match the exact address, never a folded inbox. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254 ? e : null;
}

/**
 * The referral month (1052) is stacked after the friend's paid period, so it never overlaps the time
 * they paid for: it starts when that period ends (or now, if that is already past) and runs `days`.
 */
export function rewardWindow(paidUntil: Date | null, now: Date, days: number) {
  const startsAt = paidUntil && paidUntil > now ? paidUntil : now;
  return { startsAt, endsAt: new Date(startsAt.getTime() + days * DAY_MS) };
}

/** A grant that hasn't started yet moves to start after `paidUntil`, keeping its length (a renewal pushed it). */
export function restack(g: { startsAt: Date; endsAt: Date }, paidUntil: Date, now: Date) {
  if (g.startsAt <= now || g.startsAt >= paidUntil) return null;
  const len = g.endsAt.getTime() - g.startsAt.getTime();
  return { startsAt: paidUntil, endsAt: new Date(paidUntil.getTime() + len) };
}

/**
 * 1066: a sharer can hold several earned months that haven't started. A renewal pushes them as a queue: each
 * starts where the one before ends, never on top of it. Returns only the ones that move, with their new dates.
 */
export function restackQueue<G extends { id: string; startsAt: Date; endsAt: Date }>(grants: G[], paidUntil: Date, now: Date) {
  let cursor = paidUntil;
  const moved: { id: string; startsAt: Date; endsAt: Date }[] = [];
  for (const g of [...grants].filter((x) => x.startsAt > now).sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())) {
    const len = g.endsAt.getTime() - g.startsAt.getTime();
    if (g.startsAt < cursor) {
      const next = { id: g.id, startsAt: cursor, endsAt: new Date(cursor.getTime() + len) };
      moved.push(next);
      cursor = next.endsAt;
    } else if (g.endsAt > cursor) cursor = g.endsAt;
  }
  return moved;
}

// ---- storage (1052): one total allowance per plan, enforced on the server ----
export const MB = 1024 * 1024;

export function fmtBytes(bytes: number) {
  const b = Math.max(0, bytes);
  if (b >= 1024 * MB) return `${(b / (1024 * MB)).toFixed(b >= 10 * 1024 * MB ? 0 : 1).replace(/\.0$/, "")} GB`;
  if (b >= MB) return `${(b / MB).toFixed(b >= 10 * MB ? 0 : 1).replace(/\.0$/, "")} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

export interface StorageFigures {
  usedBytes: number;
  limitBytes: number; // 0 = no cap
  remainingBytes: number; // Infinity-free: 0 when over or uncapped-with-no-meaning
  over: boolean;
  pct: number; // 0..100, for the bar
  label: string; // "200 MB used, 300 MB remaining out of 500 MB"
}

export function storageFigures(usedBytes: number, storageMb: number): StorageFigures {
  const limitBytes = Math.max(0, storageMb) * MB;
  const used = Math.max(0, usedBytes);
  if (!limitBytes) return { usedBytes: used, limitBytes: 0, remainingBytes: 0, over: false, pct: 0, label: `${fmtBytes(used)} used, no storage cap` };
  const remainingBytes = Math.max(0, limitBytes - used);
  return {
    usedBytes: used, limitBytes, remainingBytes, over: used > limitBytes,
    pct: Math.min(100, Math.round((used / limitBytes) * 1000) / 10),
    label: `${fmtBytes(used)} used, ${fmtBytes(remainingBytes)} remaining out of ${fmtBytes(limitBytes)}`,
  };
}

/** Would `incoming` more bytes fit? Over the allowance after a downgrade = nothing new fits until files are removed. */
export const fitsStorage = (usedBytes: number, storageMb: number, incoming: number) => storageMb <= 0 || usedBytes + Math.max(0, incoming) <= storageMb * MB;

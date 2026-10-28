/**
 * Founding members (1036). While `enabled`, the first `limit` people who PROVE their email get a numbered
 * founding seat and `discountPct` off every paid plan, for life. Proving the inbox is what stops one person
 * farming seats with throwaway or dotted/plus-tagged addresses. Pure: safe to import on the client.
 */
export interface FoundingConfig {
  enabled: boolean;
  /** How many founding seats exist. Set by the admin. */
  limit: number;
  /** Lifetime discount. Locked into each member's row when they claim, so a later change never takes it away. */
  discountPct: number;
  /** Only Gmail (and googlemail) addresses can claim a seat. */
  gmailOnly: boolean;
}
export const FOUNDING_DEFAULT: FoundingConfig = { enabled: false, limit: 100, discountPct: 30, gmailOnly: true };

export const normalizeFounding = (c: Partial<FoundingConfig> | null | undefined): FoundingConfig => ({
  enabled: c?.enabled ?? FOUNDING_DEFAULT.enabled,
  limit: Math.max(0, Math.min(100_000, Math.floor(Number(c?.limit ?? FOUNDING_DEFAULT.limit) || 0))),
  discountPct: Math.max(1, Math.min(90, Math.floor(Number(c?.discountPct) || FOUNDING_DEFAULT.discountPct))),
  gmailOnly: c?.gmailOnly ?? FOUNDING_DEFAULT.gmailOnly,
});

const GMAIL = /^([^@\s]+)@(gmail\.com|googlemail\.com)$/i;
export const isGmail = (email: string) => GMAIL.test(email.trim());

/**
 * One key per real inbox. Only Gmail's aliasing is folded: with gmailOnly off, other providers' +tags and
 * alias domains count as separate inboxes, so turning gmailOnly off trades some abuse resistance for reach.
 * Gmail ignores dots and anything after "+", and googlemail.com is the same
 * mailbox, so j.o.e+1@googlemail.com and joe@gmail.com are one person and get one seat.
 */
export function inboxKey(email: string): string {
  const e = email.trim().toLowerCase();
  const m = GMAIL.exec(e);
  if (!m) return e;
  return `${m[1].split("+")[0].replace(/\./g, "")}@gmail.com`;
}

/** Can this address hold a seat under these rules (verification aside)? */
export const eligibleEmail = (cfg: Pick<FoundingConfig, "gmailOnly">, email: string) => !cfg.gmailOnly || isGmail(email);

/** Payment gateways refuse charges under one currency unit (Razorpay: 100 paise). */
export const MIN_CHARGE_MINOR = 100;

/**
 * The founding price. Rounded DOWN to a whole currency unit (never more than the advertised discount), so
 * checkout and the plan card always agree, and never below what a gateway can charge.
 */
export function foundingPrice(minor: number, pct: number | null | undefined): number {
  if (!pct || minor <= MIN_CHARGE_MINOR) return minor;
  const off = Math.floor((minor * (100 - pct)) / 100);
  return Math.max(MIN_CHARGE_MINOR, Math.floor(off / 100) * 100);
}

export const seatsLeft = (cfg: Pick<FoundingConfig, "limit">, used: number) => Math.max(0, cfg.limit - used);

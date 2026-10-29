/** Pure referral helpers (no DB), shared by the server code and the tests. */
export const REF_COOKIE = "ol_ref";
export const REF_DAYS = 30;
// No 0/O/1/I/L: codes get read aloud and typed by hand.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

// crypto.getRandomValues (not Math.random): codes must not be predictable, or attribution can be stolen.
const secureRand = (n: number) => {
  const max = Math.floor(0x100000000 / n) * n; // rejection sampling keeps every letter equally likely
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf);
  while (buf[0] >= max);
  return buf[0] % n;
};

export function makeCode(rand: (n: number) => number = secureRand, len = 8) {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[rand(ALPHABET.length)];
  return s;
}

export const isCode = (c: unknown): c is string => typeof c === "string" && /^[a-z0-9]{6,16}$/.test(c);

/** Only a real, different user can be credited. */
export function referrerFor(cookie: string | undefined, me: { id: string; referredById?: string | null }, owner: { id: string } | null) {
  if (!cookie || !isCode(cookie) || !owner) return null;
  if (owner.id === me.id || me.referredById) return null;
  return owner.id;
}

/** Second cookie next to REF_COOKIE: one random id per visitor, so an opened link becomes their row at signup. */
export const REF_VISITOR = "ol_refv";

/** Share link (1052). Old /r/{code} links still work and land here. */
export const shareUrl = (appUrl: string, code: string) => `${appUrl.replace(/\/$/, "")}/signup?ref=${code}`;

/**
 * Refer & Earn (1052): the FRIEND who signs up through a link gets `rewardDays` of `rewardPlan` after their
 * first verified payment for one of `eligiblePlans`. The month starts when the period they paid for ends.
 */
export interface ReferralConfig {
  enabled: boolean;
  rewardPlan: string;
  rewardDays: number;
  eligiblePlans: string[];
}
export const REFERRAL_DEFAULT: ReferralConfig = { enabled: true, rewardPlan: "creator", rewardDays: 30, eligiblePlans: ["creator", "studio", "pro-manager"] };

/** Clamp whatever is stored (or posted by the admin form) to something the reward code can trust. */
export function normalizeReferral(raw: Partial<ReferralConfig> | null | undefined, knownPlans?: string[]): ReferralConfig {
  const r = { ...REFERRAL_DEFAULT, ...(raw ?? {}) };
  const ok = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9-]{1,40}$/.test(s) && s !== "free" && (!knownPlans || knownPlans.includes(s));
  const days = Math.round(Number(r.rewardDays));
  const eligible = Array.isArray(r.eligiblePlans) ? [...new Set(r.eligiblePlans.filter(ok))] : REFERRAL_DEFAULT.eligiblePlans;
  return {
    enabled: r.enabled !== false,
    rewardPlan: ok(r.rewardPlan) ? r.rewardPlan : REFERRAL_DEFAULT.rewardPlan,
    rewardDays: Number.isFinite(days) ? Math.min(365, Math.max(1, days)) : REFERRAL_DEFAULT.rewardDays,
    eligiblePlans: eligible,
  };
}

/** What the friend's row means on the Refer & Earn card. */
export type ReferralLabel = "Invited" | "Registered" | "Awaiting qualifying payment" | "Payment verified" | "Reward granted" | "Reward expired" | "Referral disqualified";

export function referralLabel(r: { status: string; verified?: boolean; grant?: { status: string; endsAt: Date } | null }, now = new Date()): ReferralLabel {
  if (r.status === "disqualified") return "Referral disqualified";
  if (r.status === "rewarded") {
    if (r.grant?.status === "revoked") return "Referral disqualified";
    return r.grant && (r.grant.status === "expired" || r.grant.endsAt <= now) ? "Reward expired" : "Reward granted";
  }
  if (r.status === "paid") return "Payment verified";
  if (r.status === "registered") return r.verified ? "Awaiting qualifying payment" : "Registered";
  return "Invited";
}

/** "ravi.k@gmail.com" -> "ra****@gmail.com": enough to recognise a friend, not enough to harvest addresses. */
export function maskEmail(email: string) {
  const [user, domain] = email.split("@");
  if (!domain) return "****";
  return `${user.slice(0, Math.min(2, Math.max(1, user.length - 1)))}****@${domain}`;
}

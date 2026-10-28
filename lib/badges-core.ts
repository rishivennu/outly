/**
 * Trust badges (1037), pure so the rules are unit-tested.
 * Verified Manager = on the Pro Multi-Account Manager plan, this email proven, and really managing more
 * than one account. A badge that anyone could get by paying would say nothing, so all three are needed.
 */
export const MANAGER_SLUG = "pro-manager";
export const MANAGER_MIN_ACCOUNTS = 2;

export function isVerifiedManager(x: { planSlug: string; proven: boolean; accounts: number }) {
  return x.planSlug === MANAGER_SLUG && x.proven && x.accounts >= MANAGER_MIN_ACCOUNTS;
}

export type TrustBadges = { foundingNo: number | null; verifiedManager: boolean };

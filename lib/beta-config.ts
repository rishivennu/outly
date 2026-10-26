/**
 * Beta program. While `enabled`, the site says "beta" and the first `limit` people to join each get a
 * one-time code for `months` of the `planSlug` plan. Codes are tied to the member they were issued to;
 * codes made by hand in admin (no member) work for anyone, once.
 */
export interface BetaConfig {
  enabled: boolean;
  limit: number;
  planSlug: string;
  months: number;
}
export const BETA_DEFAULT: BetaConfig = { enabled: true, limit: 0, planSlug: "creator", months: 3 };

export const normalizeBeta = (c: Partial<BetaConfig> | null | undefined): BetaConfig => ({
  enabled: c?.enabled ?? BETA_DEFAULT.enabled,
  limit: Math.max(0, Math.min(100_000, Math.floor(Number(c?.limit) || 0))),
  planSlug: typeof c?.planSlug === "string" && /^[a-z0-9-]{2,30}$/.test(c.planSlug) ? c.planSlug : BETA_DEFAULT.planSlug,
  months: Math.max(1, Math.min(24, Math.floor(Number(c?.months) || BETA_DEFAULT.months))),
});

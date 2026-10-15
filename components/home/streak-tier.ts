/** Streak tiers, shared by server and client: 0 none, 1 = 1-2 weeks, 2 = 3-5, 3 = 6-9, 4 = 10+. */
export function streakTier(streak: number) {
  return streak <= 0 ? 0 : streak <= 2 ? 1 : streak <= 5 ? 2 : streak <= 9 ? 3 : 4;
}
export const TIER_NAME = ["No streak yet", "Spark", "On fire", "Blazing", "Inferno"] as const;

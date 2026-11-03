import { json, route } from "@/lib/http";
import { analyticsScope } from "@/lib/profiles";
import { getPulse } from "@/lib/dashboard/pulse";
import { isPulseRange, PULSE_RANGES } from "@/lib/dashboard/pulse-core";
import { entitlements } from "@/lib/billing/entitlements";
import { analyticsWindow } from "@/lib/billing/plan-rules";

export const dynamic = "force-dynamic";

/** The analytics dashboard's numbers for one range (1080): ?days=7|30|90. Scoped like Analytics. */
export const GET = route(async (req, { user }) => {
  const n = Number(req.nextUrl.searchParams.get("days"));
  const want = isPulseRange(n) ? n : 7;
  // 1096: never past the plan's analytics history (Free reads 30 days, so 90 falls back to 30).
  const { maxDays } = analyticsWindow(await entitlements(user.id), want);
  const days = want <= maxDays ? want : [...PULSE_RANGES].reverse().find((r) => r <= maxDays) ?? 7;
  return json({ ...(await getPulse(user.id, days, await analyticsScope(user))), maxDays, ranges: PULSE_RANGES.filter((r) => r <= maxDays) });
});

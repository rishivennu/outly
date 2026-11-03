import { json, route } from "@/lib/http";
import { getAnalytics } from "@/lib/analytics";
import { analyticsScope } from "@/lib/profiles";
import { entitlements } from "@/lib/billing/entitlements";
import { analyticsRanges, analyticsWindow } from "@/lib/billing/plan-rules";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { user }) => {
  // 1096: the history a plan may read (Free 30 days ... Agency 2 years; 90 when the plan sets none).
  const w = analyticsWindow(await entitlements(user.id), Number(req.nextUrl.searchParams.get("days") ?? 30));
  const days = w.days;
  // 1037: ?account= drills into one profile; otherwise the picked profile, a member's accounts, or everything
  const ids = await analyticsScope(user, req.nextUrl.searchParams.get("account"));
  return json({ ...(await getAnalytics(user.id, days, ids)), maxDays: w.maxDays, capped: w.capped, ranges: analyticsRanges(w.maxDays) });
});

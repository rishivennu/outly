import { json, route } from "@/lib/http";
import { getAnalytics } from "@/lib/analytics";
import { analyticsScope } from "@/lib/profiles";
import { entitlements } from "@/lib/billing/entitlements";
import { analyticsRanges, analyticsWindow } from "@/lib/billing/plan-rules";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { user }) => {
  const q = req.nextUrl.searchParams;
  // 1096: the history a plan may read (Free 30 days ... Agency 2 years; 90 when the plan sets none).
  const w = analyticsWindow(await entitlements(user.id), Number(q.get("days") ?? 30));
  // 1037: ?account= drills into one profile; otherwise the picked profile, a member's accounts, or everything
  const ids = await analyticsScope(user, q.get("account"));
  // 1140: ?from=&to= (YYYY-MM-DD) is a custom range. getAnalytics clamps it to the same plan window, so a
  // typed URL can never read further back than the plan allows.
  const a = await getAnalytics(user.id, w.days, ids, { from: q.get("from"), to: q.get("to"), maxDays: w.maxDays });
  return json({ ...a, maxDays: w.maxDays, capped: w.capped || a.window.clamped, ranges: analyticsRanges(w.maxDays) });
});

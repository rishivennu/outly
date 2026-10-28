import { json, route } from "@/lib/http";
import { getAnalytics } from "@/lib/analytics";
import { analyticsScope } from "@/lib/profiles";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { user }) => {
  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days") ?? 30) || 30));
  // 1037: ?account= drills into one profile; otherwise the picked profile, a member's accounts, or everything
  const ids = await analyticsScope(user, req.nextUrl.searchParams.get("account"));
  return json(await getAnalytics(user.id, days, ids));
});

import { json, route } from "@/lib/http";
import { analyticsScope } from "@/lib/profiles";
import { getPulse } from "@/lib/dashboard/pulse";
import { isPulseRange } from "@/lib/dashboard/pulse-core";

export const dynamic = "force-dynamic";

/** The analytics dashboard's numbers for one range (1080): ?days=7|30|90. Scoped like Analytics. */
export const GET = route(async (req, { user }) => {
  const n = Number(req.nextUrl.searchParams.get("days"));
  const days = isPulseRange(n) ? n : 7;
  return json(await getPulse(user.id, days, await analyticsScope(user)));
});

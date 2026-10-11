import { json, route } from "@/lib/http";
import { getAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { user }) => {
  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days") ?? 30) || 30));
  return json(await getAnalytics(user.id, days));
});

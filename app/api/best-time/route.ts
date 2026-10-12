import { json, route } from "@/lib/http";
import { isPlatform, type Platform } from "@/lib/domain";
import { getBestTimes } from "@/lib/schedule/best-time-server";

export const dynamic = "force-dynamic";

export const GET = route(
  async (req, { user }) => {
    const platforms = (req.nextUrl.searchParams.get("platforms") ?? "").split(",").filter(isPlatform) as Platform[];
    return json(await getBestTimes(user.id, platforms, user.timezone || "UTC"));
  },
  { limit: [60, 60_000] },
);

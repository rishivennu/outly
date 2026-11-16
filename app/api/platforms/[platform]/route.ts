import { HttpError, json, route } from "@/lib/http";
import { isPlatform } from "@/lib/domain";
import { platformDashboard } from "@/lib/live";
import { pickRangeDays } from "@/lib/live/ranges";
import { dashboardAccount } from "@/lib/profiles";

export const dynamic = "force-dynamic";

/** Live numbers for one platform. ?fresh=1 skips the short cache (the Refresh button). */
export const GET = route(
  async (req, { user, params }) => {
    const p = params.platform ?? "";
    if (!isPlatform(p)) throw new HttpError(404, "We don't support that platform yet.");
    // 1172: ?days= picks the reporting window (only one the platform offers; see lib/live/ranges.ts).
    return json(await platformDashboard(user.id, p, { fresh: req.nextUrl.searchParams.get("fresh") === "1", accountId: await dashboardAccount(user, p), days: pickRangeDays(p, req.nextUrl.searchParams.get("days")) }));
  },
  { limit: [40, 60_000] },
);

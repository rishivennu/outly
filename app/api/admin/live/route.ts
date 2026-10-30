import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { liveMap } from "@/lib/admin/live-map";
import { clampTimeout } from "@/lib/live-map-core";

export const dynamic = "force-dynamic";

/**
 * Admin live globe data (1062). Users area only (super, support, finance), same as the Users page that already
 * shows these people. ?timeout=<minutes> picks the inactivity timeout (2, 5, 10, 15 or 30). Never cached.
 * Polled every 15 s by an open admin tab, so the limit leaves room for a few tabs plus manual refreshes.
 */
export const GET = adminRoute(
  "users",
  async (req) => {
    const data = await liveMap(clampTimeout(req.nextUrl.searchParams.get("timeout")));
    return json(data, { headers: { "cache-control": "no-store, private" } });
  },
  [40, 60_000],
);

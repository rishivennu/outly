import { json, route } from "@/lib/http";
import { liveTotals } from "@/lib/live/review";

export const dynamic = "force-dynamic";

/** Polled by the live views counter about every 30 s while the tab is visible. */
export const GET = route(async (_req, { user }) => json(await liveTotals(user.id), { headers: { "cache-control": "no-store" } }), { limit: [40, 60_000] });

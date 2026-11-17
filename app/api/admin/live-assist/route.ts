import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { analytics, heartbeat, queue } from "@/lib/support/live";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

/**
 * R1184 Live Assist queue: counters, rows for the chosen filter, the team (who's online), and, when asked for
 * (?analytics=7), the report for that many days. Each check-in also marks this specialist as online.
 */
export const GET = adminRoute("live", async (req, { admin }) => {
  const p = req.nextUrl.searchParams;
  const days = p.get("analytics");
  const [q, me, report] = await Promise.all([
    queue(admin, { filter: p.get("filter"), sort: p.get("sort"), category: p.get("category"), priority: p.get("priority") }),
    heartbeat(admin),
    days ? analytics({ days: Number(days) }) : Promise.resolve(null),
  ]);
  return json({ ...q, away: me.away, analytics: report }, { headers: NO_STORE });
}, [240, 60_000]);

const Body = z.object({ action: z.literal("away"), away: z.boolean() });

/** "Away": hides this specialist from customers' "someone is online" without leaving the console. */
export const POST = adminRoute("live", async (req, { admin }) => {
  const b = Body.parse(await req.json());
  return json(await heartbeat(admin, { away: b.away }), { headers: NO_STORE });
}, [30, 60_000]);

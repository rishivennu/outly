import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { analytics, heartbeat, queue } from "@/lib/support/live";
import { vapidKeys } from "@/lib/push/vapid";
import { adminDevices } from "@/lib/health/admin-push";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

/**
 * R1184 Live Assist queue: counters, rows for the chosen filter, the team (who's online), and, when asked for
 * (?analytics=7), the report for that many days. Each check-in also marks this specialist as online.
 * R1207: it also carries what the console needs to turn phone alerts on here: the server's VAPID public key (null
 * when Web Push is not configured) and this admin's own alert devices. Same devices as System Health's.
 */
export const GET = adminRoute("live", async (req, { admin }) => {
  const p = req.nextUrl.searchParams;
  const days = p.get("analytics");
  const [q, me, report, vapid, devices] = await Promise.all([
    queue(admin, { filter: p.get("filter"), sort: p.get("sort"), category: p.get("category"), priority: p.get("priority") }),
    heartbeat(admin),
    days ? analytics({ days: Number(days) }) : Promise.resolve(null),
    vapidKeys()
      .then((v) => v.publicKey)
      .catch(() => null),
    adminDevices(admin.id).catch(() => []),
  ]);
  return json({ ...q, away: me.away, analytics: report, vapidPublicKey: vapid, pushDevices: devices.length }, { headers: NO_STORE });
}, [240, 60_000]);

const Body = z.object({ action: z.literal("away"), away: z.boolean() });

/** "Away": hides this specialist from customers' "someone is online" without leaving the console. */
export const POST = adminRoute("live", async (req, { admin }) => {
  const b = Body.parse(await req.json());
  return json(await heartbeat(admin, { away: b.away }), { headers: NO_STORE });
}, [30, 60_000]);

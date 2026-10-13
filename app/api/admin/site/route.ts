import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";

// Bulk email (back-online notice, waitlist invites) can run for up to ~40 s; give the function room.
export const maxDuration = 60;
import { setMaintenance, siteStatus, subscriberCounts } from "@/lib/site";

export const GET = adminRoute("site", async () => json({ site: await siteStatus(), subscribers: await subscriberCounts() }));

const Body = z.object({
  maintenance: z.boolean(),
  message: z.string().trim().max(280).optional(),
  eta: z.string().trim().max(60).optional(),
  /** Countdown length in minutes (up to a week). 0 or null clears it; leave it out to keep the current one. */
  minutes: z.number().int().min(0).max(10_080).nullable().optional(),
});

export const PUT = adminRoute("site", async (req, { admin }) => {
  const b = Body.parse(await req.json());
  const r = await setMaintenance(b.maintenance, admin.name, { message: b.message, eta: b.eta, minutes: b.minutes });
  return json({ site: { maintenance: r.site.maintenance, message: r.site.message, eta: r.site.eta, since: r.site.since, endsAt: r.site.endsAt ?? "" }, notified: r.notified, subscribers: await subscriberCounts() });
}, [20, 60_000]);

export const dynamic = "force-dynamic";

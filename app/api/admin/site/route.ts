import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { setMaintenance, siteStatus, subscriberCounts } from "@/lib/site";

export const GET = adminRoute("site", async () => json({ site: await siteStatus(), subscribers: await subscriberCounts() }));

const Body = z.object({ maintenance: z.boolean(), message: z.string().trim().max(280).optional(), eta: z.string().trim().max(60).optional() });

export const PUT = adminRoute("site", async (req, { admin }) => {
  const b = Body.parse(await req.json());
  const r = await setMaintenance(b.maintenance, admin.name, { message: b.message, eta: b.eta });
  return json({ site: { maintenance: r.site.maintenance, message: r.site.message, eta: r.site.eta, since: r.site.since }, notified: r.notified, subscribers: await subscriberCounts() });
}, [20, 60_000]);

export const dynamic = "force-dynamic";

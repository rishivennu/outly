import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { metricSeries } from "@/lib/health/overview";

export const dynamic = "force-dynamic";

const Query = z.object({ service: z.string().min(1).max(40), key: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_:.-]+$/), range: z.enum(["1h", "24h", "7d", "30d"]).default("24h") });

/** R1195: one probe metric over time, for the Performance sparklines. */
export const GET = adminRoute("health", async (req) => {
  const p = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  return json({ points: await metricSeries(p.service, p.key, new Date(), p.range) });
});

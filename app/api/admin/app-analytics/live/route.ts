import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { live } from "@/lib/admin/app-analytics";

export const dynamic = "force-dynamic";

/** R1308: the real-time panel. Polled by the page every 20 s while visible; the read itself is cached for 10 s. */
export const GET = adminRoute("appAnalytics", async (_req, { admin }) => json(await live(admin.role), { headers: { "cache-control": "no-store" } }), [40, 60_000]);

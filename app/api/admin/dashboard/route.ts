import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { getConfig, saveConfig } from "@/lib/settings";
import { DASHBOARD_STYLES, normalizeDashboard } from "@/lib/dashboard-config";

export const GET = adminRoute("site", async () => json({ dashboard: normalizeDashboard(await getConfig("dashboard")) }));

const Body = z.object({ style: z.enum(DASHBOARD_STYLES).optional(), userSwitch: z.boolean().optional() }).strict();

export const PUT = adminRoute("site", async (req) => {
  const b = Body.parse(await req.json());
  return json({ dashboard: normalizeDashboard(await saveConfig("dashboard", b)) });
}, [60, 60_000]);

export const dynamic = "force-dynamic";

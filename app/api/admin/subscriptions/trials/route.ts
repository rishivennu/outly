import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { trialFunnel } from "../_lib/report";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/** Funnel for all time, the last 30 days and the last 7 days. */
export const GET = adminRoute("pricing", async () => {
  const now = Date.now();
  const [all, d30, d7] = await Promise.all([trialFunnel(), trialFunnel({ from: new Date(now - 30 * DAY) }), trialFunnel({ from: new Date(now - 7 * DAY) })]);
  return json({ all, d30, d7 });
});

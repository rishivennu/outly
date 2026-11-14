import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { analyticsReport } from "@/lib/analytics/posthog-report";
import { parseRange } from "@/lib/analytics/posthog-query";

export const dynamic = "force-dynamic";

export const GET = adminRoute("growth", async (req) => json(await analyticsReport(parseRange(req.nextUrl.searchParams.get("days")))));

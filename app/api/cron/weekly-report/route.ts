import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { sendWeeklyReports } from "@/lib/reports/weekly";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Serverless hosts have no always-on sweeper, so Vercel Cron calls this on Monday morning (see vercel.json).
 * Needs CRON_SECRET; Vercel sends it as a Bearer token automatically.
 */
export async function GET(req: NextRequest) {
  if (!env.CRON_SECRET) return NextResponse.json({ error: "Set CRON_SECRET to enable scheduled reports." }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await sendWeeklyReports(new Date(), { force: true, limit: 500 }));
}

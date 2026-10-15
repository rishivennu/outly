import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getConfig } from "@/lib/settings";
import { sweepAccountHealth } from "@/lib/retention/notices";
import { sendGoalNudges } from "@/lib/retention/sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Serverless hosts have no always-on sweeper, so Vercel Cron calls this once a day (see vercel.json):
 * expiring-token warnings, reconnect reminders and the Friday goal nudge. Needs CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  if (!env.CRON_SECRET) return NextResponse.json({ error: "Set CRON_SECRET to enable scheduled reminders." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await getConfig("site")).maintenance) return NextResponse.json({ skipped: "maintenance" });
  const [accounts, nudges] = [await sweepAccountHealth(), await sendGoalNudges()];
  return NextResponse.json({ accounts, nudges });
}

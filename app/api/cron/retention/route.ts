import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { getConfig } from "@/lib/settings";
import { sweepAccountHealth } from "@/lib/retention/notices";
import { sendGoalNudges } from "@/lib/retention/sweep";
import { pruneOldData } from "@/lib/retention/prune";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Serverless hosts have no always-on sweeper, so Vercel Cron calls this once a day (see vercel.json):
 * expiring-token warnings, reconnect reminders and the Friday goal nudge. Needs CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  if (!env.CRON_SECRET) return NextResponse.json({ error: "Set CRON_SECRET to enable scheduled reminders." }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await getConfig("site")).maintenance) return NextResponse.json({ skipped: "maintenance" });
  const [accounts, nudges] = [await sweepAccountHealth(), await sendGoalNudges()];
  const pruned = await pruneOldData();
  return NextResponse.json({ accounts, nudges, pruned });
}

import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { getConfig } from "@/lib/settings";
import { blogTick } from "@/lib/blog/schedule";

export const dynamic = "force-dynamic";
/** One tick runs at most one stage (~50 s). */
export const maxDuration = 60;

/**
 * R1178 blog scheduler tick: publishes articles a person approved for a date, starts the daily run at its time,
 * moves a run nobody is driving on by one stage, and reports a late run. The minute sweep kicks this only when
 * something is due; vercel.json calls it once a day as a backup. Needs CRON_SECRET. GET and POST behave the same.
 */
async function tick(req: NextRequest) {
  if (!env.CRON_SECRET) return NextResponse.json({ error: "Set CRON_SECRET to enable the blog schedule." }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await getConfig("site")).maintenance) return NextResponse.json({ skipped: "maintenance" }, { headers: { "cache-control": "no-store" } });
  const summary = await blogTick(new Date(), { budgetMs: 55_000 });
  return NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
}

export const GET = tick;
export const POST = tick;

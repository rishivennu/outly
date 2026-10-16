import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { requeueStuckTargets, sweepDuePosts } from "@/lib/queue/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The minute sweeper. On a serverless host nothing stays running, so scheduled posts only go out when
 * something calls this: an external pinger every minute (cron-job.org or similar; Vercel Hobby only allows daily crons, and a
 * per-minute entry in vercel.json makes a Hobby deploy fail, so it is deliberately not listed there). It picks up posts whose
 * time has come and re-queues platform uploads that got stuck, and is safe to call as often as you like.
 * Needs CRON_SECRET as a bearer token. GET and POST behave the same, so any pinger can drive it.
 */
async function sweep(req: NextRequest) {
  if (!env.CRON_SECRET) return NextResponse.json({ error: "Set CRON_SECRET to enable the sweeper." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // No maintenance skip: members keep posting while maintenance is on, so their schedule must still run.
  await sweepDuePosts();
  const requeued = await requeueStuckTargets();
  return NextResponse.json({ ok: true, requeued }, { headers: { "cache-control": "no-store" } });
}

export const GET = sweep;
export const POST = sweep;

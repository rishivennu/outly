import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { requeueStuckTargets, sweepDirectUploads, sweepDuePosts } from "@/lib/queue/handlers";
import { settle } from "@/lib/queue";

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
  const startedAt = Date.now();
  if (!env.CRON_SECRET) return NextResponse.json({ error: "Set CRON_SECRET to enable the sweeper." }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // No maintenance skip: members keep posting while maintenance is on, so their schedule must still run.
  await sweepDuePosts();
  const requeued = await requeueStuckTargets();
  // Abandoned or oversized browser-to-bucket uploads (1031g). Never let cleanup break the post sweep.
  const cleaned = await sweepDirectUploads().catch(() => 0);
  // Without Redis the jobs above are timers in this invocation: let them run before the response ends it
  // (1027). Budget = what is left of maxDuration minus 10 s of headroom; whatever is still running then is
  // held by waitUntil or picked up by the next sweep.
  const running = await settle(Math.max(0, 50_000 - (Date.now() - startedAt)));
  return NextResponse.json({ ok: true, requeued, cleaned, running }, { headers: { "cache-control": "no-store" } });
}

export const GET = sweep;
export const POST = sweep;

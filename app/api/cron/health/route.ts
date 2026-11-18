import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { heartbeatCheck, originOf, runHealthCycle } from "@/lib/health/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * R1195: the Watchdog's independent heartbeat monitor. Point a SECOND external pinger at this route (its own
 * cron-job.org job, every minute, same CRON_SECRET bearer). It reads the last health cycle the sweep recorded and,
 * when that has gone quiet, raises the "Watchdog itself has failed" incident and runs a health cycle of its own,
 * so monitoring (and alerting) continues while the sweep route is broken. `?full=1` always runs a cycle.
 * Without this second pinger the Watchdog can still see every service, but cannot see itself die: say so in the
 * System Health page's worker status.
 */
async function handle(req: NextRequest) {
  if (!env.CRON_SECRET) return NextResponse.json({ error: "Set CRON_SECRET to enable the watchdog heartbeat." }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const origin = originOf(req.nextUrl.origin);
  const hb = await heartbeatCheck(origin);
  const full = req.nextUrl.searchParams.get("full") === "1";
  const cycle = hb.stale || full ? await runHealthCycle({ origin, budgetMs: 40_000, source: "heartbeat" }).catch((e) => (console.error("[cron/health]", e), null)) : null;
  return NextResponse.json({ ok: true, heartbeat: { stale: hb.stale, lastCycleAgeMs: hb.ageMs, opened: hb.opened, resolved: hb.resolved }, cycle }, { headers: { "cache-control": "no-store" } });
}

export const GET = handle;
export const POST = handle;

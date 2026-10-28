import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/http";
import { limitShared } from "@/lib/rate-limit";
import { readSessionUserId } from "@/lib/auth";
import { liveStats, touchPresence } from "@/lib/presence";
import { liveView } from "@/lib/presence-core";

export const dynamic = "force-dynamic";

/**
 * Public live counts for the strip on every page. A signed-in caller's poll doubles as their presence
 * heartbeat. Only the thresholded view leaves the server, so tiny raw numbers are never exposed.
 */
export async function GET(req: NextRequest) {
  // Polled once a minute per visible tab; anything far beyond that is a script, and gets the empty view.
  const rl = await limitShared(`${clientIp(req)}:/api/stats/live`, 30, 60_000).catch(() => ({ ok: true }));
  if (!rl.ok) return NextResponse.json({ total: null, online: null }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  const uid = await readSessionUserId().catch(() => null);
  if (uid) void touchPresence(uid);
  try {
    const v = liveView(await liveStats());
    return NextResponse.json(v, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ total: null, online: null }, { headers: { "Cache-Control": "no-store" } });
  }
}

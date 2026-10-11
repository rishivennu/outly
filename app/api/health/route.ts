import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness + readiness for the load balancer: 200 only when this instance can reach its database. */
export async function GET() {
  const t = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, pid: process.pid, dbMs: Date.now() - t }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, pid: process.pid }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

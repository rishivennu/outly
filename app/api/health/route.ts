import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** What the database address looks like, without ever echoing the password or username. */
function shape(raw = process.env.DATABASE_URL ?? "") {
  try {
    const u = new URL(raw);
    return {
      scheme: u.protocol.replace(":", ""),
      host: u.hostname,
      port: u.port || "(none)",
      userHasProjectRef: u.username.includes("."),
      hasPassword: u.password.length > 0,
      passwordHasRawAt: raw.split("@").length > 2,
      pgbouncer: u.searchParams.get("pgbouncer") === "true",
    };
  } catch {
    return { parse: "DATABASE_URL is not a valid URL", length: raw.length, startsWith: raw.slice(0, 13) };
  }
}

/** Liveness + readiness: 200 only when this instance can reach its database. */
export async function GET() {
  const t = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, pid: process.pid, dbMs: Date.now() - t }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const err = e as { name?: string; errorCode?: string; code?: string; message?: string };
    const reason = String(err.message ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop()?.slice(0, 200);
    return Response.json(
      { ok: false, pid: process.pid, error: err.errorCode ?? err.code ?? err.name, reason, db: shape() },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

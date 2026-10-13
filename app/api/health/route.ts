import { db } from "@/lib/db";
import { hasAdminCookie } from "@/lib/admin/auth";
import { safeEqual } from "@/lib/crypto";

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
/** Diagnostics (DB host, driver error) only for a signed-in admin or the cron bearer; the public sees ok/false. */
async function trusted(req: Request) {
  const want = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (want && got && safeEqual(got, want)) return true;
  // Signature only: the diagnostics branch runs exactly when the database is unreachable.
  return hasAdminCookie();
}

export async function GET(req: Request) {
  const t = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, dbMs: Date.now() - t }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const err = e as { name?: string; errorCode?: string; code?: string; message?: string };
    if (!(await trusted(req))) return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
    const reason = String(err.message ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop()?.slice(0, 200);
    return Response.json(
      { ok: false, pid: process.pid, error: err.errorCode ?? err.code ?? err.name, reason, db: shape() },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

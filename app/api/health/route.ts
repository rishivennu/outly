import { db } from "@/lib/db";
import { hasAdminCookie } from "@/lib/admin/auth";
import { safeEqual } from "@/lib/crypto";
import { paymentsMock } from "@/lib/billing/service";
import { usingRedis } from "@/lib/queue";

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

const LATE_MS = 5 * 60_000;
let memo: { at: number; v: Awaited<ReturnType<typeof probeQueue>> } | null = null;

/**
 * Is anything actually going out? `overdue` counts scheduled posts whose time passed more than five
 * minutes ago, `stuck` platform uploads that were queued and never picked up: both should be 0, and
 * both being non-zero means no sweeper is running (see docs/DEPLOYMENT.md). Memoised, because the
 * load balancer polls this every few seconds.
 */
async function probeQueue() {
  const late = new Date(Date.now() - LATE_MS);
  const [overdue, stuck, payments] = await Promise.all([
    db.post.count({ where: { status: "scheduled", scheduledAt: { lt: late } } }),
    db.postTarget.count({ where: { platformStatus: "queued", updatedAt: { lt: late } } }),
    paymentsMock(),
  ]);
  return { queue: usingRedis() ? "redis" : "inline", overdue, stuck, paymentsMock: payments.mock };
}

async function queueInfo() {
  if (memo && Date.now() - memo.at < 15_000) return memo.v;
  const v = await probeQueue();
  memo = { at: Date.now(), v };
  return v;
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
    const dbMs = Date.now() - t;
    // Operational counters say nothing secret, but they are only useful to whoever runs the deploy.
    const extra = (await trusted(req)) ? await queueInfo().catch(() => ({})) : {};
    return Response.json({ ok: true, dbMs, ...extra }, { headers: { "cache-control": "no-store" } });
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

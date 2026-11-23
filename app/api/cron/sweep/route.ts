import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { requeueStuckTargets, sweepDirectUploads, sweepDuePosts } from "@/lib/queue/handlers";
import { settle } from "@/lib/queue";
import { lastSweepAt, recordSweep, SWEEP_DEDUPE_MS } from "@/lib/queue/health";
import { runCleanups } from "@/lib/account-cleanup";
import { sweepReminders } from "@/lib/retention/reminders";
import { cleanupSubs, drainOutbox } from "@/lib/push/webpush";
import { sweepPlan, wantsFull } from "@/lib/queue/plan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The minute sweeper. On a serverless host nothing stays running, so scheduled posts only go out when
 * something calls this every minute: Vercel Cron (vercel.json, Pro plan; R1297) or an external pinger such as
 * cron-job.org (Hobby only allows daily crons). It picks up posts whose time has come and re-queues platform uploads
 * that got stuck, and is safe to call as often as you like. Needs CRON_SECRET as a bearer token (Vercel Cron sends it
 * once the env var is set). GET and POST behave the same, so any pinger can drive it. `?full=1` runs every step at once.
 */
async function sweep(req: NextRequest) {
  const startedAt = Date.now();
  if (!env.CRON_SECRET) return NextResponse.json({ error: "Set CRON_SECRET to enable the sweeper." }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date(startedAt);
  const full = wantsFull(req.nextUrl);
  // R1297: a second caller inside the same minute (Vercel Cron and an external pinger both pointed here) would run
  // every step twice. The heartbeat says when the last sweep started; under SWEEP_DEDUPE_MS ago, this call answers
  // at once. ?full=1 always runs. An unreadable heartbeat never stops a sweep.
  if (!full) {
    const last = await lastSweepAt("cron");
    if (last !== null && startedAt - last < SWEEP_DEDUPE_MS) return NextResponse.json({ ok: true, skipped: "recent", lastAt: last }, { headers: { "cache-control": "no-store" } });
  }
  // The creator-facing steps run every minute; housekeeping runs on its slot (lib/queue/plan.ts).
  const plan = sweepPlan(now, full);
  // R1297: under Vercel Cron the request's Host is whatever URL the scheduler used (deployment or domain), so the
  // self-requests below (blog kick, watchdog probes) go to the public origin instead. Elsewhere the request origin is it.
  const origin = process.env.VERCEL ? env.APP_URL : req.nextUrl.origin;
  // No maintenance skip: members keep posting while maintenance is on, so their schedule must still run.
  await sweepDuePosts();
  const requeued = await requeueStuckTargets();
  // Heartbeat after the work, so a sweep that throws every minute still trips the admin warning.
  await recordSweep("cron");
  // Abandoned or oversized browser-to-bucket uploads (1031g). Never let cleanup break the post sweep.
  const cleaned = plan.housekeeping ? await sweepDirectUploads().catch(() => 0) : 0;
  // Files from deleted accounts (1053): retried with backoff until gone. Bounded, and never fatal.
  const files = plan.housekeeping ? await runCleanups({ budgetMs: 10_000 }).catch(() => ({ removed: 0, failed: 0 })) : null;
  // Notifications (1118): upcoming-post reminders, pushes a push service asked us to retry, lapsed devices.
  const reminders = await sweepReminders(now).catch((e) => (console.error("[sweep] reminders", e), null));
  const push = await drainOutbox(now).catch((e) => (console.error("[sweep] push", e), null));
  // 1141 event queue every minute (a failed post must not wait); greetings, inactivity, digests, partner deadlines on the slot.
  const assist = await import("@/lib/retention/sweep-notify").then((m) => m.sweepNotify(now, plan.housekeeping)).catch((e) => (console.error("[sweep] notify", e), null));
  // 1142: the one-time waitlist update email. Fixes its cutoff on the first housekeeping sweep after deploy; sends a short batch once launched.
  const campaign = plan.housekeeping ? await import("@/lib/campaigns").then((m) => m.sweepCampaigns()).catch((e) => (console.error("[sweep] campaign", e), null)) : null;
  // R1242: outcomes of posts made from recommendations, every 10 minutes, at most 10 owners a run (never fatal).
  const outcomes = new Date().getMinutes() % 10 === 4 ? await import("@/lib/intelligence/outcome").then((m) => m.sweepOutcomes({ maxOwners: 10 })).catch((e) => (console.error("[sweep] outcomes", e), null)) : null;
  // R1247: Content Memory backfill of the last 180 days, every 10 minutes (slot 7), at most 5 owners and 100 posts each (never fatal).
  const backfill = new Date().getMinutes() % 10 === 7
    ? await import("@/lib/intelligence/memory").then((m) => m.sweepBackfill({ maxOwners: 5, batch: 100 })).then((r) => ({ owners: r.owners, items: r.items })).catch((e) => (console.error("[sweep] backfill", e), null))
    : null;
  if (now.getMinutes() === 7) await cleanupSubs().catch(() => 0);
  const subs = await sweepSubscriptions(now); // 1147: trials, old signals, offer ledger + month rollover (never fatal)
  if (plan.housekeeping) await import("@/lib/accounts").then((m) => m.resubscribeCommentsOnce()).catch((e) => console.error("[sweep] comment subs", e)); // 1141b, runs once
  if (plan.metrics) await import("@/lib/analytics/sync").then((m) => m.syncMetrics({ budgetMs: 8_000 })).catch((e) => console.error("[sweep] metrics", e)); // 1140 analytics background sync, odd minutes
  // R1308 App Analytics: the daily rollups (today, yesterday, a few back-filled days) every 10 minutes on the metrics slot; raw rows pruned once a day. Never fatal.
  const rollup = plan.metrics && now.getMinutes() % 10 === 3 ? await import("@/lib/analytics/rollup").then((m) => m.sweepRollup(now)).catch((e) => (console.error("[sweep] rollup", e), null)) : null;
  if (plan.blog) await import("@/lib/blog/schedule").then((m) => m.kickBlogTick(origin)).catch((e) => console.error("[sweep] blog", e)); // R1178: due blog work runs in its own /api/cron/blog invocation
  // R1195 Watchdog: the health cycle rides the sweep (no always-on worker here). Budgeted, after the creator-facing
  // work, never fatal: monitoring must not delay a scheduled post. Services that do not fit stay due for the next cycle.
  // R1297: even minutes only (a 60 s service is checked every 2 minutes); the cycle's module graph is the heaviest import here.
  const health = plan.health
    ? await import("@/lib/health/engine")
        .then((m) => m.runHealthCycle({ origin: m.originOf(origin), budgetMs: Math.max(6_000, Math.min(22_000, 46_000 - (Date.now() - startedAt))), source: "sweep" }))
        .catch((e) => (console.error("[sweep] health", e), null))
    : null;
  // Without Redis the jobs above are timers in this invocation: let them run before the response ends it
  // (1027). Budget = what is left of maxDuration minus 10 s of headroom; whatever is still running then is
  // held by waitUntil or picked up by the next sweep.
  const running = await settle(Math.max(0, 50_000 - (Date.now() - startedAt)));
  return NextResponse.json({ ok: true, plan, requeued, cleaned, files, reminders, push, assist, campaign, outcomes, backfill, subs, health, rollup, running }, { headers: { "cache-control": "no-store" } });
}

/** 1147: trials every 5 minutes (expiry + reminders); signal pruning and the ledger/month sweep once an hour. */
async function sweepSubscriptions(now: Date) {
  const min = now.getMinutes();
  const trials = min % 5 === 0 ? await import("@/lib/subscriptions/trial").then((m) => m.sweepTrials(now)).catch((e) => (console.error("[sweep] trials", e), null)) : null;
  if (min !== 23) return { trials };
  const signals = await import("@/lib/subscriptions/signals").then((m) => m.pruneSignals(now)).catch((e) => (console.error("[sweep] signals", e), null));
  const ledger = await import("@/lib/subscriptions/lifecycle").then((m) => m.sweepExpired(now)).catch((e) => (console.error("[sweep] subscriptions", e), null));
  return { trials, signals, ledger };
}

export const GET = sweep;
export const POST = sweep;

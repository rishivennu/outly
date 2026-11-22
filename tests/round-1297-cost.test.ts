/**
 * R1297: compute cost. The Hobby team was paused at 4 h of Active CPU a month, half of it the minute sweep running
 * every one of its sub-sweeps every minute. These pin the new shape: creator-facing work every minute, housekeeping on
 * slots, the sweep driven by Vercel Cron, the watchdog's staleness widened to match its 2 minute cycle, and the
 * client heartbeats that only run while someone is at the tab.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BLOG_SLOT, HOUSEKEEPING_SLOT, sweepPlan, wantsFull } from "@/lib/queue/plan";
import { CYCLE_STALE_MS, CYCLE_STALE_SEC } from "@/lib/health/core";

const src = (p: string) => readFileSync(p, "utf8");
const at = (min: number) => new Date(2026, 10, 22, 10, min, 0);

describe("sweepPlan", () => {
  test("the core runs every minute of the hour", () => {
    for (let m = 0; m < 60; m++) expect(sweepPlan(at(m)).core).toBe(true);
  });
  test("health on even minutes, metrics on odd: never both, never neither", () => {
    for (let m = 0; m < 60; m++) {
      const p = sweepPlan(at(m));
      expect(p.health).toBe(m % 2 === 0);
      expect(p.metrics).toBe(m % 2 === 1);
      expect(p.health !== p.metrics).toBe(true);
    }
  });
  test("housekeeping and the blog kick each get one minute in five, on different minutes", () => {
    const hk = Array.from({ length: 60 }, (_, m) => m).filter((m) => sweepPlan(at(m)).housekeeping);
    const blog = Array.from({ length: 60 }, (_, m) => m).filter((m) => sweepPlan(at(m)).blog);
    expect(hk).toHaveLength(12);
    expect(blog).toHaveLength(12);
    expect(hk.every((m) => m % 5 === HOUSEKEEPING_SLOT)).toBe(true);
    expect(blog.every((m) => m % 5 === BLOG_SLOT)).toBe(true);
    expect(hk.some((m) => blog.includes(m))).toBe(false);
  });
  test("housekeeping avoids the 10-minute outcome (:x4) and backfill (:x7) slots", () => {
    for (let m = 0; m < 60; m++) {
      const p = sweepPlan(at(m));
      if (p.housekeeping) expect([4, 7].includes(m % 10)).toBe(false);
    }
  });
  test("full runs everything", () => {
    expect(sweepPlan(at(3), true)).toEqual({ core: true, health: true, metrics: true, housekeeping: true, blog: true });
  });
  test("?full=1 (or true/yes) forces it; anything else does not", () => {
    expect(wantsFull(new URL("https://x.test/api/cron/sweep?full=1"))).toBe(true);
    expect(wantsFull(new URL("https://x.test/api/cron/sweep?full=true"))).toBe(true);
    expect(wantsFull(new URL("https://x.test/api/cron/sweep?full=yes"))).toBe(true);
    expect(wantsFull(new URL("https://x.test/api/cron/sweep"))).toBe(false);
    expect(wantsFull(new URL("https://x.test/api/cron/sweep?full=0"))).toBe(false);
    expect(wantsFull(new URL("https://x.test/api/cron/sweep?full=maybe"))).toBe(false);
  });
});

describe("the sweep route follows the plan", () => {
  const s = src("app/api/cron/sweep/route.ts");
  test("one plan per call, from the request clock and ?full", () => {
    expect(s).toContain('import { sweepPlan, wantsFull } from "@/lib/queue/plan";');
    expect(s).toContain("const plan = sweepPlan(now, wantsFull(req.nextUrl));");
    expect(s).toContain("const now = new Date(startedAt);");
  });
  test("every minute: due posts, stuck targets, heartbeat, reminders, push outbox, the notification events", () => {
    for (const line of ["await sweepDuePosts();", "const requeued = await requeueStuckTargets();", 'await recordSweep("cron");', "await sweepReminders(now)", "await drainOutbox(now)", "m.sweepNotify(now, plan.housekeeping)"]) {
      expect(s).toContain(line);
      expect(s.split("\n").find((l) => l.includes(line))!).not.toMatch(/plan\.(health|metrics|blog) \?/);
    }
    // The core lines carry no slot condition at all (sweepNotify drains the events every minute; its own flag decides the rest).
    for (const line of ["await sweepDuePosts();", "const requeued = await requeueStuckTargets();", 'await recordSweep("cron");', "await sweepReminders(now)", "await drainOutbox(now)"]) {
      expect(s.split("\n").find((l) => l.includes(line))!).not.toContain("plan.");
    }
  });
  test("housekeeping slot: uploads, cleanups, campaigns, comment re-subscribe", () => {
    expect(s).toContain("plan.housekeeping ? await sweepDirectUploads().catch(() => 0) : 0");
    expect(s).toContain("plan.housekeeping ? await runCleanups({ budgetMs: 10_000 })");
    expect(s).toContain('plan.housekeeping ? await import("@/lib/campaigns").then((m) => m.sweepCampaigns()).catch(');
    expect(s).toContain('if (plan.housekeeping) await import("@/lib/accounts").then((m) => m.resubscribeCommentsOnce())');
  });
  test("metrics on its minutes, blog on its slot, health on its minutes, each still never fatal", () => {
    expect(s).toContain('if (plan.metrics) await import("@/lib/analytics/sync").then((m) => m.syncMetrics({ budgetMs: 8_000 })).catch(');
    expect(s).toContain('if (plan.blog) await import("@/lib/blog/schedule").then((m) => m.kickBlogTick(origin)).catch(');
    // Vercel Cron's Host header is the scheduler's choice, so self-requests use the public origin there.
    expect(s).toContain("const origin = process.env.VERCEL ? env.APP_URL : req.nextUrl.origin;");
    expect(s).toContain("m.runHealthCycle({ origin: m.originOf(origin),");
    expect(s).toMatch(/const health = plan\.health\s+\? await import\("@\/lib\/health\/engine"\)/);
    expect(s).toContain('.catch((e) => (console.error("[sweep] health", e), null))\n    : null;');
  });
  test("the untouched slots stay as they were (R1242 outcomes, R1247 backfill, 1147 subscriptions, cleanupSubs at :07)", () => {
    expect(s).toContain("getMinutes() % 10 === 4 ? await import(\"@/lib/intelligence/outcome\")");
    expect(s).toContain("getMinutes() % 10 === 7\n    ? await import(\"@/lib/intelligence/memory\")");
    expect(s).toContain("if (now.getMinutes() === 7) await cleanupSubs()");
    expect(s).toContain("const subs = await sweepSubscriptions(now);");
  });
  test("the answer reports the plan it ran", () => {
    expect(s).toContain("NextResponse.json({ ok: true, plan, requeued,");
  });
});

describe("sweepNotify drains events every minute and does the rest on the slot", () => {
  const s = src("lib/retention/sweep-notify.ts");
  test("signature and the three gated steps", () => {
    expect(s).toContain("export async function sweepNotify(now = new Date(), full = true) {");
    expect(s).toContain("const assist = full ? await sweepAssistant(now)");
    expect(s).toContain("const digests = full ? await sweepDigests(now)");
    expect(s).toContain("const partners = full ? await import(\"../partners/notices\")");
    expect(s).toContain("const events = await drainEvents(now)");
    expect(s.split("\n").find((l) => l.includes("const events = await drainEvents(now)"))!).not.toContain("full ?");
  });
});

describe("Vercel Cron drives the sweep", () => {
  const v = JSON.parse(src("vercel.json")) as { crons: { path: string; schedule: string }[] };
  test("a per-minute entry, first in the list, next to the daily ones", () => {
    expect(v.crons[0]).toEqual({ path: "/api/cron/sweep", schedule: "* * * * *" });
    expect(v.crons.map((c) => c.path)).toEqual(["/api/cron/sweep", "/api/cron/weekly-report", "/api/cron/retention", "/api/cron/blog"]);
  });
  test("the route still takes the bearer Vercel sends, GET or POST", () => {
    const s = src("app/api/cron/sweep/route.ts");
    expect(s).toContain('safeEqual(req.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`)');
    expect(s).toContain("export const GET = sweep;");
    expect(s).toContain("export const POST = sweep;");
  });
  test("the deploy doc says so, and tells a Pro team to switch the external pinger off", () => {
    const d = src("docs/DEPLOYMENT.md");
    expect(d).toContain("**The sweep is in `vercel.json` (R1297, Vercel Pro).**");
    expect(d).toContain("switch that pinger off");
    expect(d).toContain("`?full=1`");
    expect(d).not.toContain("The sweep is not in `vercel.json`, on purpose");
  });
  test("the admin hint and the watchdog causes no longer assume cron-job.org", () => {
    expect(src("app/admin/(panel)/layout.tsx")).toContain("Check the minute cron (Vercel Crons tab, or the external pinger)");
    expect(src("lib/health/checks.ts")).not.toContain("The external pinger (cron-job.org) stopped");
    expect(src("lib/health/engine.ts")).not.toContain("The minute pinger for /api/cron/sweep stopped");
  });
});

describe("the watchdog tolerates its 2 minute cycle", () => {
  test("stale only past 5 minutes, one constant for the engine and the admin screen", () => {
    expect(CYCLE_STALE_MS).toBe(5 * 60_000);
    expect(CYCLE_STALE_SEC).toBe(300);
    expect(src("lib/health/engine.ts")).toContain("const stale = ageMs === null || ageMs > CYCLE_STALE_MS;");
    expect(src("components/admin/health/SystemHealth.tsx")).toContain("worker.lastCycle.ageSec < CYCLE_STALE_SEC");
    expect(src("components/admin/health/SystemHealth.tsx")).toContain('import { CYCLE_STALE_SEC } from "@/lib/health/core";');
  });
  test("a cycle 2 minutes plus a slow sweep ago is fine; two missed cycles are not", () => {
    expect(2 * 60_000 + 40_000 > CYCLE_STALE_MS).toBe(false);
    expect(6 * 60_000 > CYCLE_STALE_MS).toBe(true);
  });
  test("core stays importable from the browser (no server-only, only the registry)", () => {
    const c = src("lib/health/core.ts");
    expect(c).not.toContain("server-only");
    expect(c.match(/^import .* from "(.*)";$/gm)?.map((l) => l.match(/from "(.*)"/)![1])).toEqual(["./registry"]);
    expect(src("lib/health/registry.ts")).not.toMatch(/^import /m);
  });
});

describe("client heartbeats only while someone is there", () => {
  test("Home's Sending now: 90 s quiet heartbeat gated by pollable(), a busy send keeps its fast poll", () => {
    const s = src("components/home/SendingNow.tsx");
    expect(s).toContain("const IDLE_MS = 90_000;");
    expect(s).toContain("const BUSY_MS = 6000;");
    expect(s).toContain('import { pollable } from "@/lib/client/idle";');
    expect(s).toContain("if (busy || pollable()) void load();");
  });
  test("the shell's SendingPill: 90 s quiet heartbeat, still pollable-gated, fast poll untouched", () => {
    const s = src("components/shell/SendingPill.tsx");
    expect(s).toContain("const IDLE_MS = 90_000;");
    expect(s).toContain("const FAST = 4000;");
    expect(s).toContain("const SLOW = 10_000;");
    expect(s).toContain("(polling || pollable()) && void check()");
  });
  test("the notices bell shares one answer across navigations for 30 s; pushes, tab return and a failed mark-read bypass it", () => {
    const s = src("components/shell/NoticesBell.tsx");
    expect(s).toContain("export const SHARE_MS = 30_000;");
    expect(s).toContain("if (!fresh && inflight && Date.now() - inflight.at < SHARE_MS) return inflight.p;");
    expect(s).toContain('const onFocus = () => document.visibilityState === "visible" && load(true);');
    expect(s).toContain("const onPush = () => load(true);");
    expect(s).toContain(".catch(() => load(true));");
  });
});

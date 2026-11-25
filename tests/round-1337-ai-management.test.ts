/**
 * R1337: Admin > AI Intelligence Management.
 *
 * Pure: the access distribution runs the same plan rule as the routes over every live candidate (perk, pre-perk paid,
 * plan without the perk, Free, a Free plan that lists the perk, the best candidate per account); job statistics
 * (percentiles, success rate, personal sums, forecast latency, error text); denials, retention, freshness, orphans and
 * the isolation verdict. Db: the job log records success, failure (and rethrows), skips "nothing to do", prunes and
 * summarises; `intelligenceManagement()` moves with real rows (a paid account with the perk, one without, a pre-perk
 * plan, a free account, a denial, a consent grant, a profile, a downgrade, an orphaned profile) and never shows a
 * placeholder. Source pins: the model in both schemas, the sweep and routes log through the job log, the nav entry, the
 * page reads the aggregator and the admin area.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "../lib/db";
import { grantConsent } from "../lib/intelligence/consent";
import { requireIntelligence } from "../lib/intelligence/entitlements";
import { INTELLIGENCE_JOB_RETENTION_DAYS, errorText, percentile, predictLatency, sumPersonalRuns, summarizeRuns } from "../lib/intelligence/jobs-core";
import { jobsSummary, pruneJobRuns, recordJobRun, runJob } from "../lib/intelligence/jobs";
import { accessDistribution, freshnessOf, isolationVerdict, orphanedOwners, retentionLine, summarizeDenials, type AccessRow, type PlanLite } from "../lib/intelligence/management-core";
import { intelligenceManagement } from "../lib/intelligence/management";
import { downgrade, withIntelligence, withoutIntelligence } from "./helpers/intelligence-plan";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const DAY = 864e5;
const NOW = new Date("2026-11-25T12:00:00Z");
let n = 0;
const user = () => db.user.create({ data: { name: `M ${++n}`, email: `r1337-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x" } });

const plan = (slug: string, perks: string, sortOrder = 1): PlanLite => ({ slug, name: slug.toUpperCase(), sortOrder, perks });
const PERK = plan("creator", '["personal-intelligence","weekly-digest"]', 2);
const NOPERK = plan("starter", '["weekly-digest"]', 1);
const LEGACY = plan("old-pro", "", 3);
const FREE = plan("free", '["weekly-digest"]', 0);
const row = (userId: string, p: PlanLite, source: AccessRow["source"] = "paid", endsAt: Date | null = new Date(NOW.getTime() + 10 * DAY)): AccessRow => ({ userId, source, endsAt, plan: p });

describe("R1337 access distribution, pure", () => {
  test("each account counted once under its winning plan; the perk rule decides", () => {
    const d = accessDistribution({
      users: 7,
      candidates: [row("a", PERK), row("b", NOPERK), row("c", LEGACY), row("d", PERK, "admin"), row("e", NOPERK), row("e", PERK, "referral")], // e: referral on the higher tier wins
      freePlan: FREE,
    });
    expect(d.users).toBe(7);
    expect(d.perk).toBe(3); // a, d, e
    expect(d.legacyPaid).toBe(1); // c
    expect(d.planWithoutPerk).toBe(1); // b
    expect(d.free).toBe(2); // f, g (no candidate)
    expect(d.withAccess).toBe(4);
    expect(d.freePlanGrantsAccess).toBe(false);
    expect(d.bySource).toEqual({ paid: 3, admin: 1, referral: 1, gift: 0, free: 2 });
    expect(d.byPlan.map((p) => [p.planSlug, p.users, p.enabled, p.reason])).toEqual([
      ["creator", 3, true, "perk"],
      ["free", 2, false, "free"],
      ["old-pro", 1, true, "legacy-paid"],
      ["starter", 1, false, "plan-without-perk"],
    ]);
    expect(d.truncated).toBe(false);
  });

  test("a gift subscription on a pre-perk plan has the engine; the same plan on Free source does not", () => {
    const d = accessDistribution({ users: 2, candidates: [row("a", LEGACY, "gift")], freePlan: plan("free", "", 0) });
    expect(d.legacyPaid).toBe(1);
    expect(d.free).toBe(1);
    expect(d.withAccess).toBe(1);
  });

  test("a Free plan that lists the perk gives free accounts the engine and says so", () => {
    const d = accessDistribution({ users: 3, candidates: [row("a", NOPERK)], freePlan: plan("free", '["personal-intelligence"]', 0) });
    expect(d.free).toBe(2);
    expect(d.perk).toBe(0);
    expect(d.withAccess).toBe(2);
    expect(d.freePlanGrantsAccess).toBe(true);
    expect(d.byPlan.find((p) => p.planSlug === "free")?.enabled).toBe(true);
  });

  test("no Free plan row and no candidates: everyone is free, nobody has the engine", () => {
    const d = accessDistribution({ users: 4, candidates: [], freePlan: null, truncated: true });
    expect(d).toMatchObject({ users: 4, free: 4, withAccess: 0, truncated: true, byPlan: [] });
    expect(d.bySource.free).toBe(4);
  });
});

describe("R1337 job statistics, pure", () => {
  const at = (h: number) => new Date(NOW.getTime() - h * 36e5);
  const runs = [
    { job: "personal", ok: true, durationMs: 100, startedAt: at(5), result: JSON.stringify({ owners: 2, features: 10, failed: 1, skipped: 3 }) },
    { job: "personal", ok: true, durationMs: 300, startedAt: at(4), result: JSON.stringify({ owners: 0, features: 0, failed: 0, skipped: 0 }) },
    { job: "personal", ok: false, durationMs: 50, startedAt: at(1), error: "boom", result: null },
    { job: "shared", ok: true, durationMs: 2000, startedAt: at(3), result: null },
    { job: "predict", ok: true, durationMs: 40, startedAt: at(2), result: null },
    { job: "predict", ok: true, durationMs: 90, startedAt: at(2), result: null },
    { job: "predict", ok: false, durationMs: 400, startedAt: at(2), result: null, error: "x" },
  ];

  test("percentile is nearest-rank and safe on an empty list", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });

  test("summarizeRuns gives one line per job with rate, last run, error and percentiles", () => {
    const s = summarizeRuns(runs);
    expect(s.map((x) => x.job)).toEqual(["personal", "shared", "predict"]);
    const p = s[0];
    expect(p).toMatchObject({ runs: 3, failed: 1, successRate: 66.7, lastOk: false, lastError: "boom", durationMs: { p50: 100, p95: 300, max: 300 } });
    expect(p.lastAt).toBe(at(1).toISOString());
    expect(s[1]).toMatchObject({ runs: 1, failed: 0, successRate: 100, lastOk: true, lastError: null });
    expect(summarizeRuns([])[2]).toMatchObject({ runs: 0, successRate: null, lastAt: null, lastOk: null, durationMs: null });
  });

  test("personal sums and forecast latency come from the rows, null when nothing was measured", () => {
    expect(sumPersonalRuns(runs)).toEqual({ runs: 3, withWork: 1, owners: 2, features: 10, failedOwners: 1, skipped: 3 });
    expect(predictLatency(runs)).toEqual({ n: 3, p50: 90, p95: 400, failed: 1 });
    expect(predictLatency(runs.filter((r) => r.job !== "predict"))).toBeNull();
  });

  test("errorText keeps the message only, one line, at most 500 characters", () => {
    expect(errorText(new Error("a\nb   c"))).toBe("a b c");
    expect(errorText("x".repeat(900))).toHaveLength(500);
    expect(errorText(undefined)).toBe("Unknown error");
    expect(errorText(new Error(""))).toBe("Unknown error");
  });
});

describe("R1337 privacy rules, pure", () => {
  test("denials are counted by capability and reason, with distinct owners and the last 7 days", () => {
    const d = summarizeDenials(
      [
        { ownerId: "a", data: JSON.stringify({ capability: "personalized_predictions_enabled", reason: "free" }), at: new Date(NOW.getTime() - DAY) },
        { ownerId: "a", data: JSON.stringify({ capability: "personal_intelligence_enabled", reason: "free" }), at: new Date(NOW.getTime() - 10 * DAY) },
        { ownerId: "b", data: "not json", at: new Date(NOW.getTime() - 2 * DAY) },
      ],
      NOW,
    );
    expect(d).toEqual({ total: 3, owners: 2, last7d: 2, byCapability: { personalized_predictions_enabled: 1, personal_intelligence_enabled: 1, unknown: 1 }, byReason: { free: 2, unknown: 1 }, lastAt: new Date(NOW.getTime() - DAY).toISOString() });
  });

  test("retention is ok within the window (a day of grace), overdue past it, empty with no row", () => {
    expect(retentionLine("x", "X", 30, new Date(NOW.getTime() - 30.5 * DAY), NOW)).toMatchObject({ status: "ok", oldestAgeDays: 30 });
    expect(retentionLine("x", "X", 30, new Date(NOW.getTime() - 32 * DAY), NOW)).toMatchObject({ status: "overdue", oldestAgeDays: 32 });
    expect(retentionLine("x", "X", 30, null, NOW)).toMatchObject({ status: "empty", oldestAt: null, oldestAgeDays: null });
  });

  test("freshness, orphans and the verdict", () => {
    expect(freshnessOf({ total: 10, fresh: 7, oldestAt: new Date(NOW.getTime() - 26 * 36e5), staleMs: 6 * 36e5 }, NOW)).toMatchObject({ total: 10, fresh: 7, stale: 3, staleHours: 6, oldestAgeHours: 26 });
    expect(freshnessOf({ total: 0, fresh: 0, oldestAt: null, staleMs: 6 * 36e5 }, NOW)).toMatchObject({ stale: 0, oldestAt: null, oldestAgeHours: null });
    expect(orphanedOwners(["a", "b", "b", "c"], new Set(["a"]))).toBe(2);
    expect(isolationVerdict([{ ok: true }, { ok: null }])).toBe("verified");
    expect(isolationVerdict([{ ok: true }, { ok: false }])).toBe("attention");
    expect(isolationVerdict([{ ok: null }, { ok: null }])).toBe("unverified");
    expect(isolationVerdict([])).toBe("unverified");
  });
});

describe("R1337 job log, db", () => {
  test("runJob records success with the result, failure with the error (and rethrows), nothing when skipped", async () => {
    const before = await db.intelligenceJobRun.count();
    const r = await runJob("personal", "sweep", async () => ({ owners: 1, features: 4, failed: 0, skipped: 2 }));
    expect(r.owners).toBe(1);
    await expect(runJob("shared", "admin", async () => { throw new Error("rebuild blew up\nsecond line"); })).rejects.toThrow("rebuild blew up");
    const skipped = await runJob("shared", "sweep", async () => null, { skip: (x) => x === null });
    expect(skipped).toBeNull();
    const rows = await db.intelligenceJobRun.findMany({ orderBy: { finishedAt: "desc" }, take: 2 });
    expect(await db.intelligenceJobRun.count()).toBe(before + 2);
    const failed = rows.find((x) => !x.ok)!;
    const ok = rows.find((x) => x.ok)!;
    expect(failed).toMatchObject({ job: "shared", trigger: "admin", error: "rebuild blew up second line", result: null });
    expect(ok).toMatchObject({ job: "personal", trigger: "sweep", error: null });
    expect(JSON.parse(ok.result!)).toEqual({ owners: 1, features: 4, failed: 0, skipped: 2 });
    expect(ok.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("recordJobRun never throws and prune removes rows past retention; the summary reads the window", async () => {
    const old = new Date(Date.now() - (INTELLIGENCE_JOB_RETENTION_DAYS + 2) * DAY);
    expect(await recordJobRun("predict", { trigger: "api", startedAt: old.getTime() - 25, ok: true, now: old, result: { level: "personal" } })).toBe(true);
    expect(await recordJobRun("predict", { trigger: "api", startedAt: Date.now() - 30, ok: true, result: { level: "blended" } })).toBe(true);
    expect(await recordJobRun("predict", { trigger: "api", startedAt: Date.now() - 70, ok: false, error: new Error("scorer down") })).toBe(true);
    expect(await db.intelligenceJobRun.count({ where: { startedAt: { lt: new Date(Date.now() - INTELLIGENCE_JOB_RETENTION_DAYS * DAY) } } })).toBeGreaterThanOrEqual(1);
    await pruneJobRuns();
    expect(await db.intelligenceJobRun.count({ where: { startedAt: { lt: new Date(Date.now() - INTELLIGENCE_JOB_RETENTION_DAYS * DAY) } } })).toBe(0);
    const s = await jobsSummary();
    expect(s.windowDays).toBe(30);
    expect(s.retentionDays).toBe(INTELLIGENCE_JOB_RETENTION_DAYS);
    const predict = s.jobs.find((x) => x.job === "predict")!;
    expect(predict.runs).toBeGreaterThanOrEqual(2);
    expect(predict.failed).toBeGreaterThanOrEqual(1);
    expect(s.predict).not.toBeNull();
    expect(s.predict!.n).toBeGreaterThanOrEqual(2);
    expect(s.predict!.p50).toBeGreaterThanOrEqual(0);
    expect(s.oldestRowAt === null || new Date(s.oldestRowAt).getTime() >= Date.now() - (INTELLIGENCE_JOB_RETENTION_DAYS + 1) * DAY).toBe(true);
  });
});

describe("R1337 management aggregator, db", () => {
  test("every section moves with real rows and nothing is a placeholder", async () => {
    const base = await intelligenceManagement();
    expect(typeof base.at).toBe("string");

    // Four accounts: the perk, a paid plan without it, a pre-perk plan, and Free.
    const a = await withIntelligence(await user());
    const b = await withoutIntelligence(await user());
    const c = await user();
    const legacyPlan = await db.plan.create({ data: { slug: `t-legacy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: "Legacy Pro", priceMinor: 100, state: "hidden", perks: "", sortOrder: 9 } });
    const d = await user();
    await db.subscription.create({ data: { userId: d.id, planId: legacyPlan.id, status: "active", priceMinor: 100, currency: "INR", interval: "month", provider: "mock", currentPeriodEnd: new Date(Date.now() + 30 * DAY) } });
    // b asks for a paid capability: a denial on record. a consents. a gets a profile.
    await expect(requireIntelligence(b.id, "personalized_predictions_enabled")).rejects.toMatchObject({ status: 402 });
    await new Promise((r) => setTimeout(r, 30)); // the denial is logged off the request path
    await grantConsent(a.id, { source: "settings", categories: ["content_metadata", "performance_signals"] });
    await db.creatorProfile.create({ data: { ownerId: a.id, scopeKey: "", platform: "", version: 1, level: "personal", postsTotal: 12, postsMeasured: 9, data: "{}" } });

    const m = await intelligenceManagement();
    expect(m.access.users).toBe(base.access.users + 4);
    expect(m.access.perk).toBe(base.access.perk + 1);
    expect(m.access.planWithoutPerk).toBe(base.access.planWithoutPerk + 1);
    expect(m.access.legacyPaid).toBe(base.access.legacyPaid + 1);
    expect(m.access.free).toBe(base.access.free + 1);
    expect(m.access.withAccess).toBe(base.access.withAccess + 2);
    expect(m.access.byPlan.find((p) => p.planSlug === legacyPlan.slug)).toMatchObject({ users: 1, enabled: true, reason: "legacy-paid" });
    expect(m.denials.total).toBe(base.denials.total + 1);
    expect(m.denials.owners).toBe(base.denials.owners + 1);
    expect(m.denials.byCapability.personalized_predictions_enabled ?? 0).toBe((base.denials.byCapability.personalized_predictions_enabled ?? 0) + 1);
    expect(m.denials.byReason["plan-without-perk"] ?? 0).toBe((base.denials.byReason["plan-without-perk"] ?? 0) + 1);
    expect(m.consent.granted).toBe(base.consent.granted + 1);
    expect(m.consent.byCategory.content_metadata ?? 0).toBe((base.consent.byCategory.content_metadata ?? 0) + 1);
    expect(m.consent.byCategory.production_signals ?? 0).toBe(base.consent.byCategory.production_signals ?? 0);
    expect(m.consent.byPolicyVersion[m.consent.policyVersion]).toBe((base.consent.byPolicyVersion[m.consent.policyVersion] ?? 0) + 1);
    expect(m.privacy.decisions.total).toBe(base.privacy.decisions.total + 1);
    expect(m.privacy.decisions.lastAt).not.toBeNull();
    expect(m.personal.profiles.owners).toBe(base.personal.profiles.owners + 1);
    expect(m.personal.profiles.byLevel.personal ?? 0).toBe((base.personal.profiles.byLevel.personal ?? 0) + 1);
    expect(m.personal.profiles.freshness.fresh).toBe(base.personal.profiles.freshness.fresh + 1);
    expect(m.personal.retainedWithoutAccess).toBe(base.personal.retainedWithoutAccess);
    expect(m.shared.eligible.consented).toBe(m.consent.granted);
    expect(m.privacy.retention.map((r) => r.key)).toEqual(["builds", "jobs"]);
    expect(m.privacy.isolation.checks.map((x) => x.key)).toEqual(["shared-validation", "consent-only", "mirrors", "orphans", "lineage"]);
    expect(["verified", "attention", "unverified"]).toContain(m.privacy.isolation.verdict);
    // Forecast latency is null until measured, never a made-up number.
    expect(m.personal.jobs.predict === null || typeof m.personal.jobs.predict.p50 === "number").toBe(true);

    // a is downgraded: the profile stays as data and is counted as retained without access; the perk count falls.
    await downgrade(a.id);
    const after = await intelligenceManagement();
    expect(after.access.perk).toBe(m.access.perk - 1);
    expect(after.access.free).toBe(m.access.free + 1);
    expect(after.personal.profiles.owners).toBe(m.personal.profiles.owners);
    expect(after.personal.retainedWithoutAccess).toBe(m.personal.retainedWithoutAccess + 1);
    expect(after.consent.granted).toBe(m.consent.granted); // consent is not the plan

    // An orphaned profile (its account gone) fails the isolation check; removing it restores the verdict.
    const orphanBefore = after.privacy.isolation.checks.find((x) => x.key === "orphans")!;
    const ghost = await db.creatorProfile.create({ data: { ownerId: `ghost-${Date.now()}`, scopeKey: "", platform: "", version: 1, level: "none", data: "{}" } });
    const withGhost = await intelligenceManagement();
    expect(withGhost.privacy.isolation.checks.find((x) => x.key === "orphans")).toMatchObject({ ok: false });
    expect(withGhost.privacy.isolation.verdict).toBe("attention");
    await db.creatorProfile.delete({ where: { id: ghost.id } });
    expect((await intelligenceManagement()).privacy.isolation.checks.find((x) => x.key === "orphans")!.ok).toBe(orphanBefore.ok);
  });
});

describe("R1337 source pins", () => {
  test("the job log model is in both schemas; the sweep, the admin rebuild and the forecast route log through it", () => {
    for (const p of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) {
      const s = read(p);
      expect(s).toContain("model IntelligenceJobRun {");
      expect(s).toMatch(/model IntelligenceJobRun \{[\s\S]*?@@index\(\[job, startedAt\]\)/);
      expect(/model IntelligenceJobRun \{[\s\S]*?\n\}/.exec(s)![0]).not.toContain("userId");
    }
    const sweep = read("app/api/cron/sweep/route.ts");
    expect(sweep).toContain('jobs.runJob("personal", "sweep"');
    expect(sweep).toContain('jobs.runJob("shared", "sweep"');
    expect(sweep).toContain("skip: (r) => r === null");
    expect(sweep).toContain("jobs.pruneJobRuns(now)");
    expect(read("app/api/admin/intelligence/route.ts")).toContain('runJob("shared", "admin"');
    const pred = read("app/api/intelligence/predictions/route.ts");
    expect(pred).toContain('recordJobRun("predict", { trigger: "api", startedAt, ok: true');
    expect(pred).toContain('recordJobRun("predict", { trigger: "api", startedAt, ok: false');
  });

  test("the admin page reads the aggregator behind the intelligence area and sits in the nav", () => {
    const page = read("app/admin/(panel)/intelligence/management/page.tsx");
    expect(page).toContain('requireAdmin("intelligence")');
    expect(page).toContain("await intelligenceManagement()");
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain("Not measured yet");
    expect(read("components/admin/AdminShell.tsx")).toContain('href: "/admin/intelligence/management", label: "AI Management"');
    expect(read("app/admin/(panel)/intelligence/page.tsx")).toContain('href="/admin/intelligence/management"');
  });
});

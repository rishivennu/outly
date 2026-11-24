/**
 * R1326 Phase 8 hardening: clipper retention + abandonment sweep, the per-user daily AI budget, and the wiring
 * (sweep slot, detect route fallback, docs). Pure rules first, then the sweep against the dev database.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ABANDON_BATCH, ABANDON_DAYS, ABANDONED_ERROR, CANDIDATE_RETENTION_DAYS, DAY_MS, RETENTION_BATCH, TRANSCRIPT_RETENTION_DAYS, candidatesExpired, closedAt, isAbandoned, isClosed, isTerminal, retentionCutoffs, retentionLine, transcriptExpired } from "../lib/clipper/retention-core";
import { DEFAULT_CLIPPER_CAP, budgetVerdict, capFrom, rupees, unavailableVerdict } from "../lib/clipper/budget-core";

mock.module("next/headers", () => ({
  cookies: () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));

let db: typeof import("../lib/db").db;
let ret: typeof import("../lib/clipper/retention");
let budget: typeof import("../lib/clipper/budget");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  ret = await import("../lib/clipper/retention");
  budget = await import("../lib/clipper/budget");
});

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const now = new Date("2026-11-25T10:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
const job = (o: Partial<{ status: string; stage: string; heartbeatAt: Date | null; updatedAt: Date; completedAt: Date | null }>) => ({ status: "ready", stage: "done", heartbeatAt: null, updatedAt: ago(1), completedAt: null, ...o });

describe("R1326 retention rules (pure)", () => {
  test("closed = failed, cancelled, or ready with the review done; the desk (ready/review) and live jobs are open", () => {
    expect(isClosed({ status: "failed", stage: "detect" })).toBe(true);
    expect(isClosed({ status: "cancelled", stage: "transcribe" })).toBe(true);
    expect(isClosed({ status: "ready", stage: "done" })).toBe(true);
    expect(isClosed({ status: "ready", stage: "review" })).toBe(false);
    expect(isClosed({ status: "running", stage: "detect" })).toBe(false);
    expect(isClosed({ status: "queued", stage: "transcribe" })).toBe(false);
    // R1328 review: a failed job is closed for the clock but not terminal; it can be retried at its stage, so its transcript stays.
    expect(isTerminal({ status: "failed", stage: "detect" })).toBe(false);
    expect(isTerminal({ status: "cancelled", stage: "detect" })).toBe(true);
    expect(isTerminal({ status: "ready", stage: "done" })).toBe(true);
    expect(isTerminal({ status: "ready", stage: "review" })).toBe(false);
  });

  test("the clock starts when the job closed: completedAt first, updatedAt for a failed job, null while open", () => {
    expect(closedAt(job({ completedAt: ago(5), updatedAt: ago(1) }))).toEqual(ago(5));
    expect(closedAt(job({ status: "failed", stage: "detect", updatedAt: ago(3) }))).toEqual(ago(3));
    expect(closedAt(job({ status: "ready", stage: "review", completedAt: ago(500) }))).toBeNull();
  });

  test("transcripts at 90 days, spare candidates at 30, both from close and never from creation", () => {
    expect(TRANSCRIPT_RETENTION_DAYS).toBe(90);
    expect(CANDIDATE_RETENTION_DAYS).toBe(30);
    expect(transcriptExpired(job({ completedAt: ago(91) }), now)).toBe(true);
    expect(transcriptExpired(job({ completedAt: ago(89) }), now)).toBe(false);
    expect(transcriptExpired(job({ status: "failed", stage: "detect", updatedAt: ago(400) }), now)).toBe(false); // kept for a retry
    expect(candidatesExpired(job({ status: "failed", stage: "detect", updatedAt: ago(40) }), now)).toBe(true); // a retry detects afresh
    expect(candidatesExpired(job({ completedAt: ago(31) }), now)).toBe(true);
    expect(candidatesExpired(job({ completedAt: ago(29) }), now)).toBe(false);
    // Open for 200 days, closed yesterday: nothing expires.
    expect(transcriptExpired(job({ status: "ready", stage: "review", updatedAt: ago(200) }), now)).toBe(false);
    expect(candidatesExpired(job({ completedAt: ago(1), updatedAt: ago(200) }), now)).toBe(false);
    const c = retentionCutoffs(now);
    expect(c.transcripts).toEqual(ago(90));
    expect(c.candidates).toEqual(ago(30));
    expect(c.abandoned).toEqual(ago(ABANDON_DAYS));
  });

  test("abandoned = running with no report for 7 days (heartbeat, else last update), or queued and untouched as long; a stall under that is not", () => {
    expect(isAbandoned(job({ status: "running", stage: "transcribe", heartbeatAt: ago(8) }), now)).toBe(true);
    expect(isAbandoned(job({ status: "running", stage: "transcribe", heartbeatAt: null, updatedAt: ago(8) }), now)).toBe(true);
    expect(isAbandoned(job({ status: "running", stage: "transcribe", heartbeatAt: ago(6) }), now)).toBe(false);
    // R1328 review: a queued job holds an ACTIVE_JOBS_MAX slot too, so one nobody started for 7 days is abandoned as well.
    expect(isAbandoned(job({ status: "queued", stage: "transcribe", heartbeatAt: null, updatedAt: ago(30) }), now)).toBe(true);
    expect(isAbandoned(job({ status: "queued", stage: "transcribe", heartbeatAt: null, updatedAt: ago(6) }), now)).toBe(false);
    expect(isAbandoned(job({ status: "ready", stage: "review", updatedAt: ago(30) }), now)).toBe(false);
    expect(ABANDONED_ERROR).toContain("7 days");
    expect(RETENTION_BATCH).toBe(500);
    expect(ABANDON_BATCH).toBe(100);
  });

  test("the sweep line reads its own numbers back", () => {
    expect(retentionLine({ abandoned: 1, transcripts: 0, candidates: 2, ms: 12 })).toBe("clipper retention: 1 abandoned job closed, 0 transcripts and 2 candidates pruned in 12 ms");
  });
});

describe("R1326 daily budget (pure)", () => {
  test("defaults and env overrides: rupees become paise, junk keeps the default", () => {
    expect(DEFAULT_CLIPPER_CAP).toEqual({ calls: 30, inrMinor: 4000 });
    expect(capFrom({})).toEqual(DEFAULT_CLIPPER_CAP);
    expect(capFrom({ CLIPPER_DAILY_CALLS: "5", CLIPPER_DAILY_INR: "12.5" })).toEqual({ calls: 5, inrMinor: 1250 });
    expect(capFrom({ CLIPPER_DAILY_CALLS: "lots", CLIPPER_DAILY_INR: "-3" })).toEqual(DEFAULT_CLIPPER_CAP);
    expect(capFrom({ CLIPPER_DAILY_CALLS: "", CLIPPER_DAILY_INR: "0" })).toEqual({ calls: 30, inrMinor: 0 });
    expect(rupees(4000)).toBe("₹40");
    expect(rupees(1250)).toBe("₹12.50");
  });

  test("calls cap is checked first (the ₹0 safety net), then money; every line carries used and cap", () => {
    const cap = { calls: 3, inrMinor: 500 };
    const ok = budgetVerdict({ calls: 1, inrMinor: 120 }, cap);
    expect(ok.allowed).toBe(true);
    expect(ok.line).toBe("1 of 3 AI runs used today (₹1.20 of ₹5).");
    const calls = budgetVerdict({ calls: 3, inrMinor: 0 }, cap);
    expect(calls).toMatchObject({ allowed: false, reason: "calls" });
    expect(calls.line).toContain("3 of 3 runs");
    expect(calls.line).toContain("rule detector ran instead");
    const money = budgetVerdict({ calls: 2, inrMinor: 500 }, cap);
    expect(money).toMatchObject({ allowed: false, reason: "money" });
    expect(money.line).toContain("₹5 of ₹5");
    // Both over: calls wins, so the message does not blame money when prices are missing.
    expect(budgetVerdict({ calls: 9, inrMinor: 9999 }, cap).reason).toBe("calls");
    // Days are UTC: the reset time is named, never a bare "tomorrow" (05:30 IST).
    expect(calls.line).toContain("00:00 UTC (05:30 IST)");
    // R1328 review: a budget that cannot be read fails closed to the rules, with a line that says so.
    const u = unavailableVerdict(cap);
    expect(u).toMatchObject({ allowed: false, reason: "unavailable", cap, spend: { calls: 0, inrMinor: 0 } });
    expect(u.line).toContain("could not be checked");
  });
});

const mk = async () => db.user.create({ data: { email: `r1326-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`, name: "R1326", passwordHash: "x" } });
const seedJob = (ownerId: string, o: { status: string; stage: string; heartbeatAt?: Date | null; updatedAt?: Date; completedAt?: Date | null }) =>
  db.clipJob.create({ data: { ownerId, status: o.status, stage: o.stage, heartbeatAt: o.heartbeatAt ?? null, updatedAt: o.updatedAt ?? ago(1), completedAt: o.completedAt ?? null, settings: "{}", executor: "browser" } });
const seedTranscript = (ownerId: string, jobId: string) => db.clipTranscript.create({ data: { jobId, ownerId, engine: "test", language: "en", words: "[]", cues: "[]", wordCount: 0 } });
const seedCandidate = (ownerId: string, jobId: string, status: string, rank: number) =>
  db.clipCandidate.create({ data: { jobId, ownerId, start: 0, end: 10, kind: "hook", title: "t", reason: "r", scores: "{}", score: 0.5, rank, status, source: "ai" } });

describe("R1326 sweepClipper (db)", () => {
  test("abandons quiet running jobs, prunes transcripts at 90 d and spare candidates at 30 d after close, keeps the desk and approved candidates; a second pass is a no-op", async () => {
    const u = await mk();
    const stale = await seedJob(u.id, { status: "running", stage: "transcribe", heartbeatAt: ago(8) });
    const never = await seedJob(u.id, { status: "queued", stage: "transcribe", updatedAt: ago(9) });
    const justQueued = await seedJob(u.id, { status: "queued", stage: "transcribe", updatedAt: ago(2) });
    const live = await seedJob(u.id, { status: "running", stage: "detect", heartbeatAt: ago(6) });
    const old = await seedJob(u.id, { status: "ready", stage: "done", completedAt: ago(100) });
    const desk = await seedJob(u.id, { status: "ready", stage: "review", updatedAt: ago(200) });
    const failed = await seedJob(u.id, { status: "failed", stage: "detect", updatedAt: ago(40) });
    const oldFailed = await seedJob(u.id, { status: "failed", stage: "detect", updatedAt: ago(400) });
    const fresh = await seedJob(u.id, { status: "cancelled", stage: "transcribe", completedAt: ago(10) });
    for (const j of [stale, live, old, desk, failed, oldFailed, fresh]) await seedTranscript(u.id, j.id);
    for (const j of [old, desk, failed, fresh]) {
      await seedCandidate(u.id, j.id, "suggested", 1);
      await seedCandidate(u.id, j.id, "rejected", 2);
      await seedCandidate(u.id, j.id, "approved", 3);
    }

    const r = await ret.sweepClipper(now);
    expect(r).toMatchObject({ abandoned: 2, transcripts: 1, candidates: 4 });
    expect(r.ms).toBeGreaterThanOrEqual(0);

    // The queued job nobody started for 9 days is closed with the same reason; the one from two days ago waits.
    const q = await db.clipJob.findUniqueOrThrow({ where: { id: never.id } });
    expect(q).toMatchObject({ status: "cancelled", error: ABANDONED_ERROR });
    const qe = await db.clipEvent.findFirstOrThrow({ where: { jobId: never.id, type: "abandoned" } });
    expect(JSON.parse(qe.data ?? "{}")).toMatchObject({ from: { status: "queued", stage: "transcribe" }, afterDays: ABANDON_DAYS });
    expect((await db.clipJob.findUniqueOrThrow({ where: { id: justQueued.id } })).status).toBe("queued");

    const s = await db.clipJob.findUniqueOrThrow({ where: { id: stale.id } });
    expect(s).toMatchObject({ status: "cancelled", stage: "transcribe", error: ABANDONED_ERROR });
    expect(s.completedAt).toEqual(now);
    expect(await db.clipEvent.count({ where: { jobId: stale.id, type: "abandoned" } })).toBe(1);
    expect((await db.clipJob.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("running");

    const transcripts = await db.clipTranscript.findMany({ where: { ownerId: u.id }, select: { jobId: true } });
    // The 400-day-old FAILED job keeps its transcript: a retry runs detect at its stage and needs the words (R1328 review).
    expect(transcripts.map((t) => t.jobId).sort()).toEqual([stale.id, live.id, desk.id, failed.id, oldFailed.id, fresh.id].sort());
    const left = await db.clipCandidate.findMany({ where: { ownerId: u.id }, select: { jobId: true, status: true } });
    expect(left.filter((c) => c.jobId === old.id).map((c) => c.status)).toEqual(["approved"]);
    expect(left.filter((c) => c.jobId === failed.id).map((c) => c.status)).toEqual(["approved"]);
    expect(left.filter((c) => c.jobId === desk.id)).toHaveLength(3);
    expect(left.filter((c) => c.jobId === fresh.id)).toHaveLength(3);

    expect(await ret.sweepClipper(now)).toMatchObject({ abandoned: 0, transcripts: 0, candidates: 0 });
    // The stale job's cancel event was not repeated.
    expect(await db.clipEvent.count({ where: { jobId: stale.id, type: "abandoned" } })).toBe(1);
  });

  test("load line: 300 closed jobs with transcripts and two spare candidates each, one pass under 3 s and bounded by the batch", async () => {
    const u = await mk();
    const ids: string[] = [];
    // Half cancelled (terminal: transcript goes), half failed (transcript stays for a retry; spare candidates still go).
    for (let i = 0; i < 300; i++) ids.push((await seedJob(u.id, { status: i % 2 ? "failed" : "cancelled", stage: "detect", completedAt: ago(120 + i), updatedAt: ago(120 + i) })).id);
    await db.clipTranscript.createMany({ data: ids.map((jobId) => ({ jobId, ownerId: u.id, engine: "test", language: "en", words: "[]", cues: "[]", wordCount: 0 })) });
    await db.clipCandidate.createMany({ data: ids.flatMap((jobId) => [1, 2].map((rank) => ({ jobId, ownerId: u.id, start: 0, end: 10, kind: "hook", title: "t", reason: "r", scores: "{}", score: 0.5, rank, status: rank === 1 ? "suggested" : "rejected", source: "ai" }))) });
    // A batch smaller than the seed exercises the bound (R1328 review: 300 rows never reached RETENTION_BATCH); counts are
    // scoped to this owner because the shared test database may hold other suites' closed jobs.
    const batch = 100;
    const mine = async () => ({ transcripts: await db.clipTranscript.count({ where: { ownerId: u.id } }), candidates: await db.clipCandidate.count({ where: { ownerId: u.id } }) });
    const before = await mine();
    expect(before).toEqual({ transcripts: 300, candidates: 600 });
    const t0 = Date.now();
    const first = await ret.sweepClipper(now, { batch });
    const ms = Date.now() - t0;
    expect(first.transcripts).toBe(batch);
    expect(first.candidates).toBe(batch);
    expect(ms).toBeLessThan(3000);
    const after = await mine();
    expect(before.transcripts - after.transcripts).toBeLessThanOrEqual(batch);
    expect(before.candidates - after.candidates).toBeLessThanOrEqual(batch);
    // Drain with the default batch: the 150 cancelled transcripts go in total, the 150 failed ones stay; all 600 spare candidates go.
    for (let i = 0; i < 8; i++) await ret.sweepClipper(now);
    expect(await mine()).toEqual({ transcripts: 150, candidates: 0 });
    expect(await db.clipTranscript.count({ where: { ownerId: u.id, job: { status: "failed" } } })).toBe(150);
  });
});

describe("R1326 daily budget (db)", () => {
  test("spend = today's AI detection runs (detected events by this actor) and the clipper rupees for this user only; the verdict follows the env cap", async () => {
    const u = await mk();
    const other = await mk();
    const day = now.toISOString().slice(0, 10);
    const row = (userId: string, unit: string, inrMinor: number, feature = "clipper", d = day) => ({ at: now, day: d, provider: "gemini", category: "ai", feature, userId, model: "gemini-3.6-flash", units: 100, unit, amountMinor: inrMinor, currency: "INR", inrMinor, source: "reported" });
    await db.costEvent.createMany({
      data: [
        row(u.id, "token-in", 50), row(u.id, "token-out", 150),
        row(u.id, "token-in", 0), row(u.id, "token-out", 0), // an unpriced call: ₹0, and no longer a "run" by itself
        row(u.id, "token-in", 999, "captions"), // another feature
        row(u.id, "token-in", 999, "clipper", "2026-11-24"), // yesterday
        row(other.id, "token-in", 999), // someone else
      ],
    });
    // Runs come from the job log, not the ledger (R1328 review: one run can book 2-3 hedged model calls, or none on a timeout).
    const j = await seedJob(u.id, { status: "ready", stage: "review" });
    const ev = (actorId: string, detector: string, at: Date) => ({ jobId: j.id, ownerId: u.id, actorId, type: "detected", at, data: JSON.stringify({ detector, candidates: 3 }) });
    await db.clipEvent.createMany({
      data: [
        ev(u.id, "ai", now), ev(u.id, "ai", new Date(`${day}T00:00:01Z`)), // two AI runs today
        ev(u.id, "rules", now), // a rules run is free
        ev(u.id, "ai", new Date("2026-11-24T23:59:59Z")), // yesterday (UTC)
        ev(other.id, "ai", now), // another actor on this owner's job
        { jobId: j.id, ownerId: u.id, actorId: u.id, type: "approved", at: now, data: JSON.stringify({ detector: "ai" }) }, // not a detection
      ],
    });
    expect(await budget.clipperSpend(u.id, now)).toEqual({ calls: 2, inrMinor: 200 });
    expect(await budget.clipperSpend(other.id, now)).toEqual({ calls: 1, inrMinor: 999 });
    const before = { calls: process.env.CLIPPER_DAILY_CALLS, inr: process.env.CLIPPER_DAILY_INR };
    try {
      process.env.CLIPPER_DAILY_CALLS = "2";
      delete process.env.CLIPPER_DAILY_INR;
      expect(await budget.clipperBudget(u.id, now)).toMatchObject({ allowed: false, reason: "calls", spend: { calls: 2, inrMinor: 200 }, cap: { calls: 2, inrMinor: 4000 } });
      process.env.CLIPPER_DAILY_CALLS = "30";
      process.env.CLIPPER_DAILY_INR = "1.5";
      expect(await budget.clipperBudget(u.id, now)).toMatchObject({ allowed: false, reason: "money", cap: { calls: 30, inrMinor: 150 } });
      process.env.CLIPPER_DAILY_INR = "40";
      expect((await budget.clipperBudget(u.id, now)).allowed).toBe(true);
    } finally {
      if (before.calls === undefined) delete process.env.CLIPPER_DAILY_CALLS; else process.env.CLIPPER_DAILY_CALLS = before.calls;
      if (before.inr === undefined) delete process.env.CLIPPER_DAILY_INR; else process.env.CLIPPER_DAILY_INR = before.inr;
    }
  });
});

describe("R1326 wiring", () => {
  test("sweep slot, detect fallback, docs", () => {
    const sweep = read("app/api/cron/sweep/route.ts");
    expect(sweep).toContain("plan.housekeeping ? await import(\"@/lib/clipper/retention\").then((m) => m.sweepClipper(now))");
    expect(sweep).toContain("rollup, personal, running, shared, clipper }");
    const detect = read("app/api/clipper/jobs/[id]/detect/route.ts");
    expect(detect).toContain("budget = await clipperBudget(uid).catch(() => unavailableVerdict(clipperCap()));"); // R1328: a read failure fails closed to the rules
    expect(detect).toContain("if (budget.allowed) {");
    expect(detect).toContain("note: budget && !budget.allowed ? { budget: budget.reason } : null");
    expect(detect).toContain("budget: budget ? { allowed: budget.allowed, reason: budget.reason, line: budget.line, spend: budget.spend, cap: budget.cap } : null");
    for (const f of ["lib/clipper/retention-core.ts", "lib/clipper/budget-core.ts"]) expect(read(f)).not.toContain("@prisma/client\"");
    // The studio tells the creator when the rules ran because of the budget (plan "Later" row closed).
    expect(read("lib/client/clipper.ts")).toContain("o.onDetect?.({ detector: d.detector, budget: d.budget ?? null });");
    const studio = read("components/clipper/ClipperStudio.tsx");
    expect(studio).toContain("o.detector === \"rules\" && o.budget && !o.budget.allowed");
    expect(studio).toContain('<p role="status" className="rounded-2xl bg-secondary/60 px-4 py-3 text-[13px] text-muted-foreground">{detectNote}</p>');
    for (const f of ["lib/clipper/retention.ts", "lib/clipper/budget.ts"]) expect(read(f)).toContain('import "server-only"');
    const readme = read("lib/clipper/README.md");
    for (const s of ["## Hardening (R1326)", "### Retention", "### Daily AI budget", "### Review notes (ownership, RLS)", "### Sweep bounds", "CLIPPER_DAILY_CALLS", "`sweepClipper` | housekeeping", "R1328"]) expect(readme).toContain(s);
    // R1328 review: the retention sweep never deletes by id alone.
    const retention = read("lib/clipper/retention.ts");
    expect(retention).toContain("where: { id: { in: tIds }, job: terminalBefore(cut.transcripts) }");
    expect(retention).toContain("where: { id: { in: cIds }, status: { in: SPARE }, job: closedBefore(cut.candidates) }");
    expect(retention).toContain("db.clipEvent.createMany(");
    // The Monday email's baseline links are absolute (the template writes hrefs as they are).
    expect(read("lib/reports/weekly.ts")).toContain("items: items.map((i) => ({ ...i, href }))");
    // The pulse-style Home renders the Intelligence card once: classicView skips it when drawn as the fallback.
    expect(read("app/(studio)/home/page.tsx")).toContain('user.actor || !firstRun ? null : soft(intelligencePulse(user.id), CARD_MS, null, "home intelligence")');
    // The app's pulse route narrows a scoped teammate like Pip does.
    expect(read("app/api/intelligence/pulse/route.ts")).toContain("targetIds: await targetIdsForAccounts(user.id, user.scope)");
    expect(read("docs/intelligence-clipper-plan.md")).toContain("| 8 Hardening | R1326 DONE |");
  });
});

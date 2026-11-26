/**
 * R1338: upgrade and downgrade, end to end.
 *
 * Pure: the backfill decision (missing or stale profile is due; a fresh one is not) and the lock key (one per owner per
 * 30-minute window). Db: a freshly entitled owner's first read kicks one background refresh (the profile exists once it
 * settles, the kick is logged as IntelligenceJobRun `personal` trigger api), the next read says fresh, a racing read is
 * locked, an owner without posts is not kicked, a free or downgraded owner is not kicked and keeps every row, and a
 * re-upgrade resumes from them. Source pins: the two first-read routes kick and answer `coldStart` / `backfill`, the
 * baselines card shows the spec's cold-start line, the Android API map documents the 402 and the consent API, and the
 * consolidated entitlements doc exists with its sections.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "../lib/db";
import { BACKFILL_LOCK_MINUTES, backfillDue, backfillLockKey } from "../lib/intelligence/backfill-core";
import { kickBackfill } from "../lib/intelligence/backfill";
import { requireIntelligence } from "../lib/intelligence/entitlements";
import { COLD_START_COPY } from "../lib/intelligence/entitlements-core";
import { PROFILE_STALE_MS } from "../lib/intelligence/profile";
import { downgrade, withIntelligence } from "./helpers/intelligence-plan";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const DAY = 864e5;
let n = 0;
const plain = () => db.user.create({ data: { name: `U ${++n}`, email: `r1338-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x" } });

async function seed(ownerId: string, posts: number, platform = "instagram") {
  const account = await db.socialAccount.create({ data: { userId: ownerId, platform, platformUserId: `${platform}-r1338-${Date.now()}-${Math.random()}`, username: "@u", accessToken: "x", status: "connected" } });
  const media = await db.media.create({ data: { userId: ownerId, originalFilename: "v.mp4", storageKey: `r1338/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready", duration: 40, width: 1080, height: 1920 } });
  for (let i = 0; i < posts; i++) {
    const at = new Date(Date.now() - (3 + i * 4) * DAY);
    const p = await db.post.create({ data: { userId: ownerId, mediaId: media.id, status: "published", publishedAt: at } });
    const t = await db.postTarget.create({ data: { postId: p.id, platform, socialAccountId: account.id, platformStatus: "published", publishedAt: at, caption: "A caption", practice: false } });
    await db.targetMetric.create({ data: { targetId: t.id, capturedAt: at, views: 100 + i * 30, likes: 2 } });
  }
}

const rows = async (ownerId: string) => ({
  profiles: await db.creatorProfile.count({ where: { ownerId } }),
  features: await db.contentFeature.count({ where: { ownerId } }),
  predictions: await db.predictionRecord.count({ where: { ownerId } }),
});

describe("R1338 backfill rules, pure", () => {
  test("due without a profile or with a stale one; not due when fresh", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    expect(backfillDue(null, now, PROFILE_STALE_MS)).toBe(true);
    expect(backfillDue(new Date(now - PROFILE_STALE_MS - 1), now, PROFILE_STALE_MS)).toBe(true);
    expect(backfillDue(new Date(now - PROFILE_STALE_MS + 60_000), now, PROFILE_STALE_MS)).toBe(false);
    expect(backfillDue(new Date(now).toISOString(), now, PROFILE_STALE_MS)).toBe(false);
  });

  test("the lock key turns once per window", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    expect(BACKFILL_LOCK_MINUTES).toBe(30);
    expect(backfillLockKey(now)).toBe(backfillLockKey(now + 29 * 60_000));
    expect(backfillLockKey(now)).not.toBe(backfillLockKey(now + BACKFILL_LOCK_MINUTES * 60_000));
    expect(backfillLockKey(new Date(now))).toMatch(/^backfill:\d+$/);
  });
});

describe("R1338 upgrade then downgrade, db", () => {
  test("the first entitled read builds the profile once; a downgrade stops it and keeps the rows; a re-upgrade resumes", async () => {
    const owner = await withIntelligence(await plain());
    await seed(owner.id, 6);
    expect(await rows(owner.id)).toEqual({ profiles: 0, features: 0, predictions: 0 });
    const jobsBefore = await db.intelligenceJobRun.count({ where: { job: "personal", trigger: "api" } });

    // First read: kicked and (waited for here) built. The lock row is on the owner's learning log.
    const first = await kickBackfill(owner.id, { wait: true });
    expect(first).toEqual({ verdict: "kicked", coldStart: true });
    const built = await rows(owner.id);
    expect(built.profiles).toBeGreaterThan(0);
    expect(built.features).toBeGreaterThan(0);
    expect(await db.learningEvent.count({ where: { ownerId: owner.id, type: "backfill_kicked" } })).toBe(1);
    expect(await db.intelligenceJobRun.count({ where: { job: "personal", trigger: "api" } })).toBe(jobsBefore + 1);
    const run = await db.intelligenceJobRun.findFirst({ where: { job: "personal", trigger: "api" }, orderBy: { finishedAt: "desc" } });
    expect(run?.ok).toBe(true);
    expect(JSON.parse(run!.result!)).toMatchObject({ owners: 1, backfill: true });
    expect(run!.result).not.toContain(owner.id);

    // Second read: fresh, nothing kicked, no new lock row.
    expect(await kickBackfill(owner.id, { wait: true })).toEqual({ verdict: "fresh", coldStart: false });
    expect(await db.learningEvent.count({ where: { ownerId: owner.id, type: "backfill_kicked" } })).toBe(1);

    // Stale profile inside the same lock window: locked (the window's kick was spent), no second run.
    await db.creatorProfile.updateMany({ where: { ownerId: owner.id }, data: { computedAt: new Date(Date.now() - PROFILE_STALE_MS - DAY) } });
    expect((await kickBackfill(owner.id, { wait: true })).verdict).toBe("locked");
    expect(await db.intelligenceJobRun.count({ where: { job: "personal", trigger: "api" } })).toBe(jobsBefore + 1);
    // The next window: kicked again and rebuilt.
    const next = Date.now() + BACKFILL_LOCK_MINUTES * 60_000;
    expect((await kickBackfill(owner.id, { now: next, wait: true })).verdict).toBe("kicked");
    expect(await db.intelligenceJobRun.count({ where: { job: "personal", trigger: "api" } })).toBe(jobsBefore + 2);

    // Downgrade: the gate closes at once, the read does not kick, nothing is deleted.
    const kept = await rows(owner.id);
    await downgrade(owner.id);
    await expect(requireIntelligence(owner.id, "personal_intelligence_enabled")).rejects.toMatchObject({ status: 402 });
    await db.creatorProfile.updateMany({ where: { ownerId: owner.id }, data: { computedAt: new Date(Date.now() - PROFILE_STALE_MS - DAY) } });
    expect((await kickBackfill(owner.id, { now: next + BACKFILL_LOCK_MINUTES * 60_000, wait: true })).verdict).toBe("not-entitled");
    expect(await rows(owner.id)).toEqual(kept);

    // Re-upgrade: entitled again, and the stale profile is rebuilt on the next read.
    await withIntelligence(owner);
    const again = await kickBackfill(owner.id, { now: next + 2 * BACKFILL_LOCK_MINUTES * 60_000, wait: true });
    expect(again.verdict).toBe("kicked");
    expect(again.coldStart).toBe(false);
    const latest = await db.creatorProfile.findFirst({ where: { ownerId: owner.id, scopeKey: "", platform: "" }, select: { computedAt: true } });
    expect(latest!.computedAt.getTime()).toBeGreaterThan(Date.now() - PROFILE_STALE_MS);
  });

  test("an entitled owner without a published post is not kicked; a free owner never is", async () => {
    const empty = await withIntelligence(await plain());
    expect(await kickBackfill(empty.id, { wait: true })).toEqual({ verdict: "no-posts", coldStart: true });
    expect(await db.learningEvent.count({ where: { ownerId: empty.id, type: "backfill_kicked" } })).toBe(0);
    const free = await plain();
    await seed(free.id, 3);
    expect(await kickBackfill(free.id, { wait: true })).toEqual({ verdict: "not-entitled", coldStart: true });
    expect(await rows(free.id)).toEqual({ profiles: 0, features: 0, predictions: 0 });
  });

  test("two racing reads: one kick, one locked", async () => {
    const owner = await withIntelligence(await plain());
    await seed(owner.id, 4);
    const both = await Promise.all([kickBackfill(owner.id, { wait: true }), kickBackfill(owner.id, { wait: true })]);
    expect(both.map((b) => b.verdict).sort()).toEqual(["kicked", "locked"]);
    expect(await db.learningEvent.count({ where: { ownerId: owner.id, type: "backfill_kicked" } })).toBe(1);
  });
});

describe("R1338 source pins", () => {
  test("the first-read routes kick the backfill on the workspace scope and answer coldStart / backfill", () => {
    const status = read("app/api/intelligence/status/route.ts");
    expect(status).toContain('import { kickBackfill } from "@/lib/intelligence/backfill"');
    expect(status).toContain("client ? null : kickBackfill(user.id).catch(() => null)");
    expect(status).toContain("coldStart:");
    expect(status).toContain("backfill: kick?.verdict ?? null");
    const pred = read("app/api/intelligence/predictions/route.ts");
    expect(pred).toContain("scopeKey ? null : kickBackfill(user.id).catch(() => null)");
    expect(pred).toContain("coldStart: kick ? kick.coldStart : null, backfill: kick?.verdict ?? null");
    expect(pred.indexOf("await requireIntelligence(user.id")).toBeLessThan(pred.indexOf("kickBackfill(user.id)")); // the plan check comes first
  });

  test("the baselines card shows the spec's cold-start line, verbatim, from one constant", () => {
    const card = read("components/intelligence/PersonalBaselines.tsx");
    expect(card).toContain('import { COLD_START_COPY } from "@/lib/intelligence/entitlements-core"');
    // R1339: the card picks one notice (baselinesNotice), so the cold-start line renders under that guard.
    expect(card).toContain('{notice === "cold-start" && data && (');
    expect(card).toContain("{COLD_START_COPY}");
    expect(COLD_START_COPY).toBe("Your Intelligence Engine is getting to know your content. As more performance data becomes available, your insights will become more personalized.");
  });

  test("the Android API map and the consolidated entitlements doc are in place", () => {
    const map = readFileSync(new URL("../../../outlly-compose/docs/api-map-rest.md", import.meta.url), "utf8");
    expect(map).toContain("### A8 Personal Intelligence");
    expect(map).toContain('"code": "PLAN_LIMIT", "feature": "intelligence"');
    expect(map).toContain('"upgrade": "/billing"');
    expect(map).toContain("coldStart");
    expect(map).toContain("/api/intelligence/sharing");
    expect(map).toContain("request-deletion");
    const doc = read("docs/intelligence-entitlements.md");
    for (const h of ["## 1. Entitlement rules", "## 2. Consent", "## 3. Data and migrations", "## 4. API changes", "## 5. Jobs, retention and the admin page", "## 6. Upgrade and downgrade", "## 7. Deployment and rollback"]) expect(doc).toContain(h);
    expect(doc).not.toMatch(/INR|₹/);
  });
});

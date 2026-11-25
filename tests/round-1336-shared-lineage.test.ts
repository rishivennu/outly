/**
 * R1336: shared builds and lineage.
 *
 * Pure: validation (a leaked id or a thin bucket fails the document), evaluation against the build before (anomaly
 * rules), the build line. Db: every rebuild writes a SharedDatasetBuild (seq +1, counts, rejections, validation,
 * evaluation, served) and keeps one pseudonymous SharedContribution per contributor current (no user id stored, HMAC
 * key); a contributor who withdraws goes inactive at the next build; a deletion request clears their references in the
 * sweep; a failed validation serves an empty document and raises an AdminEvent; builds past retention are pruned; the
 * admin summary and the creator's own view are counts only. Source pins: schema (both files), the sweep order, no
 * userId column on the lineage table.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "../lib/db";
import { grantConsent, requestDeletion, withdrawConsent } from "../lib/intelligence/consent";
import { buildShared, parseShared, type SharedBaselines, type SharedRow } from "../lib/intelligence/shared-core";
import { SHARED_ANOMALY_DROP, SHARED_BUILD_RETENTION_DAYS, SHARED_CONTRIBUTION_REFS_MAX, buildLine, compareShared, datasetVersion, validateShared } from "../lib/intelligence/shared-lineage-core";
import { buildsSummary, contributorKey, myContribution, pruneBuilds, purgeContributions } from "../lib/intelligence/shared-lineage";
import { rebuildShared, sweepShared, SHARED_MODEL_KEY } from "../lib/intelligence/shared";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const DAY = 864e5;
let n = 0;
const user = () => db.user.create({ data: { name: `L ${++n}`, email: `r1336-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x" } });

async function featureRows(ownerId: string, count: number, vpf: number, opts: { unmeasured?: number } = {}) {
  const media = await db.media.create({ data: { userId: ownerId, originalFilename: "v.mp4", storageKey: `r1336/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready", duration: 30, width: 1080, height: 1920 } });
  const ids: string[] = [];
  for (let k = 0; k < count + (opts.unmeasured ?? 0); k++) {
    const at = new Date(Date.now() - (10 + k * 5) * DAY);
    const measured = k < count;
    const post = await db.post.create({ data: { userId: ownerId, mediaId: media.id, status: "published", publishedAt: at } });
    const t = await db.postTarget.create({ data: { postId: post.id, platform: "instagram", platformStatus: "published", publishedAt: at } });
    const row = await db.contentFeature.create({
      data: {
        ownerId, targetId: t.id, postId: post.id, platform: "instagram", format: "video", publishedAt: at, version: 1, measured: true,
        features: JSON.stringify({ version: 1, platform: "instagram", format: "video", categories: ["r1336"], topic: "money" }),
        perf: measured ? JSON.stringify({ version: 1, ageDays: 10 + k * 5, measured: true, totals: { views: Math.round(vpf * 1000), likes: 1 }, engagementRate: 1.5, viewsPerFollower: vpf }) : JSON.stringify({ version: 1, ageDays: 1, measured: false, totals: {} }),
      },
    });
    if (measured) ids.push(row.id);
  }
  return ids;
}

const sharedRows = (owners: number, perOwner: number, vpf = 0.5): SharedRow[] => {
  const out: SharedRow[] = [];
  for (let o = 0; o < owners; o++) for (let k = 0; k < perOwner; k++) out.push({ owner: `o${o}`, platform: "instagram", format: "video", publishedAt: new Date(Date.now() - (10 + k) * DAY), categories: ["c"], views: 1000, viewsPerFollower: vpf * (1 + o * 0.01), engagementRate: 1 });
  return out;
};

describe("R1336 builds and lineage, pure", () => {
  test("validation fails a leaked id or a thin bucket and passes a clean document", () => {
    const doc = buildShared(sharedRows(6, 5));
    expect(doc.buckets.length).toBeGreaterThan(0);
    expect(validateShared(doc, ["o0", "o1"])).toEqual({ ok: true, notes: [] }); // owner names never survive into the document
    expect(validateShared(doc, ["instagram", "video"])).toEqual({ ok: false, notes: ["2 contributor ids found in the document"] }); // an id that does appear fails it
    expect(validateShared(doc, ["nobody-like-this"])).toEqual({ ok: true, notes: [] });
    const thin: SharedBaselines = { ...doc, buckets: [{ ...doc.buckets[0], owners: 2 }] };
    expect(validateShared(thin, []).notes).toEqual(["1 bucket below the publishing floors"]);
    const badStat: SharedBaselines = { ...doc, buckets: [{ ...doc.buckets[0], views: { n: 3, owners: 2, median: 1, p25: 1, p75: 1 } }] };
    expect(validateShared(badStat, []).notes).toEqual(["1 statistic below the publishing floors"]);
    expect(validateShared({ ...doc, builtAt: "never" }, []).notes).toEqual(["builtAt is not a date"]);
  });

  test("evaluation compares with the build before and flags a halving or a big median move", () => {
    const prev = buildShared(sharedRows(12, 6, 0.5));
    const same = buildShared(sharedRows(12, 6, 0.5));
    const first = compareShared(null, same);
    expect(first).toMatchObject({ previous: null, common: 0, maxMedianShiftPct: null, anomaly: null });
    const steady = compareShared(prev, same, 4);
    expect(steady.previous).toEqual({ seq: 4, buckets: prev.buckets.length, rows: prev.rows, owners: prev.owners });
    expect(steady.common).toBe(prev.buckets.length);
    expect(steady.maxMedianShiftPct).toBe(0);
    expect(steady.anomaly).toBeNull();
    const halved = compareShared(prev, buildShared(sharedRows(12, 2, 0.5)), 4); // rows fall to a third
    expect(halved.rows).toBeLessThan(prev.rows * SHARED_ANOMALY_DROP);
    expect(halved.anomaly).toContain("fewer than half the rows");
    const moved = compareShared(prev, buildShared(sharedRows(12, 6, 1.2)), 4); // medians up 140%
    expect(moved.maxMedianShiftPct).toBeGreaterThan(100);
    expect(moved.anomaly).toContain("median moved");
    const empty = compareShared(prev, buildShared([]), 4);
    expect(empty.anomaly).toContain("fewer than half the buckets");
    expect(datasetVersion(7)).toBe("sd-7");
    expect(buildLine({ seq: 7, contributors: 3, rowsKept: 40, buckets: 2, validation: "passed", served: true, anomaly: null })).toBe("sd-7: 2 buckets from 3 creators' 40 posts; served");
    expect(buildLine({ seq: 8, contributors: 3, rowsKept: 40, buckets: 2, validation: "failed", served: false, anomaly: "x" })).toContain("validation failed, not served");
    expect(SHARED_BUILD_RETENTION_DAYS).toBe(90);
    expect(SHARED_CONTRIBUTION_REFS_MAX).toBeGreaterThanOrEqual(30);
  });
});

describe("R1336 builds and lineage, db", () => {
  test("a rebuild records a versioned build with rejections and keeps one pseudonymous row per contributor; withdrawal goes inactive next build", async () => {
    const a = await user();
    const b = await user();
    await grantConsent(a.id, { source: "settings" });
    await grantConsent(b.id, { source: "settings" });
    const aRefs = await featureRows(a.id, 4, 0.5, { unmeasured: 2 });
    await featureRows(b.id, 3, 0.6);

    const r1 = await rebuildShared({ trigger: "admin" });
    expect(r1.build.seq).toBeGreaterThan(0);
    expect(r1.build.datasetVersion).toBe(datasetVersion(r1.build.seq));
    expect(r1.build).toMatchObject({ served: true, validation: "passed" });
    expect(r1.build.rejected.unmeasured).toBeGreaterThanOrEqual(2);
    expect(r1.build.lineage.active).toBeGreaterThanOrEqual(2);
    const row = await db.sharedDatasetBuild.findUnique({ where: { seq: r1.build.seq } });
    expect(row).toMatchObject({ trigger: "admin", validation: "passed", served: true, sharedVersion: 1 });
    expect(row!.contributors).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(row!.sourceCategories)).toEqual(["content_metadata", "performance_signals", "production_signals"]);
    expect(JSON.parse(row!.rejected)).toMatchObject({ truncated: false });
    expect(JSON.parse(row!.evaluation!)).toHaveProperty("buckets");

    const key = contributorKey(a.id);
    expect(key).not.toContain(a.id);
    expect(key.length).toBe(32);
    expect(contributorKey(a.id)).toBe(key); // stable
    expect(contributorKey(b.id)).not.toBe(key);
    const c = await db.sharedContribution.findUnique({ where: { contributorKey: key } });
    expect(c).toMatchObject({ status: "active", records: 4, builds: 1, firstBuildId: row!.id, lastBuildId: row!.id, deletionStatus: null });
    expect(JSON.parse(c!.recordRefs).sort()).toEqual(aRefs.sort());
    expect(JSON.stringify(c)).not.toContain(a.id);
    const consent = await db.aiDataConsent.findFirst({ where: { userId: a.id, status: "granted" }, orderBy: { createdAt: "desc" } });
    expect(c!.consentId).toBe(consent!.id);

    // Second build: seq +1, lineage counts the build; b withdraws and goes inactive.
    await withdrawConsent(b.id, { source: "settings" });
    const r2 = await rebuildShared();
    expect(r2.build.seq).toBe(r1.build.seq + 1);
    const c2 = await db.sharedContribution.findUnique({ where: { contributorKey: key } });
    expect(c2).toMatchObject({ builds: 2, firstBuildId: row!.id, status: "active" });
    expect(c2!.lastBuildId).not.toBe(row!.id);
    const cb = await db.sharedContribution.findUnique({ where: { contributorKey: contributorKey(b.id) } });
    expect(cb).toMatchObject({ status: "inactive", builds: 1, deletionStatus: null });
    expect(cb!.inactiveAt).not.toBeNull();
    expect(await myContribution(a.id)).toMatchObject({ status: "active", records: 4, builds: 2, deleted: false });
    expect(await myContribution((await user()).id)).toBeNull();
  });

  test("a deletion request: the sweep rebuilds, clears the lineage references, closes the request; a build past retention is pruned", async () => {
    const u = await user();
    await grantConsent(u.id, { source: "intelligence" });
    await featureRows(u.id, 3, 0.4);
    await rebuildShared();
    const before = await db.sharedContribution.findUnique({ where: { contributorKey: contributorKey(u.id) } });
    expect(before!.records).toBe(3);

    await requestDeletion(u.id, { source: "settings" });
    const swept = await sweepShared(new Date());
    expect(swept).not.toBeNull();
    expect(swept!.deletions).toBeGreaterThanOrEqual(1);
    expect(swept!.purged).toBeGreaterThanOrEqual(1);
    expect(swept!.build).toMatch(/^sd-\d+$/);
    const after = await db.sharedContribution.findUnique({ where: { contributorKey: contributorKey(u.id) } });
    expect(after).toMatchObject({ records: 0, recordRefs: "[]", status: "inactive", deletionStatus: "deleted" });
    expect(after!.deletedAt).not.toBeNull();
    expect(await myContribution(u.id)).toMatchObject({ deleted: true, records: 0 });
    const deletionBuild = await db.sharedDatasetBuild.findFirst({ orderBy: { seq: "desc" } });
    expect(deletionBuild!.trigger).toBe("deletion");
    expect(await purgeContributions([])).toBe(0);

    const old = await db.sharedDatasetBuild.create({ data: { seq: 10_000_000 + Math.floor(Math.random() * 1e6), datasetVersion: `sd-old-${Date.now()}-${Math.random()}`, featureVersion: 1, sharedVersion: 1, policyVersion: "x", sourceCategories: "[]", trigger: "sweep", contributors: 0, rowsRead: 0, rowsKept: 0, rejected: "{}", buckets: 0, validation: "passed", served: false, durationMs: 1, builtAt: new Date(Date.now() - (SHARED_BUILD_RETENTION_DAYS + 1) * DAY) } });
    expect(await pruneBuilds()).toBeGreaterThanOrEqual(1);
    expect(await db.sharedDatasetBuild.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await pruneBuilds()).toBe(0);
  });

  test("a document that fails validation is never served: an empty one replaces it and the admins hear about it", async () => {
    // Force a leak: a consented creator whose owner id is the string the document legitimately carries as a category.
    const u = await user();
    await grantConsent(u.id, { source: "settings" });
    const media = await db.media.create({ data: { userId: u.id, originalFilename: "v.mp4", storageKey: `r1336x/${Date.now()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready", duration: 30, width: 1080, height: 1920 } });
    // Five more consented creators so the category bucket publishes with the leaking category inside.
    const owners = [u];
    for (let i = 0; i < 5; i++) {
      const o = await user();
      await grantConsent(o.id, { source: "settings" });
      owners.push(o);
    }
    for (const o of owners) {
      for (let k = 0; k < 5; k++) {
        const at = new Date(Date.now() - (10 + k * 3) * DAY);
        const post = await db.post.create({ data: { userId: o.id, mediaId: media.id, status: "published", publishedAt: at } });
        const t = await db.postTarget.create({ data: { postId: post.id, platform: "threads", platformStatus: "published", publishedAt: at } });
        await db.contentFeature.create({ data: { ownerId: o.id, targetId: t.id, postId: post.id, platform: "threads", format: "text", publishedAt: at, version: 1, measured: true, features: JSON.stringify({ version: 1, platform: "threads", format: "text", categories: [u.id] }), perf: JSON.stringify({ version: 1, ageDays: 10 + k * 3, measured: true, totals: { views: 100 }, engagementRate: 1, viewsPerFollower: 0.1 }) } });
      }
    }
    const events = await db.adminEvent.count({ where: { kind: "intelligence_build" } });
    const r = await rebuildShared();
    expect(r.build.validation).toBe("failed");
    expect(r.build.served).toBe(false);
    expect(r.build.anomaly).toContain("contributor id");
    expect(r.baselines.buckets).toEqual([]);
    const stored = await db.modelVersion.findUnique({ where: { key: SHARED_MODEL_KEY } });
    expect(parseShared(stored!.data)!.buckets).toEqual([]);
    expect(stored!.data).not.toContain(u.id);
    expect(stored!.notes).toContain("failed validation");
    expect(await db.adminEvent.count({ where: { kind: "intelligence_build" } })).toBe(events + 1);
    const ev = await db.adminEvent.findFirst({ where: { kind: "intelligence_build" }, orderBy: { createdAt: "desc" } });
    expect(ev!.title).toContain("failed validation");
    expect(ev!.href).toBe("/admin/intelligence");
    // Lineage is not written for a build that was not served.
    expect(r.build.lineage.active).toBe(0);
    const row = await db.sharedDatasetBuild.findUnique({ where: { seq: r.build.seq } });
    expect(row!.served).toBe(false);
    expect(JSON.parse(row!.validationNotes!)).toHaveLength(1);
    // Clean up the poisoned rows so later tests (and the next build) are not affected.
    await db.contentFeature.deleteMany({ where: { ownerId: { in: owners.map((o) => o.id) } } });
    for (const o of owners) await withdrawConsent(o.id, { source: "settings" });
    await rebuildShared();
  });

  test("the admin summary is counts only", async () => {
    const s = await buildsSummary();
    expect(s.total).toBeGreaterThanOrEqual(1);
    expect(s.latest).not.toBeNull();
    expect(s.recent.length).toBeGreaterThanOrEqual(1);
    expect(s.recent[0].seq).toBe(s.latest!.seq);
    expect(s.retentionDays).toBe(90);
    expect(s.failed30d).toBeGreaterThanOrEqual(1);
    expect(Object.keys(s.lineage).sort()).toEqual(["active", "deleted", "inactive", "recordsActive"]);
    expect(JSON.stringify(s)).not.toContain("@test.dev");
  });
});

describe("R1336 source pins", () => {
  test("schema in both files, no user id on the lineage table, the sweep purges after the rebuild and before closing requests", () => {
    for (const f of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) {
      const s = read(f);
      expect(s).toContain("model SharedDatasetBuild {");
      expect(s).toContain("model SharedContribution {");
      const lineage = s.slice(s.indexOf("model SharedContribution {"), s.indexOf("}", s.indexOf("model SharedContribution {")));
      expect(lineage).not.toMatch(/userId|ownerId|email/);
      expect(lineage).toContain("contributorKey    String    @unique");
    }
    const shared = read("lib/intelligence/shared.ts");
    const sweep = shared.slice(shared.indexOf("export async function sweepShared"));
    expect(sweep.indexOf("rebuildShared(")).toBeLessThan(sweep.indexOf("purgeContributions("));
    expect(sweep.indexOf("purgeContributions(")).toBeLessThan(sweep.indexOf("closeDeletions("));
    expect(shared).toContain("validateShared(built, contributors)");
    expect(shared).toContain("validation.ok ? built : buildShared([], now)");
    const lin = read("lib/intelligence/shared-lineage.ts");
    expect(lin).toContain('import "server-only"');
    expect(lin).toContain("hmac(`shared-contributor:${ownerId}`)");
    expect(read("lib/intelligence/shared-lineage-core.ts")).not.toMatch(/prisma|server-only/);
    expect(read("app/admin/(panel)/intelligence/page.tsx")).toContain("Builds and lineage");
    expect(read("app/api/admin/intelligence/route.ts")).toContain('rebuildShared({ trigger: "admin" })');
    expect(read("lib/intelligence/shared-core.ts")).not.toContain("Opting out (User.shareLearning");
  });
});

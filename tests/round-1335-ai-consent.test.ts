/**
 * R1335: "Help improve Outlly AI", the consent record behind shared learning.
 *
 * Pure: the state fold (newest row wins, policy version, deletion), the copy the user reads (the spec's exact
 * sentence), categories. Db: grant/withdraw/deletion are append-only and idempotent and keep the User.shareLearning
 * mirror in step; the shared rebuild reads consented creators only (a stale mirror with no decision behind it is
 * ignored and counted); a deletion request makes the next sweep tick rebuild at once and is marked done; refreshScope
 * follows the consent record, not the column; the admin summary is counts only. Source pins: schema (both files),
 * db-sync data step, SharingRow never preselected, Settings mounts the card, the route reads no entitlements.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "../lib/db";
import {
  CATEGORY_LABEL,
  CONSENT_CATEGORIES,
  CONSENT_EXPLANATION,
  CONSENT_POLICY_VERSION,
  CONSENT_TITLE,
  NEVER_INCLUDED,
  consentState,
  consentStatusLine,
  consentView,
  parseCategories,
  type ConsentRow,
} from "../lib/intelligence/consent-core";
import { closeDeletions, consentHistory, consentSummary, consentedOwnerIds, currentConsent, grantConsent, hasSharedConsent, pendingDeletions, requestDeletion, withdrawConsent } from "../lib/intelligence/consent";
import { contributesShared } from "../lib/intelligence/entitlements";
import { refreshScope } from "../lib/intelligence/profile";
import { rebuildShared, sweepShared, SHARED_MODEL_KEY } from "../lib/intelligence/shared";
import { parseShared } from "../lib/intelligence/shared-core";
import { withoutIntelligence } from "./helpers/intelligence-plan";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const DAY = 864e5;
let n = 0;
const user = (extra: Record<string, unknown> = {}) => db.user.create({ data: { name: `K ${++n}`, email: `r1335-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x", ...extra } });

const row = (o: Partial<ConsentRow> & { createdAt: string }): ConsentRow => ({
  id: `r${Math.random()}`,
  status: "granted",
  policyVersion: CONSENT_POLICY_VERSION,
  categories: JSON.stringify(CONSENT_CATEGORIES),
  source: "settings",
  consentedAt: o.createdAt,
  withdrawnAt: null,
  deletionRequestedAt: null,
  deletionStatus: null,
  deletionDoneAt: null,
  ...o,
});

/** Measured rows for one owner, the way the feature store writes them (same shape as round 1324). */
async function featureRows(ownerId: string, count: number, vpf: number) {
  const media = await db.media.create({ data: { userId: ownerId, originalFilename: "v.mp4", storageKey: `r1335/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready", duration: 30, width: 1080, height: 1920 } });
  for (let k = 0; k < count; k++) {
    const at = new Date(Date.now() - (10 + k * 5) * DAY);
    const post = await db.post.create({ data: { userId: ownerId, mediaId: media.id, status: "published", publishedAt: at } });
    const t = await db.postTarget.create({ data: { postId: post.id, platform: "instagram", platformStatus: "published", publishedAt: at } });
    await db.contentFeature.create({
      data: {
        ownerId, targetId: t.id, postId: post.id, platform: "instagram", format: "video", publishedAt: at, version: 1, measured: true,
        features: JSON.stringify({ version: 1, platform: "instagram", format: "video", categories: ["r1335"], topic: "money" }),
        perf: JSON.stringify({ version: 1, ageDays: 10 + k * 5, measured: true, totals: { views: Math.round(vpf * 1000), likes: 1 }, engagementRate: 1.5, viewsPerFollower: vpf }),
      },
    });
  }
}

describe("R1335 consent, pure", () => {
  test("no row is no consent; the newest row wins; an older policy version asks again; a deletion shows from any row", () => {
    const none = consentState([]);
    expect(none).toMatchObject({ granted: false, current: false, decisions: 0, categories: [], deletion: null });
    expect(consentStatusLine(none)).toBe("Off by default. Nothing is shared until you turn this on.");

    const g = consentState([row({ createdAt: "2026-11-20T10:00:00.000Z" })]);
    expect(g).toMatchObject({ granted: true, current: true, policyVersion: CONSENT_POLICY_VERSION, categories: [...CONSENT_CATEGORIES], consentedAt: "2026-11-20T10:00:00.000Z", withdrawnAt: null, decisions: 1 });
    expect(consentStatusLine(g)).toContain("On since 20 Nov 2026");

    const old = consentState([row({ createdAt: "2026-11-20T10:00:00.000Z", policyVersion: "2026-01-01.1" })]);
    expect(old.granted).toBe(true);
    expect(old.current).toBe(false);
    expect(consentStatusLine(old)).toContain("changed since you said yes");

    // Rows arrive in any order; the withdrawal is newer so it wins and the categories go empty.
    const w = consentState([row({ createdAt: "2026-11-21T10:00:00.000Z", status: "withdrawn", categories: "[]", withdrawnAt: "2026-11-21T10:00:00.000Z" }), row({ createdAt: "2026-11-20T10:00:00.000Z" })]);
    expect(w).toMatchObject({ granted: false, categories: [], withdrawnAt: "2026-11-21T10:00:00.000Z", decisions: 2 });
    expect(consentStatusLine(w)).toBe("Off. Your posts stay home.");

    const d = consentState([row({ createdAt: "2026-11-21T10:00:00.000Z", status: "withdrawn", deletionRequestedAt: "2026-11-21T10:00:00.000Z", deletionStatus: "requested" })]);
    expect(d.deletion).toEqual({ requestedAt: "2026-11-21T10:00:00.000Z", status: "requested", doneAt: null });
    expect(consentStatusLine(d)).toContain("Deletion requested");
    expect(parseCategories('["content_metadata","bogus"]')).toEqual(["content_metadata"]);
    expect(parseCategories("not json")).toEqual([]);
  });

  test("the copy is the spec's: title, explanation, three categories, the never-included list, no currency anywhere", () => {
    const v = consentView(consentState([]));
    expect(v.copy.title).toBe("Help improve Outlly AI");
    expect(v.copy.explanation).toBe("Allow Outlly to use eligible, de-identified product and content-performance signals to improve our shared AI models. This does not enable Personal Intelligence features on your account.");
    expect(v.categories.map((c) => c.key)).toEqual(["content_metadata", "performance_signals", "production_signals"]);
    for (const c of v.categories) expect(c.label).toBe(CATEGORY_LABEL[c.key].label);
    expect(v.never).toEqual(NEVER_INCLUDED);
    expect(v.never.some((x) => /video/i.test(x))).toBe(true);
    expect(v.never.some((x) => /token|credential/i.test(x))).toBe(true);
    expect(v.policyVersion).toBe(CONSENT_POLICY_VERSION);
    const all = [CONSENT_TITLE, CONSENT_EXPLANATION, v.copy.withdraw, v.copy.deletion, ...NEVER_INCLUDED, ...Object.values(CATEGORY_LABEL).flatMap((c) => [c.label, c.detail])].join(" ");
    expect(all).not.toMatch(/INR|Rs\.|₹|\$/);
    // The deletion copy does not promise the impossible.
    expect(v.copy.deletion).toContain("group medians");
  });
});

describe("R1335 consent, db", () => {
  test("grant and withdraw are append-only, idempotent, and keep the mirror column in step; the history is the audit", async () => {
    const u = await user();
    expect((await db.user.findUnique({ where: { id: u.id }, select: { shareLearning: true } }))!.shareLearning).toBe(false); // default false, never preselected
    expect(await hasSharedConsent(u.id)).toBe(false);
    expect(await contributesShared(u.id)).toBe(false);

    const s1 = await grantConsent(u.id, { source: "settings" });
    expect(s1).toMatchObject({ granted: true, current: true, policyVersion: CONSENT_POLICY_VERSION, categories: [...CONSENT_CATEGORIES], decisions: 1 });
    expect((await db.user.findUnique({ where: { id: u.id }, select: { shareLearning: true } }))!.shareLearning).toBe(true);
    expect(await hasSharedConsent(u.id)).toBe(true);
    expect(await contributesShared(u.id)).toBe(true);
    expect((await grantConsent(u.id, { source: "intelligence" })).decisions).toBe(1); // same answer again: no new row

    const s2 = await withdrawConsent(u.id, { source: "settings" });
    expect(s2).toMatchObject({ granted: false, decisions: 2 });
    expect(s2.withdrawnAt).not.toBeNull();
    expect((await db.user.findUnique({ where: { id: u.id }, select: { shareLearning: true } }))!.shareLearning).toBe(false);
    expect((await withdrawConsent(u.id, { source: "settings" })).decisions).toBe(2);

    const h = await consentHistory(u.id);
    expect(h.map((r) => r.status)).toEqual(["withdrawn", "granted"]);
    expect(h[1].source).toBe("settings");
    expect(JSON.parse(h[1].categories)).toEqual([...CONSENT_CATEGORIES]);
    const ev = await db.learningEvent.findMany({ where: { ownerId: u.id, type: { in: ["consent_granted", "consent_withdrawn"] } }, orderBy: { at: "asc" }, select: { type: true } });
    expect(ev.map((e) => e.type)).toEqual(["consent_granted", "consent_withdrawn"]);
  });

  test("the shared rebuild reads consented creators only; a mirror without a decision behind it is ignored and counted", async () => {
    const yes = await user();
    await grantConsent(yes.id, { source: "settings" });
    const stale = await user({ shareLearning: true }); // the R1324 default-on shape, no row: must not contribute
    const no = await user();
    await featureRows(yes.id, 6, 0.5);
    await featureRows(stale.id, 6, 900);
    await featureRows(no.id, 6, 900);
    const ids = await consentedOwnerIds();
    expect(ids.ids).toContain(yes.id);
    expect(ids.ids).not.toContain(stale.id);
    expect(ids.staleMirrors).toBeGreaterThanOrEqual(1);
    const r = await rebuildShared();
    expect(r.consented).toBeGreaterThanOrEqual(1);
    const stored = await db.modelVersion.findUnique({ where: { key: SHARED_MODEL_KEY } });
    const doc = parseShared(stored!.data)!;
    const bucket = doc.buckets.find((b) => b.platform === "instagram" && b.format === "video" && b.category === "r1335");
    // Three creators posted in this category but only one consented: below the 5-creator floor, so no bucket at all.
    expect(bucket).toBeUndefined();
    expect(stored!.data).not.toContain(yes.id);
    expect(stored!.notes).toContain("Opt-in:");
  });

  test("a deletion request withdraws, makes the next sweep tick rebuild at once, and is marked done; a fresh yes afterwards is a new decision", async () => {
    const u = await user();
    await grantConsent(u.id, { source: "intelligence" });
    await rebuildShared(); // fresh document: the hourly timer alone would not rebuild now
    expect(await sweepShared(new Date())).toBeNull();

    const s = await requestDeletion(u.id, { source: "settings" });
    expect(s.granted).toBe(false);
    expect(s.deletion).toMatchObject({ status: "requested", doneAt: null });
    expect((await pendingDeletions()).some((d) => d.userId === u.id)).toBe(true);
    expect((await requestDeletion(u.id, { source: "settings" })).decisions).toBe(s.decisions); // idempotent while open

    const swept = await sweepShared(new Date());
    expect(swept).not.toBeNull();
    expect(swept!.deletions).toBeGreaterThanOrEqual(1);
    const after = await currentConsent(u.id);
    expect(after.deletion?.status).toBe("done");
    expect(after.deletion?.doneAt).not.toBeNull();
    expect((await pendingDeletions()).some((d) => d.userId === u.id)).toBe(false);
    expect(consentStatusLine(after)).toContain("was removed");

    const back = await grantConsent(u.id, { source: "settings" });
    expect(back.granted).toBe(true);
    expect(back.decisions).toBe(after.decisions + 1);

    // Never consented, asks anyway: recorded and closed at once (nothing was ever used).
    const fresh = await user();
    const f = await requestDeletion(fresh.id, { source: "api" });
    expect(f.granted).toBe(false);
    expect(f.deletion?.status).toBe("done");
    expect(await closeDeletions([])).toBe(0);
  });

  test("refreshScope follows the consent record, not the column; the admin summary is counts only", async () => {
    const u = await withoutIntelligence(await user({ shareLearning: true })); // stale mirror, plan without the perk
    expect(await refreshScope(u.id)).toEqual({ features: false, personal: false });
    await grantConsent(u.id, { source: "onboarding" });
    expect(await refreshScope(u.id)).toEqual({ features: true, personal: false });

    const sum = await consentSummary();
    expect(sum.granted).toBeGreaterThanOrEqual(1);
    expect(sum.byPolicyVersion[CONSENT_POLICY_VERSION]).toBeGreaterThanOrEqual(1);
    expect(sum.byCategory.content_metadata).toBeGreaterThanOrEqual(1);
    expect(sum.deletionsDone).toBeGreaterThanOrEqual(1);
    expect(sum.decisions30d.granted).toBeGreaterThanOrEqual(1);
    expect(Object.keys(sum).sort()).toEqual(["byCategory", "byPolicyVersion", "decisions30d", "deletionsDone", "deletionsOpen", "granted", "neverAsked", "staleMirrors", "withdrawn"]);
    expect(JSON.stringify(sum)).not.toContain("@test.dev");
  });
});

describe("R1335 source pins", () => {
  test("schema (both files), data step, UI never preselected, Settings mounts the card, the route reads no plan", () => {
    for (const f of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) {
      const s = read(f);
      expect(s).toContain("model AiDataConsent {");
      expect(s).toContain("shareLearning Boolean  @default(false)");
      expect(s).toContain("aiConsents  AiDataConsent[]");
      expect(s).toContain("@@index([deletionStatus, deletionRequestedAt])");
    }
    const sync = read("scripts/db-sync.mjs");
    expect(sync).toContain('export const DATA_SQL = ["supabase/migrations/0003_r1335_consent_mirror_reset.sql"]');
    expect(sync.indexOf("DATA_SQL)")).toBeLessThan(sync.indexOf("locking tables out of the public Data API"));
    const sql = read("supabase/migrations/0003_r1335_consent_mirror_reset.sql");
    expect(sql).toContain('SET "shareLearning" = false');
    expect(sql).toContain("NOT EXISTS");

    const rowUi = read("components/intelligence/SharingRow.tsx");
    expect(rowUi).toContain("aria-checked={granted}");
    expect(rowUi).not.toMatch(/useState\(true\)|defaultChecked/);
    expect(rowUi).toContain('action: "grant"');
    expect(rowUi).toContain('"request-deletion"');
    expect(rowUi).toContain("Never included, consent or not");
    expect(rowUi).toContain('role="switch"');
    expect(read("components/settings/SettingsView.tsx")).toContain("<AiConsentCard />");
    expect(read("components/settings/AiConsentCard.tsx")).toContain('<SharingRow source="settings" />');

    const route = read("app/api/intelligence/sharing/route.ts");
    expect(route).not.toMatch(/from "@\/lib\/(intelligence|billing)\/entitlements/);
    expect(route).not.toContain("shareLearning");
    expect(route).toContain('z.enum(["grant", "withdraw", "request-deletion"])');
    expect(route).toContain('if (user.role !== "owner") throw new HttpError(403');
    expect(read("lib/intelligence/consent.ts")).toContain('import "server-only"');
    const core = read("lib/intelligence/consent-core.ts");
    expect(core).not.toContain("server-only");
    expect(core).not.toContain("prisma");
    // The only writer of the mirror column.
    expect(read("lib/intelligence/shared.ts")).not.toContain("shareLearning");
    expect(read("lib/intelligence/entitlements.ts")).not.toContain("shareLearning");
    expect(read("app/admin/(panel)/intelligence/page.tsx")).toContain("participation.consented");
  });
});

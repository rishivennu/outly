/**
 * R1334 Phase 1: plan-based access to the Personal Intelligence engine.
 * Pure: the capability resolver, the perk, the presets, the copy. DB: the gate throws the structured 402 and logs one
 * denial a day; the sweep and refreshOwner build nothing personal for a free owner, features only for a consented one,
 * everything for an entitled one; a downgrade stops it at the next call; the pulse is null without the perk.
 * Source: every personal route, Home, Pip, the clipper and the view are wired to the gate.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "../lib/db";
import { HttpError } from "../lib/http";
import * as rules from "../lib/billing/plan-rules";
import * as preset from "../lib/billing/pricing-preset";
import { CAPABILITIES, COLD_START_COPY, INTELLIGENCE_PERK, UPGRADE_COPY, accessBlock, intelligenceAccessOf, notEntitledView } from "../lib/intelligence/entitlements-core";
import { entitledOwners, hasIntelligence, intelligenceAccess, requireIntelligence } from "../lib/intelligence/entitlements";
import { refreshOwner, refreshScope, sweepPersonal } from "../lib/intelligence/profile";
import { predictDraft } from "../lib/intelligence/model/predict";
import { personalRead } from "../lib/intelligence/personal-reco";
import { intelligencePulse } from "../lib/intelligence/pulse";
import { hintsFor } from "../lib/clipper/jobs";
import { downgrade, withIntelligence, withoutIntelligence } from "./helpers/intelligence-plan";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const DAY = 864e5;
const PAID = { source: "paid", planSlug: "creator", planName: "Creator" };

describe("1334 capability resolver (pure)", () => {
  test("one perk decides; legacy plans get it when paid; Free never; a plan that lists perks without it says so", () => {
    expect(rules.PERKS).toContain(INTELLIGENCE_PERK);
    expect(rules.PERK_LABEL[INTELLIGENCE_PERK]).toMatch(/Personal Intelligence/);
    const on = intelligenceAccessOf({ ...PAID, perks: ["weekly-digest", INTELLIGENCE_PERK] });
    expect(on).toMatchObject({ enabled: true, reason: "perk", upgrade: null, planName: "Creator" });
    for (const c of CAPABILITIES) expect(on.capabilities[c]).toBe(true);
    const off = intelligenceAccessOf({ ...PAID, perks: ["weekly-digest"] });
    expect(off).toMatchObject({ enabled: false, reason: "plan-without-perk", upgrade: "/billing" });
    for (const c of CAPABILITIES) expect(off.capabilities[c]).toBe(false);
    expect(intelligenceAccessOf({ ...PAID, perks: null })).toMatchObject({ enabled: true, reason: "legacy-paid" });
    expect(intelligenceAccessOf({ source: "free", planSlug: "free", planName: "Free", perks: null })).toMatchObject({ enabled: false, reason: "free" });
    expect(intelligenceAccessOf({ source: "free", planSlug: "free", planName: "Free", perks: [] })).toMatchObject({ enabled: false, reason: "free" });
    expect(intelligenceAccessOf({ source: "admin", planSlug: "x", planName: "Gift", perks: null }).enabled).toBe(true);
  });

  test("presets: Creator and Agency carry the perk, Free and Starter do not (Starter is the admin's toggle)", () => {
    for (const block of [preset.PRICING_2026_11, preset.PRICING_2026_11_R2]) {
      const perks = Object.fromEntries(block.map((p) => [p.slug, p.data.perks]));
      expect(perks.creator).toContain(INTELLIGENCE_PERK);
      expect(perks["pro-manager"]).toContain(INTELLIGENCE_PERK);
      expect(perks.free).not.toContain(INTELLIGENCE_PERK);
      expect(perks.starter).not.toContain(INTELLIGENCE_PERK);
    }
  });

  test("copy: the block names the plan and the door; the upgrade card promises nothing generated; the cold start line is the spec's", () => {
    expect(accessBlock("Starter")).toBe("Personal Intelligence isn't part of Starter. Upgrade in Billing to turn on your profile, forecasts and made-for-you recommendations.");
    expect(accessBlock("Starter", "personalized_clip_ranking_enabled")).toContain("clip ranking from your own history");
    expect(UPGRADE_COPY.points.length).toBeGreaterThanOrEqual(4);
    expect(UPGRADE_COPY.note).toMatch(/Nothing here is generated for you until you upgrade/);
    expect(COLD_START_COPY).toBe("Your Intelligence Engine is getting to know your content. As more performance data becomes available, your insights will become more personalized.");
    const v = notEntitledView(intelligenceAccessOf({ source: "free", planSlug: "free", planName: "Free", perks: [] }));
    expect(v).toEqual({ entitled: false, planName: "Free", upgrade: "/billing", message: accessBlock("Free") });
  });
});

let n = 0;
const plain = () => db.user.create({ data: { name: `E ${++n}`, email: `r1334-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x", shareLearning: false } });

async function seed(ownerId: string, posts: number, platform = "instagram") {
  const account = await db.socialAccount.create({ data: { userId: ownerId, platform, platformUserId: `${platform}-r1334-${Date.now()}-${Math.random()}`, username: "@e", accessToken: "x", status: "connected" } });
  const media = await db.media.create({ data: { userId: ownerId, originalFilename: "v.mp4", storageKey: `r1334/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready", duration: 40, width: 1080, height: 1920 } });
  for (let i = 0; i < posts; i++) {
    const at = new Date(Date.now() - (3 + i * 4) * DAY);
    const p = await db.post.create({ data: { userId: ownerId, mediaId: media.id, status: "published", publishedAt: at, hook: i % 2 ? "Why?" : null } });
    const t = await db.postTarget.create({ data: { postId: p.id, platform, socialAccountId: account.id, platformStatus: "published", publishedAt: at, caption: "A caption #one", practice: false } });
    await db.targetMetric.create({ data: { targetId: t.id, capturedAt: at, views: 100 + i * 30, likes: 2 } });
  }
  return account;
}

const personalRows = async (ownerId: string) => ({
  profiles: await db.creatorProfile.count({ where: { ownerId } }),
  states: await db.creatorModelState.count({ where: { ownerId } }),
  predictions: await db.predictionRecord.count({ where: { ownerId } }),
  features: await db.contentFeature.count({ where: { ownerId } }),
});

describe("1334 the gate (db)", () => {
  test("a free owner: structured 402 with the capability, one denial logged per capability per day; an entitled owner passes; a paid plan without the perk is blocked too", async () => {
    const free = await plain();
    const err = await requireIntelligence(free.id, "personalized_predictions_enabled").then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    const h = err as HttpError;
    expect(h.status).toBe(402);
    expect(h.code).toBe("PLAN_LIMIT");
    expect(h.extra).toEqual({ feature: "intelligence", capability: "personalized_predictions_enabled", upgrade: "/billing" });
    expect(h.message).toBe(accessBlock("Free", "personalized_predictions_enabled"));
    await requireIntelligence(free.id, "personalized_predictions_enabled").catch(() => null);
    await requireIntelligence(free.id, "personal_intelligence_enabled").catch(() => null);
    // The log write is fire-and-forget; give it a tick.
    await new Promise((r) => setTimeout(r, 150));
    const denied = await db.learningEvent.findMany({ where: { ownerId: free.id, type: "entitlement_denied" } });
    expect(denied).toHaveLength(2);
    expect(denied.map((d) => d.dedupeKey).sort()).toEqual([`denied:personal_intelligence_enabled:${new Date().toISOString().slice(0, 10)}`, `denied:personalized_predictions_enabled:${new Date().toISOString().slice(0, 10)}`]);
    expect(JSON.parse(denied[0].data!)).toMatchObject({ plan: "free", reason: "free" });

    const paid = await withIntelligence(await plain());
    const a = await requireIntelligence(paid.id);
    expect(a.enabled).toBe(true);
    expect(await hasIntelligence(paid.id, "personalized_clip_ranking_enabled")).toBe(true);
    expect((await intelligenceAccess(paid.id)).reason).toBe("perk");

    const noPerk = await withoutIntelligence(await plain());
    const e2 = await requireIntelligence(noPerk.id).then(() => null, (e: unknown) => e as HttpError);
    expect(e2?.status).toBe(402);
    expect((await intelligenceAccess(noPerk.id)).reason).toBe("plan-without-perk");
    expect([...(await entitledOwners([free.id, paid.id, noPerk.id]))]).toEqual([paid.id]);
  });

  test("refreshOwner and the sweep: nothing for a free owner, features only for a consented free owner, everything for an entitled one", async () => {
    const free = await plain();
    const consented = await db.user.create({ data: { name: "C", email: `r1334-c-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x", shareLearning: true } });
    const paid = await withIntelligence(await plain());
    for (const u of [free, consented, paid]) await seed(u.id, 6);

    expect(await refreshScope(free.id)).toEqual({ features: false, personal: false });
    expect(await refreshScope(consented.id)).toEqual({ features: true, personal: false });
    expect(await refreshScope(paid.id)).toEqual({ features: true, personal: true });

    const rf = await refreshOwner(free.id);
    expect(rf.skipped).toBe("not-entitled");
    expect(await personalRows(free.id)).toEqual({ profiles: 0, states: 0, predictions: 0, features: 0 });

    const rc = await refreshOwner(consented.id);
    expect(rc.skipped).toBe("features-only");
    const c = await personalRows(consented.id);
    expect(c.features).toBe(6);
    expect(c).toMatchObject({ profiles: 0, states: 0, predictions: 0 });

    const rp = await refreshOwner(paid.id);
    expect(rp.skipped).toBeNull();
    const p = await personalRows(paid.id);
    expect(p.features).toBe(6);
    expect(p.profiles).toBeGreaterThan(0);

    // The sweep, pointed at these three: the paid owner's profile is fresh (just built), so the query leaves them out;
    // of the other two it builds the consented one (features) and skips the free one. It never reads a client flag.
    const s = await sweepPersonal({ ownerIds: [free.id, consented.id, paid.id], maxOwners: 5 });
    expect(s.skipped).toBe(1);
    expect(s.owners).toBe(1);
    expect(await personalRows(free.id)).toEqual({ profiles: 0, states: 0, predictions: 0, features: 0 });
  });

  test("inference is paid: predictDraft, personalRead, the pulse and the clipper hint for a free owner; a downgrade stops them at once and deletes nothing", async () => {
    const free = await plain();
    await expect(predictDraft(free.id, { platform: "instagram", format: "reel" })).rejects.toMatchObject({ status: 402 });
    await expect(personalRead(free.id, { readOnly: true })).rejects.toMatchObject({ status: 402 });
    expect(await intelligencePulse(free.id)).toBeNull();
    expect(await hintsFor(free.id, ["instagram"])).toEqual({ hookLiftPct: null, shortVideoLiftPct: null });

    const paid = await withIntelligence(await plain());
    await seed(paid.id, 8);
    await refreshOwner(paid.id);
    const before = await personalRows(paid.id);
    expect(before.profiles).toBeGreaterThan(0);
    const pulse = await intelligencePulse(paid.id);
    expect(pulse).not.toBeNull();

    await downgrade(paid.id);
    expect((await intelligenceAccess(paid.id)).enabled).toBe(false);
    await expect(predictDraft(paid.id, { platform: "instagram", format: "reel" })).rejects.toMatchObject({ status: 402 });
    expect(await intelligencePulse(paid.id)).toBeNull();
    expect((await refreshOwner(paid.id)).skipped).toBe("not-entitled");
    // Retained, not deleted: a re-upgrade resumes from these rows.
    expect(await personalRows(paid.id)).toEqual(before);
  });
});

describe("1334 wiring (source)", () => {
  test("every personal route asks the gate; insights and pulse answer softly with `entitled`", () => {
    for (const [route, cap] of [
      ["predictions", "personalized_predictions_enabled"],
      ["recommendations", "personalized_recommendations_enabled"],
      ["profile", "personal_intelligence_enabled"],
      ["status", "personal_intelligence_enabled"],
      ["refresh", "personal_learning_enabled"],
      ["platforms/[platform]", "personal_intelligence_enabled"],
    ]) {
      const s = read(`app/api/intelligence/${route}/route.ts`);
      expect(s).toContain('import { requireIntelligence } from "@/lib/intelligence/entitlements";');
      expect(s).toContain(`await requireIntelligence(user.id, "${cap}");`);
    }
    expect(read("app/api/intelligence/predictions/route.ts").split('await requireIntelligence(user.id, "personalized_predictions_enabled");').length).toBe(3);
    for (const route of ["insights", "pulse"]) {
      const s = read(`app/api/intelligence/${route}/route.ts`);
      expect(s).toContain("const access = await intelligenceAccess(user.id);");
      expect(s).toContain("if (!access.enabled) return json({");
      expect(s).toContain("notEntitledView(access)");
      expect(s).toContain("entitled: true");
    }
    // Consent stays open to everyone, and the planner (workspace recommendations) is not a paid feature.
    expect(read("app/api/intelligence/sharing/route.ts")).not.toContain("requireIntelligence");
    expect(read("app/api/intelligence/feedback/route.ts")).not.toContain("requireIntelligence");
  });

  test("library gates: pulse, personalRead, predictDraft, clipper hints, refreshOwner and the sweep check the plan themselves", () => {
    expect(read("lib/intelligence/pulse.ts")).toContain("if (!(await hasIntelligence(ownerId))) return null;");
    expect(read("lib/intelligence/personal-reco.ts")).toContain('await requireIntelligence(ownerId, "personalized_recommendations_enabled");');
    expect(read("lib/intelligence/model/predict.ts")).toContain('await requireIntelligence(ownerId, "personalized_predictions_enabled");');
    expect(read("lib/clipper/jobs.ts")).toContain('hasIntelligence(ownerId, "personalized_clip_ranking_enabled")');
    const p = read("lib/intelligence/profile.ts");
    expect(p).toContain("export async function refreshScope(ownerId: string)");
    expect(p).toContain('if (!scope.features) return { features, profiles: [], clients: 0, predictions: null, skipped: "not-entitled" as const };');
    expect(p).toContain('if (!scope.personal) return { features, profiles: [], clients: 0, predictions: null, skipped: "features-only" as const };');
    expect(p).toContain("const scope = await refreshScope(ownerId);\n    if (scope.features) due.push({ ownerId, scope });");
    expect(read("lib/pip/tools-intelligence.ts")).toContain("const access = await intelligenceAccess(ctx.ownerId);");
    expect(read("lib/billing/entitlements.ts")).toContain('| "perk" | "intelligence"');
    expect(read("lib/intelligence/entitlements-core.ts")).not.toMatch(/prisma|server-only|from "\.\.\/db"/);
    expect(read("lib/intelligence/entitlements.ts")).toContain('import "server-only"');
  });

  test("the page decides on the server and the view renders the upgrade card or the personal layer; the sharing switch is reachable on both", () => {
    const page = read("app/(studio)/intelligence/page.tsx");
    expect(page).toContain("const access = await intelligenceAccess(user.id);");
    expect(page).toContain("personal={{ enabled: access.enabled, planName: access.planName }}");
    const view = read("components/intelligence/IntelligenceView.tsx");
    expect(view).toContain("{personal.enabled ? (");
    expect(view).toContain("<IntelligenceUpgrade planName={personal.planName} client={client || null} />");
    expect(view).toContain("<PersonalBaselines client={client || null} />");
    const up = read("components/intelligence/IntelligenceUpgrade.tsx");
    expect(up).toContain("UPGRADE_COPY");
    expect(up).toContain('href="/billing"');
    expect(up).toContain("{!client && <SharingRow />}");
    expect(up.slice(up.indexOf("return ("))).not.toMatch(/locked|blur|opacity-50/i);
    expect(read("components/intelligence/PersonalBaselines.tsx")).toContain("{!client && <SharingRow />}");
    expect(read("components/intelligence/SharingRow.tsx")).toContain("export function SharingRow()");
  });
});

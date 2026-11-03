import { z } from "zod";
import { json, HttpError } from "@/lib/http";
import { db } from "@/lib/db";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { getConfig, saveConfig } from "@/lib/settings";
import { audit } from "@/lib/billing/access";
import { normalizeTopups } from "@/lib/billing/topups-core";
import { normalizeExperiments } from "@/lib/billing/experiments-core";
import { experimentReport } from "@/lib/billing/experiments";
import { cancelReport, decisionMetrics, surveyReport } from "@/lib/billing/pricing-lab";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Everything the pricing lab panel shows: top-up packs, the price test and its results, the survey, cancel reasons, the decision rule. */
export const GET = adminRoute("pricing", async () => {
  const [topups, experiments, results, survey, cancels, metrics] = await Promise.all([
    getConfig("topups").then(normalizeTopups),
    getConfig("experiments").then(normalizeExperiments),
    experimentReport(),
    surveyReport(),
    cancelReport(),
    decisionMetrics(),
  ]);
  return json({ topups, experiments, results, survey, cancels, metrics });
});

const Put = z.object({ topups: z.unknown().optional(), experiments: z.unknown().optional() });

/** Saves the packs and/or the price test. Both are normalized, so a bad value falls back instead of breaking checkout. */
export const PUT = adminRoute("pricing", async (req, { admin }) => {
  const b = Put.parse(await req.json());
  if (b.topups === undefined && b.experiments === undefined) throw new HttpError(400, "Nothing to save.", "VALIDATION");
  const actor = { login: admin.login, role: admin.role };
  if (b.topups !== undefined) {
    const before = normalizeTopups(await getConfig("topups"));
    const next = normalizeTopups(b.topups);
    await saveConfig("topups", next);
    await audit({ actor, action: "pricing.topups", targetType: "config", targetId: "topups", before, after: next });
    await adminEvent("plan_changed", `${admin.name} updated top-up packs`, `${next.enabled ? "On" : "Off"}, ${next.packs.length} pack${next.packs.length === 1 ? "" : "s"}`, "/admin/pricing");
  }
  if (b.experiments !== undefined) {
    const before = normalizeExperiments(await getConfig("experiments"));
    const next = normalizeExperiments(b.experiments);
    await saveConfig("experiments", next);
    await audit({ actor, action: "pricing.experiments", targetType: "config", targetId: "experiments", before, after: next });
    await adminEvent("plan_changed", `${admin.name} ${next.price.enabled ? "ran" : "paused"} the price test`, `${next.price.name} on ${next.price.plan}`, "/admin/pricing");
  }
  return json({ topups: normalizeTopups(await getConfig("topups")), experiments: normalizeExperiments(await getConfig("experiments")) });
}, [30, 60_000]);

const Patch = z.object({ feedbackId: z.string().min(1).max(40), status: z.enum(["new", "contacted", "done"]) });

/** Marks a cancellation follow-up as contacted or done. */
export const PATCH = adminRoute("pricing", async (req) => {
  const b = Patch.parse(await req.json());
  const r = await db.cancelFeedback.updateMany({ where: { id: b.feedbackId }, data: { status: b.status } });
  if (!r.count) throw new HttpError(404, "That feedback is gone.");
  return json({ ok: true });
}, [60, 60_000]);

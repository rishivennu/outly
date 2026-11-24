import "server-only";
import { db } from "../db";
import { ACTIVE_MODEL, modelStates } from "./model/predict";
import { accuracyWords } from "./model/scorer-core";
import { personalRead } from "./personal-reco";
import { pickTop, type ClipperPulse, type IntelligencePulse, type PulseBaseline, type PulsePlatform } from "./pulse-core";

/**
 * R1325: the stored side of the Intelligence pulse. Reads what the engine already keeps (CreatorModelState, the
 * personal recommendations in readOnly mode, clipper counts) and never writes, so Home, Pip and the email can call it
 * freely. Null when the workspace has nothing measured and no clipper job: the card is simply not shown.
 */
export async function intelligencePulse(ownerId: string, opts: { now?: number; scopeKey?: string; targetIds?: string[] | null } = {}): Promise<IntelligencePulse | null> {
  const now = opts.now ?? Date.now();
  const scopeKey = opts.scopeKey ?? "";
  const [states, evals, personal, clipper] = await Promise.all([
    modelStates(ownerId, { scopeKey, targetIds: opts.targetIds, now }),
    scopeKey ? [] : db.intelligenceEvaluation.findMany({ where: { ownerId, modelKey: ACTIVE_MODEL, platform: { not: "" } }, orderBy: { at: "desc" }, take: 20, select: { platform: true, n: true, medianApe: true, mape: true, within: true, biasPct: true } }),
    personalRead(ownerId, { scopeKey, targetIds: opts.targetIds, now, readOnly: true }).catch(() => null),
    clipperPulse(ownerId),
  ]);
  const latest = new Map<string, (typeof evals)[number]>();
  for (const e of evals) if (!latest.has(e.platform)) latest.set(e.platform, e);
  const platforms: PulsePlatform[] = states.map((s) => {
    const byFormat: PulseBaseline[] = s.byFormat.map((f) => ({ format: f.format, predicted: f.predicted, low: f.low, high: f.high, n: f.n, shared: f.prior?.shared ? { n: f.prior.n, owners: f.prior.owners } : null }));
    const e = latest.get(s.platform);
    return { platform: s.platform, level: s.level, measured: s.measured, top: pickTop(byFormat), accuracyWords: e ? accuracyWords({ n: e.n, medianApe: e.medianApe, mape: e.mape, within: e.within, biasPct: e.biasPct }) : null };
  });
  // The first still-open personal recommendation; one already acted on or dismissed is not repeated here.
  const r = personal?.recommendations.find((x) => x.status === "open" || x.status === "saved") ?? null;
  if (!platforms.length && !clipper) return null;
  return {
    platforms,
    recommendation: r ? { id: r.id, title: r.title, why: r.why, platform: r.platform, confidence: r.confidence } : null,
    clipper,
    computedAt: new Date(now).toISOString(),
  };
}

/** The clipper queue in counts; null when this workspace never made a job. */
export async function clipperPulse(ownerId: string): Promise<ClipperPulse | null> {
  const any = await db.clipJob.findFirst({ where: { ownerId }, select: { id: true } });
  if (!any) return null;
  const [running, review, failed, readyToPost, published] = await Promise.all([
    db.clipJob.count({ where: { ownerId, status: { in: ["queued", "running"] } } }),
    db.clipJob.count({ where: { ownerId, status: "ready", stage: "review" } }),
    db.clipJob.count({ where: { ownerId, status: "failed" } }),
    db.generatedClip.count({ where: { ownerId, status: "approved", renderStatus: "rendered", postId: null } }),
    db.generatedClip.count({ where: { ownerId, status: "published" } }),
  ]);
  return { running, review, readyToPost, published, failed };
}

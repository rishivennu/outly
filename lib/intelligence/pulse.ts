import "server-only";
import { db } from "../db";
import { ACTIVE_MODEL, modelStates } from "./model/predict";
import { accuracyWords } from "./model/scorer-core";
import { personalRead } from "./personal-reco";
import { ACCURACY_MAX_AGE_DAYS, FAILED_WINDOW_DAYS, pickTop, sampleWords, type ClipperPulse, type IntelligencePulse, type PulseBaseline, type PulsePlatform } from "./pulse-core";

const DAY_MS = 86_400_000;

/**
 * R1325: the stored side of the Intelligence pulse. Reads what the engine already keeps (CreatorModelState, the
 * personal recommendations in readOnly mode, clipper counts) and writes nothing of its own (`modelStates` may
 * recalibrate a state that leaned on a retired cohort document; it is read ONCE here and handed to personalRead, so
 * two reads never race). Null when the workspace has nothing measured and no clipper job: the card is simply not shown.
 * A scoped teammate with no accounts (`targetIds: []`) gets the honest empty pulse, never the workspace's.
 */
export async function intelligencePulse(ownerId: string, opts: { now?: number; scopeKey?: string; targetIds?: string[] | null } = {}): Promise<IntelligencePulse | null> {
  const now = opts.now ?? Date.now();
  const scopeKey = opts.scopeKey ?? "";
  if (opts.targetIds && !opts.targetIds.length) {
    const clipper = await clipperPulse(ownerId, now);
    return clipper ? { platforms: [], recommendation: null, clipper, computedAt: new Date(now).toISOString() } : null;
  }
  const [states, evals, clipper] = await Promise.all([
    modelStates(ownerId, { scopeKey, targetIds: opts.targetIds, now }),
    scopeKey
      ? []
      : db.intelligenceEvaluation.findMany({
          where: { ownerId, modelKey: ACTIVE_MODEL, platform: { not: "" }, at: { gte: new Date(now - ACCURACY_MAX_AGE_DAYS * DAY_MS) } },
          orderBy: { at: "desc" },
          take: 20,
          select: { platform: true, n: true, medianApe: true, mape: true, within: true, biasPct: true },
        }),
    clipperPulse(ownerId, now),
  ]);
  const personal = await personalRead(ownerId, { scopeKey, targetIds: opts.targetIds, now, readOnly: true, states }).catch(() => null);
  const latest = new Map<string, (typeof evals)[number]>();
  for (const e of evals) if (!latest.has(e.platform)) latest.set(e.platform, e);
  const platforms: PulsePlatform[] = states.map((s) => {
    // A format whose number rests on neither its own posts nor the cohort (the platform-wide prior) has no sample to name here: left out.
    const byFormat: PulseBaseline[] = s.byFormat
      .map((f) => ({ format: f.format, predicted: f.predicted, low: f.low, high: f.high, n: f.n, shared: f.prior?.shared ? { n: f.prior.n, owners: f.prior.owners } : null }))
      .filter((b) => sampleWords(b) !== null);
    const e = latest.get(s.platform);
    return { platform: s.platform, level: s.level, measured: s.measured, top: pickTop(byFormat), accuracyWords: e ? accuracyWords({ n: e.n, medianApe: e.medianApe, mape: e.mape, within: e.within, biasPct: e.biasPct }) : null };
  });
  // The first still-open personal recommendation; one already acted on or dismissed is not repeated here. A draft
  // that was never stored has no id and cannot take feedback, so it is not offered as one.
  const r = personal?.recommendations.find((x) => (x.status === "open" || x.status === "saved") && x.id) ?? null;
  if (!platforms.length && !clipper) return null;
  return {
    platforms,
    recommendation: r ? { id: r.id, title: r.title, why: r.why, platform: r.platform, confidence: r.confidence } : null,
    clipper,
    computedAt: new Date(now).toISOString(),
  };
}

/**
 * The clipper queue in counts; null when this workspace never made a job. `published` counts a clip whose post went
 * out even before anyone opened the clipper (the clip row itself flips lazily, `clipsWithPosts`); `failed` counts the
 * last FAILED_WINDOW_DAYS only.
 */
export async function clipperPulse(ownerId: string, now = Date.now()): Promise<ClipperPulse | null> {
  const any = await db.clipJob.findFirst({ where: { ownerId }, select: { id: true } });
  if (!any) return null;
  const [queued, running, review, failed, readyToPost, published] = await Promise.all([
    db.clipJob.count({ where: { ownerId, status: "queued" } }),
    db.clipJob.count({ where: { ownerId, status: "running" } }),
    db.clipJob.count({ where: { ownerId, status: "ready", stage: "review" } }),
    db.clipJob.count({ where: { ownerId, status: "failed", updatedAt: { gte: new Date(now - FAILED_WINDOW_DAYS * DAY_MS) } } }),
    db.generatedClip.count({ where: { ownerId, status: "approved", renderStatus: "rendered", postId: null } }),
    db.generatedClip.count({ where: { ownerId, OR: [{ status: "published" }, { status: { in: ["draft", "approved"] }, post: { status: { in: ["published", "partial"] } } }] } }),
  ]);
  return { queued, running, review, readyToPost, published, failed };
}

import "server-only";
import type { Recommendation as RecoRow } from "@prisma/client";
import { db } from "../db";
import { rangeLabel } from "../analytics/core";
import { gemini } from "../ai/creative";
import { activeAiGrant, countFeatureUse, utcDayKey } from "../ai/entitlements";
import { aiAvailable } from "../live/review";
import { MAX_RECOMMENDATIONS, type Confidence, type Evidence, type Period, type Recommendation } from "./core";
import { dedupeKeyOf, isExpired, RECO_STATUSES, ruleKeyOf, validateWording, type RecoStatus, type RecoWording } from "./reco-core";

/**
 * R1239: stored recommendations. The engine (./core.ts) drafts them from measured lifts; this file keeps them,
 * idempotently, with an audit trail, and lets AI reword a new one only when every number survives (./reco-core.ts).
 * Every read and write is scoped by ownerId and scopeKey.
 *
 * One live row per rule: while a recommendation from the same rule (same platform, format and topic) is open,
 * in progress or closed, and not yet expired, a regeneration returns that row instead of adding a new one. So
 * the dashboard's ids stay stable across days, and a rejected or done one is never brought back by the next
 * read. Once it expires (two period lengths old) fresh numbers may make a new one.
 */

export interface StoredRecommendation extends Omit<Recommendation, "id" | "confidence"> {
  id: string;
  ownerId: string;
  scopeKey: string;
  /** The engine rule and subject it came from (ruleKeyOf). */
  rule: string;
  dedupeKey: string;
  status: RecoStatus;
  wordedBy: "rules" | "ai";
  confidence: Confidence;
  periodFrom: string;
  periodTo: string;
  feedback: string | null;
  contentItemId: string | null;
  createdAt: string;
}

/** Asks a model for a JSON answer. Injected in tests; in the app it is the shared gemini helper (lib/ai/creative.ts). */
export type AskJson = (system: string, prompt: string) => Promise<unknown>;

const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
const isStatus = (s: unknown): s is RecoStatus => typeof s === "string" && (RECO_STATUSES as readonly string[]).includes(s);
const CONFIDENCES: readonly Confidence[] = ["low", "medium", "high"];

function view(r: RecoRow): StoredRecommendation {
  const ev = parse<Evidence & { rule?: string }>(r.evidence, {} as Evidence & { rule?: string });
  const { rule = "", ...evidence } = ev;
  const fallbackAction: Recommendation["nextAction"] = { kind: "create", label: "Draft it in Content Studio", prefill: { platform: r.platform ?? "", format: r.format ?? "", topic: null, basedOn: [] } };
  return {
    id: r.id,
    ownerId: r.ownerId,
    scopeKey: r.scopeKey,
    rule,
    dedupeKey: r.dedupeKey,
    title: r.title,
    format: r.format ?? "",
    platform: r.platform ?? "",
    concept: r.concept,
    why: r.why,
    evidence: evidence as Evidence,
    postsAnalyzed: r.postsAnalyzed,
    period: rangeLabel({ from: r.periodFrom, to: r.periodTo }),
    periodFrom: r.periodFrom,
    periodTo: r.periodTo,
    confidence: (CONFIDENCES as readonly string[]).includes(r.confidence) ? (r.confidence as Confidence) : "low",
    nextAction: parse(r.nextAction, fallbackAction),
    status: isStatus(r.status) ? r.status : "open",
    wordedBy: r.wordedBy === "ai" ? "ai" : "rules",
    feedback: r.feedback,
    contentItemId: r.contentItemId,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Marks open recommendations past their life (isExpired) as expired, with an event each. Returns how many. */
export async function expireStale(ownerId: string, scopeKey: string, now: number = Date.now()): Promise<number> {
  const open = await db.recommendation.findMany({ where: { ownerId, scopeKey, status: "open" }, select: { id: true, status: true, createdAt: true, periodFrom: true, periodTo: true }, take: 500 });
  const ids = open.filter((r) => isExpired(r, now)).map((r) => r.id);
  if (!ids.length) return 0;
  const at = new Date(now);
  // Only rows still open: a creator acting on one at the same moment wins.
  const done = await db.recommendation.updateMany({ where: { id: { in: ids }, ownerId, status: "open" }, data: { status: "expired" } });
  await db.recommendationEvent.createMany({ data: ids.map((id) => ({ recommendationId: id, type: "expired", at })) });
  return done.count;
}

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

/**
 * Stores the engine's drafts for `period` and returns the row behind each, in the drafts' order. New rows get a
 * 'generated' event; existing ones (same dedupeKey, or a live row from the same rule) are returned untouched, so
 * a status the creator set is never changed here. New rows are reworded by AI when it is on, at most
 * MAX_RECOMMENDATIONS per call, and keep the rule text whenever the rewording fails the check.
 */
export async function persistRecommendations(
  ownerId: string,
  scopeKey: string,
  drafts: Recommendation[],
  period: Pick<Period, "from" | "to">,
  opts: { now?: number; ask?: AskJson | null } = {},
): Promise<StoredRecommendation[]> {
  const now = opts.now ?? Date.now();
  await expireStale(ownerId, scopeKey, now);
  const list = (Array.isArray(drafts) ? drafts : []).slice(0, MAX_RECOMMENDATIONS);
  if (!list.length) return [];
  const live = await db.recommendation.findMany({ where: { ownerId, scopeKey, status: { not: "expired" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 300 });
  const byRule = new Map<string, RecoRow>();
  for (const r of live) {
    const rule = parse<{ rule?: string }>(r.evidence, {}).rule;
    if (rule && !byRule.has(rule)) byRule.set(rule, r);
  }
  const out: RecoRow[] = [];
  const fresh: RecoRow[] = [];
  for (const d of list) {
    const rule = ruleKeyOf(d);
    const known = byRule.get(rule);
    if (known) {
      out.push(known);
      continue;
    }
    const dedupeKey = dedupeKeyOf(d, period);
    try {
      const row = await db.recommendation.create({
        data: {
          ownerId,
          scopeKey,
          dedupeKey,
          title: d.title,
          format: d.format || null,
          platform: d.platform || null,
          concept: d.concept,
          why: d.why,
          evidence: JSON.stringify({ ...d.evidence, rule }),
          postsAnalyzed: d.postsAnalyzed,
          periodFrom: period.from,
          periodTo: period.to,
          confidence: d.confidence,
          nextAction: JSON.stringify(d.nextAction),
          createdAt: new Date(now),
        },
      });
      await db.recommendationEvent.create({ data: { recommendationId: row.id, type: "generated", data: JSON.stringify({ rule }), at: new Date(now) } });
      byRule.set(rule, row);
      out.push(row);
      fresh.push(row);
    } catch (e) {
      // A parallel read stored the same draft first: use its row, and its 'generated' event stands.
      if (!isUnique(e)) throw e;
      const row = await db.recommendation.findUnique({ where: { ownerId_scopeKey_dedupeKey: { ownerId, scopeKey, dedupeKey } } });
      if (!row) throw e;
      byRule.set(rule, row);
      out.push(row);
    }
  }
  const views = out.map(view);
  const ask = opts.ask !== undefined ? opts.ask : defaultAsk();
  if (!ask || !fresh.length) return views;
  // R1244: metered like every AI call, only with a grant covering it, and within the owner's day cap.
  const allowed = Math.min(MAX_RECOMMENDATIONS, await wordingAllowance(ownerId, now));
  const ids = new Set(fresh.slice(0, allowed).map((r) => r.id));
  if (!ids.size) return views;
  // Counted one by one before the parallel calls, so concurrent upserts on the same usage row never race.
  for (let i = 0; i < ids.size; i++) await countFeatureUse(ownerId, WORDING_FEATURE, true, new Date(now));
  return Promise.all(views.map((v) => (ids.has(v.id) ? wordOne(v, ask) : v)));
}

/** Newest first. An unknown status filter matches nothing rather than everything. */
export async function listRecommendations(ownerId: string, scopeKey: string, opts: { status?: string; limit?: number } = {}): Promise<StoredRecommendation[]> {
  if (opts.status !== undefined && !isStatus(opts.status)) return [];
  await expireStale(ownerId, scopeKey);
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 20) || 20));
  const rows = await db.recommendation.findMany({
    where: { ownerId, scopeKey, ...(opts.status ? { status: opts.status } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map(view);
}

/**
 * R1244: the read-only twin of persistRecommendations, for Pip. Each draft is answered with the live row already
 * stored for its rule (an open row past its expiry counts as expired, without writing that), or, when none is
 * stored yet, with the draft itself as an unsaved row: id "", status open, wordedBy rules. Writes nothing.
 */
export async function storedFor(ownerId: string, scopeKey: string, drafts: Recommendation[], period: Pick<Period, "from" | "to">, now: number = Date.now()): Promise<StoredRecommendation[]> {
  const list = (Array.isArray(drafts) ? drafts : []).slice(0, MAX_RECOMMENDATIONS);
  if (!list.length) return [];
  const live = await db.recommendation.findMany({ where: { ownerId, scopeKey, status: { not: "expired" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 300 });
  const byRule = new Map<string, StoredRecommendation>();
  for (const r of live) {
    const v = view(r);
    if (!v.rule || byRule.has(v.rule)) continue;
    byRule.set(v.rule, isExpired(v, now) ? { ...v, status: "expired" } : v);
  }
  return list.map((d) => {
    const rule = ruleKeyOf(d);
    const known = byRule.get(rule);
    if (known) return known;
    const { id: _draftId, ...rest } = d;
    void _draftId;
    return { ...rest, id: "", ownerId, scopeKey, rule, dedupeKey: dedupeKeyOf(d, period), status: "open", wordedBy: "rules", periodFrom: period.from, periodTo: period.to, feedback: null, contentItemId: null, createdAt: new Date(now).toISOString() };
  });
}

/* ------------------------------------------------------------------ AI wording */

/** R1244: the AiFeature the admin grants and AiFeatureUsage counts for recommendation wording. */
export const WORDING_FEATURE = "intelligence_wording" as const;
/** R1244: rewordings per owner per UTC day, on top of MAX_RECOMMENDATIONS per call. */
export const WORDING_DAY_CAP = 30;

/**
 * R1244: how many rewordings this owner may still have today. 0 without a live AI grant covering
 * WORDING_FEATURE (lib/ai/entitlements.ts) or once WORDING_DAY_CAP calls were counted today; then the rule
 * text is kept, with no error.
 */
export async function wordingAllowance(ownerId: string, now: number = Date.now()): Promise<number> {
  if (!ownerId) return 0;
  const at = new Date(now);
  if (!(await activeAiGrant(ownerId, WORDING_FEATURE, at))) return 0;
  const used = await db.aiFeatureUsage.findUnique({ where: { userId_day_feature: { userId: ownerId, day: utcDayKey(at), feature: WORDING_FEATURE } }, select: { count: true } });
  return Math.max(0, WORDING_DAY_CAP - (used?.count ?? 0));
}

/** The same model gate as the Profile Review deep review (lib/live/review.ts). */
function defaultAsk(): AskJson | null {
  if (!aiAvailable()) return null;
  return (system, prompt) => gemini<unknown>(system, prompt, { temperature: 0.4, timeoutMs: 8_000 });
}

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * Rewords one open, rule-worded recommendation. The model only rephrases: validateWording rejects any answer that
 * drops or changes a number, a platform or a format, and then the rule text stays (wordedBy 'rules').
 */
export async function wordRecommendation(rec: StoredRecommendation, opts: { ask?: AskJson | null; now?: number } = {}): Promise<StoredRecommendation> {
  if (rec.wordedBy !== "rules" || rec.status !== "open") return rec;
  const ask = opts.ask !== undefined ? opts.ask : defaultAsk();
  if (!ask) return rec;
  const now = opts.now ?? Date.now();
  if ((await wordingAllowance(rec.ownerId, now)) < 1) return rec;
  await countFeatureUse(rec.ownerId, WORDING_FEATURE, true, new Date(now));
  return wordOne(rec, ask);
}

/** One model call, already allowed and counted by the caller. */
async function wordOne(rec: StoredRecommendation, ask: AskJson): Promise<StoredRecommendation> {
  if (rec.wordedBy !== "rules" || rec.status !== "open") return rec;
  const original: RecoWording = { title: rec.title, concept: rec.concept, why: rec.why, nextAction: { label: rec.nextAction.label } };
  const raw = (await ask(
    "You reword content recommendations for a creator. Keep every number, percentage, date, platform name and format word exactly as given. Do not add any fact, number, platform, benchmark or promise. Plain words, short sentences, no emoji, no hype, no em dashes. Speak to the creator as you.",
    `Reword this recommendation so it reads naturally. Reply as JSON with exactly these keys: {"title": max 90 characters, "concept": max 220, "why": max 320, "label": max 40, a button label}.\n${JSON.stringify({ title: original.title, concept: original.concept, why: original.why, label: original.nextAction.label })}`,
  ).catch(() => null)) as { title?: unknown; concept?: unknown; why?: unknown; label?: unknown } | null;
  if (!raw || typeof raw !== "object") return rec;
  const worded: RecoWording = { title: clean(raw.title), concept: clean(raw.concept), why: clean(raw.why), nextAction: { label: clean(raw.label) } };
  if (!validateWording(original, worded).ok) return rec;
  const nextAction = { ...rec.nextAction, label: worded.nextAction.label };
  const done = await db.recommendation.updateMany({
    where: { id: rec.id, ownerId: rec.ownerId, wordedBy: "rules", status: "open" },
    data: { title: worded.title, concept: worded.concept, why: worded.why, nextAction: JSON.stringify(nextAction), wordedBy: "ai" },
  });
  if (!done.count) return rec;
  await db.recommendationEvent.create({ data: { recommendationId: rec.id, type: "worded", data: JSON.stringify({ by: "ai" }) } });
  return { ...rec, title: worded.title, concept: worded.concept, why: worded.why, nextAction, wordedBy: "ai" };
}

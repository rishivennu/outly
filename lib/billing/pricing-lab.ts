import "server-only";
import { db } from "../db";
import { GIFT_PROVIDERS } from "./access-core";
import { CANCEL_REASONS, KEEP_RULE, keepStructure, vanWestendorp, type PriceAnswers } from "./experiments-core";

export const PRICE_SURVEY = "price-2026-11";
const DAY = 86_400_000;

/**
 * The strategy's decision rule, measured (1096).
 * freeToPaid60: of people who signed up 60 to 120 days ago (old enough to have had a full 60 days), the share
 * whose first successful plan payment landed within 60 days of signing up.
 * churn: paid subscriptions cancelled in the last 30 days, over those that were live 30 days ago.
 */
export async function decisionMetrics(now = new Date()) {
  const from = new Date(now.getTime() - 120 * DAY);
  const to = new Date(now.getTime() - 60 * DAY);
  const cohort = await db.user.findMany({ where: { createdAt: { gte: from, lt: to } }, select: { id: true, createdAt: true }, take: 50_000 });
  const joined = new Map(cohort.map((u) => [u.id, u.createdAt.getTime()]));
  let converted = 0;
  const ids = cohort.map((u) => u.id);
  for (let i = 0; i < ids.length; i += 1000) {
    const pays = await db.payment.findMany({
      where: { userId: { in: ids.slice(i, i + 1000) }, status: "succeeded", purpose: { not: "topup" }, amountMinor: { gt: 0 }, sample: false },
      select: { userId: true, createdAt: true },
    });
    const first = new Map<string, number>();
    for (const p of pays) first.set(p.userId, Math.min(first.get(p.userId) ?? Infinity, p.createdAt.getTime()));
    for (const [u, t] of first) if (t - (joined.get(u) ?? Infinity) <= 60 * DAY) converted++;
  }
  const monthAgo = new Date(now.getTime() - 30 * DAY);
  // Real paid plans only: beta and referral gifts carry a price but nobody paid it, and sample rows are demo data.
  const paid = { priceMinor: { gt: 0 }, sample: false, provider: { notIn: [...GIFT_PROVIDERS] } };
  const [liveThen, cancelled] = await Promise.all([
    db.subscription.count({ where: { ...paid, createdAt: { lt: monthAgo }, OR: [{ canceledAt: null }, { canceledAt: { gte: monthAgo } }], NOT: { status: "canceled", canceledAt: null } } }),
    db.subscription.count({ where: { ...paid, createdAt: { lt: monthAgo }, canceledAt: { gte: monthAgo, lte: now } } }),
  ]);
  const freeToPaid60 = cohort.length ? converted / cohort.length : 0;
  const churn = liveThen ? cancelled / liveThen : 0;
  return {
    cohort: cohort.length, converted, freeToPaid60,
    liveThen, cancelled, churn,
    rule: KEEP_RULE,
    keep: keepStructure({ freeToPaid60, churn }),
    // Under ~100 signups or ~30 subscribers the numbers move a lot week to week; the panel says so.
    enoughData: cohort.length >= 100 && liveThen >= 30,
  };
}

/** Van Westendorp per plan and currency (answers in different currencies never mix). */
export async function surveyReport(survey = PRICE_SURVEY) {
  const rows = await db.surveyResponse.findMany({ where: { survey }, select: { planSlug: true, currency: true, answers: true }, take: 20_000 });
  const groups = new Map<string, PriceAnswers[]>();
  for (const r of rows) {
    let a: PriceAnswers;
    try {
      a = JSON.parse(r.answers);
    } catch {
      continue;
    }
    const k = `${r.planSlug || "any"}|${r.currency}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return {
    survey,
    total: rows.length,
    groups: [...groups].map(([k, answers]) => {
      const [plan, currency] = k.split("|");
      return { plan, currency, ...vanWestendorp(answers) };
    }),
  };
}

/** Recent cancellation reasons, plus counts per reason over the last 90 days. */
export async function cancelReport(now = new Date()) {
  const since = new Date(now.getTime() - 90 * DAY);
  const [recent, grouped] = await Promise.all([
    db.cancelFeedback.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { email: true, name: true } } } }),
    db.cancelFeedback.groupBy({ by: ["reason"], where: { createdAt: { gte: since } }, _count: true }),
  ]);
  return {
    counts: CANCEL_REASONS.map((reason) => ({ reason, count: grouped.find((g) => g.reason === reason)?._count ?? 0 })),
    recent: recent.map((f) => ({ id: f.id, reason: f.reason, detail: f.detail, interview: f.interview, contact: f.contact, status: f.status, planSlug: f.planSlug, createdAt: f.createdAt, email: f.user.email, name: f.user.name })),
  };
}

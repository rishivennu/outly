import "server-only";
import type { NextRequest } from "next/server";
import { format } from "date-fns";
import { db } from "../db";
import { ensurePlans } from "../billing/plans";
import { isPaidSub } from "../billing/access-core";
import { notify } from "../retention/notices";
import { getPolicy } from "./policy";
import { ledgerKeysForUser } from "./keys";
import { captureSignal, deviceIdFromRequest } from "./signals";
import { assessRisk } from "./risk";

/*
 * 1147: the 7-day trial. Creator features, no card, once per person. Access comes from a PlanGrant with
 * source "trial", so every limit check (lib/billing/access.ts) sees it without knowing trials exist, and the
 * account drops back to Free by itself when the grant ends.
 */

export const MAX_TRIAL_DAYS = 7;
export const TRIAL_SOURCE = "trial";
export type TrialStatus = "active" | "converted" | "expired" | "canceled";
export type TrialRefusal = "used" | "risk_denied" | "needs_verification" | "disabled" | "already_paid";
export type TrialRow = NonNullable<Awaited<ReturnType<typeof db.trial.findUnique>>>;

const DAY = 864e5;
const isClash = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

async function settings() {
  const t = await getPolicy();
  return { enabled: t.enabled, days: Math.max(0, Math.min(MAX_TRIAL_DAYS, Math.floor(t.trialDays))), planSlug: t.trialPlanSlug };
}

/** A live paid plan, or any real payment before (a refund still counts: the person was a subscriber). */
async function hasPaidAccess(userId: string, now = new Date()) {
  const [subs, paid] = await Promise.all([
    db.subscription.findMany({ where: { userId, status: "active", currentPeriodEnd: { gt: now } }, select: { provider: true, priceMinor: true, sample: true } }),
    db.payment.count({ where: { userId, status: { in: ["succeeded", "refunded"] }, sample: false, amountMinor: { gt: 0 } } }),
  ]);
  return paid > 0 || subs.some((s) => isPaidSub(s));
}

/** Ledger keys of this person that already had a trial or a first paid period (on any account). */
async function usedKeys(userId: string, deviceId: string | null) {
  const keys = await ledgerKeysForUser(userId, deviceId ? { deviceId } : undefined);
  if (!keys.length) return { keys, used: false };
  const hit = await db.offerLedger.findFirst({
    where: { OR: keys.map((k) => ({ kind: k.kind, keyHash: k.keyHash })), AND: [{ OR: [{ trialUsedAt: { not: null } }, { firstPaidAt: { not: null } }] }] },
    select: { id: true },
  });
  return { keys, used: !!hit };
}

export const daysLeft = (endsAt: Date, now = new Date()) => Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY));

/** What Billing and the welcome screen show: the trial (if any) and whether one can start now. */
export async function trialState(userId: string, now = new Date()) {
  const cfg = await settings();
  const trial = await db.trial.findUnique({ where: { userId } });
  const view = trial && { id: trial.id, status: trial.status as TrialStatus, startedAt: trial.startedAt, endsAt: trial.endsAt, daysLeft: trial.status === "active" ? daysLeft(trial.endsAt, now) : 0, planId: trial.planId };
  let canStart = false;
  let reason: TrialRefusal | null = null;
  if (!cfg.enabled || cfg.days === 0) reason = "disabled";
  else if (trial) reason = "used";
  else if (await hasPaidAccess(userId, now)) reason = "already_paid";
  else if ((await usedKeys(userId, null)).used) reason = "used";
  else {
    const flag = await db.riskFlag.findFirst({ where: { userId, status: { in: ["open", "confirmed"] }, action: { in: ["deny_offer", "verify"] } }, orderBy: { createdAt: "desc" }, select: { action: true } });
    reason = flag?.action === "deny_offer" ? "risk_denied" : flag?.action === "verify" ? "needs_verification" : null;
    canStart = !reason || reason === "needs_verification";
  }
  return { trial: view, canStart, reason, trialDays: cfg.days, planSlug: cfg.planSlug };
}

/** Starts the once-per-person trial. Every refusal is a plain reason the UI turns into next steps. */
export async function startTrial(o: { userId: string; req: NextRequest; source?: "billing" | "welcome"; now?: Date }): Promise<{ ok: true; trial: TrialRow } | { ok: false; reason: TrialRefusal; flagId?: string | null }> {
  const now = o.now ?? new Date();
  const cfg = await settings();
  if (!cfg.enabled || cfg.days === 0) return { ok: false, reason: "disabled" };
  if (await db.trial.findUnique({ where: { userId: o.userId }, select: { id: true } })) return { ok: false, reason: "used" };
  if (await hasPaidAccess(o.userId, now)) return { ok: false, reason: "already_paid" };

  const deviceId = deviceIdFromRequest(o.req);
  await captureSignal({ req: o.req, userId: o.userId, event: "trial" }).catch((e) => console.error("[trial] signal", e));
  const { keys, used } = await usedKeys(o.userId, deviceId);
  if (used) return { ok: false, reason: "used" };
  const risk = await assessRisk({ userId: o.userId, context: "trial", deviceId, now });
  if (risk.action === "deny_offer") return { ok: false, reason: "risk_denied", flagId: risk.flagId };
  if (risk.action === "verify") return { ok: false, reason: "needs_verification", flagId: risk.flagId };

  await ensurePlans();
  const plan = await db.plan.findUnique({ where: { slug: cfg.planSlug } });
  if (!plan) return { ok: false, reason: "disabled" };
  const user = await db.user.findUniqueOrThrow({ where: { id: o.userId }, select: { email: true } });
  const endsAt = new Date(now.getTime() + cfg.days * DAY);
  try {
    const [trial] = await db.$transaction([
      db.trial.create({ data: { userId: o.userId, planId: plan.id, startedAt: now, endsAt, source: o.source ?? "billing" } }),
      db.planGrant.create({ data: { userId: o.userId, email: user.email.toLowerCase(), planId: plan.id, source: TRIAL_SOURCE, status: "active", startsAt: now, endsAt, note: `${cfg.days}-day trial`, grantedBy: "system" } }),
      ...keys.map((k) =>
        db.offerLedger.upsert({
          where: { kind_keyHash: { kind: k.kind, keyHash: k.keyHash } },
          create: { kind: k.kind, keyHash: k.keyHash, trialUsedAt: now, userId: o.userId },
          update: { trialUsedAt: now, userId: o.userId },
        }),
      ),
    ]);
    return { ok: true, trial };
  } catch (e) {
    if (isClash(e)) return { ok: false, reason: "used" }; // a second tab won the race
    throw e;
  }
}

const endGrant = (userId: string, now: Date, status: "expired" | "revoked") =>
  db.planGrant.updateMany({
    where: { userId, source: TRIAL_SOURCE, status: "active" },
    data: status === "revoked" ? { status, endsAt: now, revokedAt: now, revokedBy: "system", revokeReason: "Trial canceled" } : { status, endsAt: now },
  });

/** Ends the trial now. It still counts as used: the trial is once per person. */
export async function cancelTrial(userId: string, now = new Date()) {
  const r = await db.trial.updateMany({ where: { userId, status: "active" }, data: { status: "canceled", canceledAt: now } });
  if (r.count) await endGrant(userId, now, "revoked");
  return { ok: r.count === 1 };
}

/** Called by lifecycle when the first payment lands during the trial: the paid plan takes over from the grant. */
export async function convertTrial(userId: string, now = new Date()) {
  const r = await db.trial.updateMany({ where: { userId, status: "active" }, data: { status: "converted", convertedAt: now } });
  if (r.count) await endGrant(userId, now, "expired");
  return r.count === 1;
}

/**
 * Cron: ends trials whose time is up and sends the reminders (2 days before, and on the last day). Each step
 * is claimed with a conditional update first, so two sweeps running together never send twice.
 */
export async function sweepTrials(now = new Date()) {
  let expired = 0;
  let reminded = 0;
  const due = await db.trial.findMany({ where: { status: "active", endsAt: { lte: now } }, take: 200 });
  for (const t of due) {
    const r = await db.trial.updateMany({ where: { id: t.id, status: "active" }, data: { status: "expired", expiredAt: now } });
    if (r.count !== 1) continue;
    expired++;
    await endGrant(t.userId, now, "expired");
    await notify(
      t.userId,
      { kind: "plan_update", tone: "info", title: "Your trial has ended", body: "Your account is back on the Free plan. Your posts, drafts and connected accounts are all still here. Choose a plan in Billing to keep the Creator features.", href: "/billing", action: "Choose a plan", key: `trial:${t.id}:end` },
      { email: true, now },
    ).catch((e) => console.error("[trial] end notice", e));
  }
  const soon = await db.trial.findMany({ where: { status: "active", endsAt: { gt: now, lte: new Date(now.getTime() + 2 * DAY) }, OR: [{ remindedAt: null }, { remindedAt: "2d" }] }, take: 200 });
  for (const t of soon) {
    const lastDay = t.endsAt.getTime() - now.getTime() <= DAY;
    const step = lastDay ? "0d" : "2d";
    if (t.remindedAt === step || (!lastDay && t.remindedAt)) continue;
    const r = await db.trial.updateMany({ where: { id: t.id, status: "active", remindedAt: t.remindedAt }, data: { remindedAt: step } });
    if (r.count !== 1) continue;
    reminded++;
    const when = format(t.endsAt, "d MMM");
    await notify(
      t.userId,
      lastDay
        ? { kind: "plan_update", tone: "warn", title: "Your trial ends today", body: `Your Creator trial ends on ${when}. Subscribe in Billing to keep the Creator features; otherwise the account moves to the Free plan and nothing is lost.`, href: "/billing", action: "See plans", key: `trial:${t.id}:0d` }
        : { kind: "plan_update", tone: "info", title: "2 days left in your trial", body: `Your Creator trial ends on ${when}. Pick a plan before then to keep the Creator features. No charge happens unless you subscribe.`, href: "/billing", action: "See plans", key: `trial:${t.id}:2d` },
      { email: true, now },
    ).catch((e) => console.error("[trial] reminder", e));
  }
  return { expired, reminded };
}

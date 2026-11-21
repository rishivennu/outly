import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { env } from "../env";
import { sendEmail, templates } from "../email";
import { accessByEmail, changeGrant, createGrant, extendGrant, revokeGrant } from "../billing/access";
import { ensurePlans } from "../billing/plans";
import type { PartnerActor } from "./admin";
import { sendPartnerStatusEmail, type PartnerEmailApp } from "./email";
import { durationLabel, fmtDay } from "./offer-core";
import { partnerNotice } from "./notices";

/**
 * Benefit automation (R1282). Only an ACCEPTED offer can grant anything: approving an application never does.
 * A grant stacks under the existing access system (lib/billing/access.ts), so it never touches a subscription or a
 * payment; a creator who already pays for the same plan or a higher one gets nothing extra (the paid plan wins).
 */

const event = (applicationId: string, actor: string, action: string, meta: Record<string, unknown> = {}) =>
  db.partnerEvent.create({ data: { applicationId, actor: actor.slice(0, 120), action, meta: JSON.stringify(meta).slice(0, 4000) } });

async function offerWithApp(offerId: string) {
  const o = await db.partnerOffer.findUnique({ where: { id: offerId.slice(0, 40) }, include: { application: true } });
  if (!o) throw new HttpError(404, "That offer no longer exists.", "NOT_FOUND");
  return o;
}

async function planRank(slugs: string[]) {
  await ensurePlans();
  const rows = await db.plan.findMany({ where: { slug: { in: slugs } }, select: { slug: true, sortOrder: true, name: true } });
  return new Map(rows.map((r) => [r.slug, r]));
}

/** Creator email for benefit moments. A mail outage never undoes the benefit change. */
async function mailCreator(app: PartnerEmailApp, kind: "benefit_activated" | "benefit_ending", extra: { plan: string; startsAt?: Date | null; endsAt?: Date | null; reason?: string }) {
  try {
    if (kind === "benefit_activated") {
      // Deduped on lastNotified by the shared sender (lib/partners/email.ts).
      await sendPartnerStatusEmail(app, "benefit_activated", { plan: extra.plan, startsAt: extra.startsAt ?? null, endsAt: extra.endsAt ?? null });
      return;
    }
    const first = app.fullName.trim().split(/\s+/)[0] || "there";
    const subject = `Your partnership plan ends today (${app.ref})`;
    const body = [
      `Hi ${first},`,
      `Your complimentary ${extra.plan} plan from the Outlly partnership ends today.`,
      ...(extra.reason ? [`Reason: ${extra.reason}`] : []),
      "Your account and everything in it stay as they are. Any plan you pay for yourself keeps running. Reply to this email if you have a question.",
      `Application ID: ${app.ref}`,
    ].join("\n\n");
    const url = `${env.APP_URL.replace(/\/$/, "")}/login`;
    const r = await sendEmail({ to: app.email, subject, html: templates.growth({ subject, body, url, cta: "Open Outlly" }), text: `${body}\n\nOpen Outlly: ${url}\n\nTeam Outlly`, kind: "partner" });
    if (r.ok) await event(app.id, "system", "email.sent", { kind });
  } catch (e) {
    console.error("[partners] benefit email", e);
  }
}

export type GrantResult =
  | { granted: true; grantId: string; plan: string; startsAt: Date; endsAt: Date; status: string }
  | { skipped: "none" | "exists" | "paid"; grantId?: string; reason?: string };

/**
 * Grants the offer's complimentary plan. `force` is the admin's manual "Grant now" after a paid-plan skip; it still
 * requires an accepted offer.
 */
export async function grantBenefit(offerId: string, actor: PartnerActor, opts: { force?: boolean; now?: Date } = {}): Promise<GrantResult> {
  const now = opts.now ?? new Date();
  const o = await offerWithApp(offerId);
  if (o.status !== "accepted") throw new HttpError(409, "Only an accepted offer can grant a benefit.", "NOT_ACCEPTED");
  if (!o.planSlug || o.subscriptionDays <= 0) return { skipped: "none" };
  if (o.grantId) return { skipped: "exists", grantId: o.grantId };
  const app = o.application;

  if (!opts.force) {
    const access = await accessByEmail(app.email, now);
    const live = access.subscriptions.filter((s) => s.paid && s.status === "active" && new Date(s.endsAt) > now);
    if (live.length) {
      const ranks = await planRank([o.planSlug, ...live.map((s) => s.plan)]);
      const offered = ranks.get(o.planSlug)?.sortOrder ?? 0;
      const covering = live.find((s) => (ranks.get(s.plan)?.sortOrder ?? -1) >= offered);
      if (covering) {
        const reason = `Already pays for ${covering.planName}, the same or a higher plan.`;
        await event(app.id, actor.login, "benefit.skipped", { offerId: o.id, reason: "paid", paidPlan: covering.plan, offeredPlan: o.planSlug });
        return { skipped: "paid", reason };
      }
    }
  }

  const startsAt = o.startsAt && o.startsAt > now ? o.startsAt.toISOString() : null;
  const g = await createGrant(
    { email: app.email, plan: o.planSlug, days: o.subscriptionDays, startsAt, note: `Partnership offer ${o.id} (application ${app.ref})` },
    { login: actor.login, role: actor.role ?? null },
    now,
  );
  const linked = await db.partnerOffer.updateMany({ where: { id: o.id, grantId: null }, data: { grantId: g.id } });
  if (!linked.count) {
    // A racing call linked its own grant first: give this one back so the creator holds exactly one.
    await revokeGrant(g.id, "Duplicate partnership grant", { login: actor.login, role: actor.role ?? null }, now);
    const again = await db.partnerOffer.findUniqueOrThrow({ where: { id: o.id }, select: { grantId: true } });
    return { skipped: "exists", grantId: again.grantId ?? undefined };
  }
  await event(app.id, actor.login, "benefit.grant", { offerId: o.id, grantId: g.id, plan: g.plan.slug, status: g.status, startsAt: g.startsAt.toISOString(), endsAt: g.endsAt.toISOString(), manual: !!opts.force });
  await mailCreator(app, "benefit_activated", { plan: g.plan.name, startsAt: g.startsAt, endsAt: g.status === "pending" ? null : g.endsAt });
  await partnerNotice(app, "benefit", { stamp: g.id, plan: g.plan.name, endsAt: g.endsAt, pending: g.status === "pending" });
  return { granted: true, grantId: g.id, plan: g.plan.slug, startsAt: g.startsAt, endsAt: g.endsAt, status: g.status };
}

async function grantOf(offerId: string) {
  const o = await offerWithApp(offerId);
  if (!o.grantId) throw new HttpError(409, "This offer has no benefit granted yet.", "NO_GRANT");
  return o as typeof o & { grantId: string };
}

export async function extendBenefit(offerId: string, days: number, actor: PartnerActor, now = new Date()) {
  const o = await grantOf(offerId);
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n < 1 || n > 366) throw new HttpError(400, "Extend by 1 to 366 days.", "VALIDATION");
  const g = await extendGrant(o.grantId, { days: n, note: `Partnership offer ${o.id}: +${durationLabel(n)}` }, { login: actor.login, role: actor.role ?? null }, now);
  await event(o.applicationId, actor.login, "benefit.extend", { offerId: o.id, grantId: g.id, days: n, endsAt: g.endsAt.toISOString() });
  return g;
}

export async function changeBenefit(offerId: string, planSlug: string, actor: PartnerActor, now = new Date()) {
  const o = await grantOf(offerId);
  if (!/^[a-z0-9-]{2,40}$/.test(planSlug)) throw new HttpError(400, "Pick a plan from the list.", "VALIDATION");
  const g = await changeGrant(o.grantId, { plan: planSlug, note: `Partnership offer ${o.id}` }, { login: actor.login, role: actor.role ?? null }, now);
  await event(o.applicationId, actor.login, "benefit.change", { offerId: o.id, grantId: g.id, plan: g.plan.slug });
  return g;
}

/** Ends the complimentary plan. The creator is emailed first, then the grant is revoked; a paid plan keeps running. */
export async function endBenefit(offerId: string, reason: string, actor: PartnerActor, now = new Date()) {
  const o = await grantOf(offerId);
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) throw new HttpError(400, "Say why, for the creator and the audit trail.", "VALIDATION");
  const current = await db.planGrant.findUnique({ where: { id: o.grantId }, include: { plan: { select: { name: true } } } });
  if (!current || current.status === "revoked") throw new HttpError(409, "This benefit has already ended.", "ENDED");
  await mailCreator(o.application, "benefit_ending", { plan: current.plan.name, reason: why });
  const g = await revokeGrant(o.grantId, why, { login: actor.login, role: actor.role ?? null }, now);
  await event(o.applicationId, actor.login, "benefit.end", { offerId: o.id, grantId: g.id, reason: why });
  return g;
}

/** For the admin Benefit card: the grant's live state in words, with dates. */
export function benefitSummary(g: { status: string; startsAt: Date; endsAt: Date } | null) {
  if (!g) return "Not granted";
  if (g.status === "pending") return "Waiting for the creator to verify their email";
  if (g.status === "revoked") return "Ended";
  return `${fmtDay(g.startsAt)} to ${fmtDay(g.endsAt)}`;
}

import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { adminEvent } from "../admin/route";
import { changeStatus, type PartnerActor } from "./admin";
import { grantBenefit } from "./benefits";
import { ensurePartnerCode } from "./attribution";
import { partnerNotice } from "./notices";
import { OFFER_CURRENCIES, offerTermsOf, type OfferTerms } from "./offer-core";
import { PARTNER_OFFER_TYPES, PARTNER_PLATFORMS, PARTNER_TERMS_VERSION } from "./types";

export const OFFER_LINK_DAYS = 14;
const DAY_MS = 86_400_000;
const SYSTEM: PartnerActor = { login: "system", role: null };
const CREATOR: PartnerActor = { login: "creator", role: null };

const base = () => env.APP_URL.replace(/\/$/, "");
export const offerUrl = (token: string) => `${base()}/partners/offer/${token}`;
export const portalUrl = (token: string) => `${base()}/partners/portal/${token}`;

/** 24 random bytes = 32 url-safe characters. Unguessable, and only ever sent to the creator's inbox. */
export const newOfferToken = () => randomBytes(24).toString("base64url");
export const isOfferToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{32}$/.test(t);

const dateish = z
  .string()
  .trim()
  .max(40)
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Enter the date as YYYY-MM-DD." });
      return z.NEVER;
    }
    return d;
  });

export const OfferInput = z.object({
  type: z.enum(PARTNER_OFFER_TYPES),
  amountMinor: z.number().int().min(0).max(1_000_000_000).default(0),
  currency: z.enum(OFFER_CURRENCIES).default("INR"),
  paymentTerms: z.string().trim().max(500).default(""),
  planSlug: z.string().trim().regex(/^[a-z0-9-]{0,40}$/, "Pick a plan from the list.").default(""),
  subscriptionDays: z.number().int().min(0).max(366).default(0),
  startsAt: dateish,
  endsAt: dateish,
  deliverables: z.number().int().min(0).max(100).default(0),
  platforms: z.array(z.enum(PARTNER_PLATFORMS)).max(PARTNER_PLATFORMS.length).default([]),
  format: z.string().trim().max(120).default(""),
  deadlines: z.string().trim().max(500).default(""),
  disclosure: z.boolean().default(true),
  usageRights: z.string().trim().max(1000).default(""),
  conditions: z.string().trim().max(2000).default(""),
});
export type OfferInputT = z.input<typeof OfferInput>;

/** Keeps only the fields the offer type uses, and checks the ones it needs. */
function shape(raw: unknown) {
  const d = OfferInput.parse(raw);
  const paid = d.type === "paid" || d.type === "custom";
  const sub = d.type === "subscription" || d.type === "custom";
  const out = {
    ...d,
    amountMinor: paid ? d.amountMinor : 0,
    paymentTerms: paid ? d.paymentTerms : "",
    planSlug: sub ? d.planSlug : "",
    subscriptionDays: sub && d.planSlug ? d.subscriptionDays : 0,
    platforms: JSON.stringify([...new Set(d.platforms)]),
  };
  if (d.type === "paid" && out.amountMinor <= 0) throw new HttpError(400, "Enter the amount for a paid collaboration.", "VALIDATION");
  if (d.type === "subscription" && (!out.planSlug || out.subscriptionDays <= 0)) throw new HttpError(400, "Pick the plan and how many days it lasts.", "VALIDATION");
  if (out.startsAt && out.endsAt && out.endsAt <= out.startsAt) throw new HttpError(400, "The end or review date must be after the start date.", "VALIDATION");
  return out;
}

const DRAFTABLE = ["submitted", "under_review", "more_info", "approved", "offer_sent", "offer_accepted", "active"];

async function appOr404(id: string) {
  const app = await db.partnerApplication.findUnique({ where: { id: id.slice(0, 40) } });
  if (!app) throw new HttpError(404, "That application no longer exists.", "NOT_FOUND");
  return app;
}

async function offerOr404(applicationId: string, offerId: string) {
  const o = await db.partnerOffer.findUnique({ where: { id: offerId.slice(0, 40) } });
  if (!o || o.applicationId !== applicationId) throw new HttpError(404, "That offer no longer exists.", "NOT_FOUND");
  return o;
}

const event = (applicationId: string, actor: string, action: string, meta: Record<string, unknown> = {}) =>
  db.partnerEvent.create({ data: { applicationId, actor: actor.slice(0, 120), action, meta: JSON.stringify(meta).slice(0, 4000) } });

export async function createOffer(applicationId: string, input: unknown, admin: PartnerActor) {
  const app = await appOr404(applicationId);
  if (!DRAFTABLE.includes(app.status)) throw new HttpError(409, "This application is closed. Reopen it before writing an offer.", "CLOSED");
  const data = shape(input);
  const offer = await db.partnerOffer.create({ data: { ...data, applicationId: app.id, status: "draft", token: newOfferToken(), createdBy: admin.login.slice(0, 120) } });
  await event(app.id, admin.login, "offer.create", { offerId: offer.id, type: offer.type });
  return offer;
}

export async function updateOffer(applicationId: string, offerId: string, input: unknown, admin: PartnerActor) {
  const o = await offerOr404(applicationId, offerId);
  if (o.status !== "draft") throw new HttpError(409, "Only a draft can be edited. Withdraw this offer and write a new one.", "NOT_DRAFT");
  const data = shape(input);
  const offer = await db.partnerOffer.update({ where: { id: o.id }, data });
  await event(applicationId, admin.login, "offer.update", { offerId: o.id });
  return offer;
}

/** Sends a draft: a fresh link that works for 14 days, and the application moves to Offer Sent (which emails the creator). */
export async function sendOffer(applicationId: string, offerId: string, admin: PartnerActor, now = new Date()) {
  const o = await offerOr404(applicationId, offerId);
  if (o.status !== "draft") throw new HttpError(409, "This offer was already sent.", "NOT_DRAFT");
  const app = await appOr404(applicationId);
  if (app.status !== "approved") throw new HttpError(409, app.status === "offer_sent" ? "Another offer is out. Withdraw it first." : "Approve the application before sending an offer.", "NOT_APPROVED");
  shape({ ...o, platforms: JSON.parse(o.platforms || "[]"), startsAt: o.startsAt?.toISOString() ?? null, endsAt: o.endsAt?.toISOString() ?? null });
  const token = newOfferToken();
  const expiresAt = new Date(now.getTime() + OFFER_LINK_DAYS * DAY_MS);
  const r = await db.partnerOffer.updateMany({ where: { id: o.id, status: "draft" }, data: { status: "sent", token, sentAt: now, expiresAt } });
  if (!r.count) throw new HttpError(409, "This offer was already sent.", "NOT_DRAFT");
  await event(app.id, admin.login, "offer.send", { offerId: o.id, expiresAt: expiresAt.toISOString() });
  try {
    await changeStatus(app.id, "offer_sent", admin, { offerId: o.id, link: offerUrl(token) });
  } catch (e) {
    await db.partnerOffer.update({ where: { id: o.id }, data: { status: "draft", sentAt: null, expiresAt: null } });
    throw e;
  }
  return db.partnerOffer.findUniqueOrThrow({ where: { id: o.id } });
}

/** Takes a draft or a sent offer back. A sent one puts the application back to Approved without emailing. */
export async function withdrawOffer(applicationId: string, offerId: string, admin: PartnerActor) {
  const o = await offerOr404(applicationId, offerId);
  if (o.status !== "draft" && o.status !== "sent") throw new HttpError(409, "Only a draft or an unanswered offer can be withdrawn.", "NOT_OPEN");
  const r = await db.partnerOffer.updateMany({ where: { id: o.id, status: o.status }, data: { status: "withdrawn" } });
  if (!r.count) throw new HttpError(409, "The creator answered this offer a moment ago. Refresh to see it.", "CONFLICT");
  await event(applicationId, admin.login, "offer.withdraw", { offerId: o.id });
  if (o.status === "sent") {
    const app = await appOr404(applicationId);
    if (app.status === "offer_sent") await changeStatus(app.id, "approved", admin, { offerId: o.id, notify: false });
  }
  return db.partnerOffer.findUniqueOrThrow({ where: { id: o.id } });
}

/** A sent offer whose link ran out: marked expired, and the application goes back to Approved so a new one can go out. */
async function expireIfStale(o: { id: string; applicationId: string; status: string; expiresAt: Date | null }, now: Date) {
  if (o.status !== "sent" || !o.expiresAt || o.expiresAt > now) return false;
  const r = await db.partnerOffer.updateMany({ where: { id: o.id, status: "sent" }, data: { status: "expired" } });
  if (!r.count) return false;
  await event(o.applicationId, "system", "offer.expire", { offerId: o.id });
  const app = await db.partnerApplication.findUnique({ where: { id: o.applicationId }, select: { status: true } });
  if (app?.status === "offer_sent") await changeStatus(o.applicationId, "approved", SYSTEM, { actor: "system", offerId: o.id, notify: false }).catch(() => {});
  return true;
}

export async function listOffers(applicationId: string, now = new Date()) {
  const rows = await db.partnerOffer.findMany({ where: { applicationId }, orderBy: { createdAt: "desc" }, include: { grant: { include: { plan: { select: { slug: true, name: true } } } } } });
  let changed = false;
  for (const o of rows) changed = (await expireIfStale(o, now)) || changed;
  const fresh = changed ? await db.partnerOffer.findMany({ where: { applicationId }, orderBy: { createdAt: "desc" }, include: { grant: { include: { plan: { select: { slug: true, name: true } } } } } }) : rows;
  const events = await db.partnerEvent.findMany({ where: { applicationId, action: { startsWith: "benefit." } }, orderBy: { createdAt: "desc" }, take: 50 });
  return fresh.map((o) => {
    const last = events.find((e) => e.meta.includes(o.id));
    return {
      ...o,
      platforms: JSON.parse(o.platforms || "[]") as string[],
      accepted: o.accepted ? (JSON.parse(o.accepted) as OfferTerms) : null,
      benefit: last ? { action: last.action, at: last.createdAt, meta: JSON.parse(last.meta) as Record<string, unknown> } : null,
      grant: o.grant ? { id: o.grant.id, status: o.grant.status, plan: o.grant.plan.slug, planName: o.grant.plan.name, startsAt: o.grant.startsAt, endsAt: o.grant.endsAt } : null,
    };
  });
}

// ------------------------------------------------------------------ creator side

async function planName(slug: string) {
  if (!slug) return "";
  return (await db.plan.findUnique({ where: { slug }, select: { name: true } }))?.name ?? slug;
}

/** What the creator may see: the terms, the state and their own first name. No admin logins, notes or anyone else's data. */
export type PublicOffer = {
  state: "open" | "accepted" | "declined" | "expired" | "withdrawn";
  terms: OfferTerms;
  firstName: string;
  ref: string;
  expiresAt: string | null;
  respondedAt: string | null;
  portal: string | null;
};

async function project(o: NonNullable<Awaited<ReturnType<typeof findByToken>>>): Promise<PublicOffer> {
  const snapshot = o.accepted ? (JSON.parse(o.accepted) as OfferTerms) : null;
  const terms = snapshot ?? offerTermsOf({ ...o, platforms: JSON.parse(o.platforms || "[]") }, await planName(o.planSlug));
  const state = o.status === "sent" ? "open" : (o.status as PublicOffer["state"]);
  return {
    state,
    terms,
    firstName: o.application.fullName.trim().split(/\s+/)[0]?.slice(0, 40) ?? "",
    ref: o.application.ref,
    expiresAt: o.expiresAt?.toISOString() ?? null,
    respondedAt: o.respondedAt?.toISOString() ?? null,
    portal: o.status === "accepted" ? portalUrl(o.token) : null,
  };
}

function findByToken(token: string) {
  return db.partnerOffer.findUnique({ where: { token }, include: { application: { select: { id: true, ref: true, fullName: true, status: true, email: true, userId: true } } } });
}

/** A draft was never sent, so its token means nothing yet: the same "not found" as a made-up one. */
async function openToken(token: string, now: Date) {
  if (!isOfferToken(token)) return null;
  const o = await findByToken(token);
  if (!o || o.status === "draft") return null;
  if (await expireIfStale(o, now)) return findByToken(token);
  return o;
}

export async function getOfferByToken(token: string, now = new Date()) {
  const o = await openToken(token, now);
  return o ? project(o) : null;
}

/**
 * The creator's answer. Accept: the terms are snapshotted, the application moves to Offer Accepted, the benefit (if
 * the offer carries one) is granted, then the partnership is Active. Decline: the application goes back to Approved
 * so a new offer can go out, and the team is told.
 */
export async function respondToOffer(token: string, decision: "accept" | "decline", opts: { declineReason?: string } = {}, now = new Date()) {
  const o = await openToken(token, now);
  if (!o) throw new HttpError(404, "This offer link isn't valid. Check the link in your email.", "NOT_FOUND");
  if (o.status === "expired") throw new HttpError(410, "This offer has expired. Reply to the email and we can send a new one.", "EXPIRED");
  if (o.status !== "sent") throw new HttpError(409, "This offer was already answered.", "ANSWERED");
  if (o.application.status !== "offer_sent") throw new HttpError(409, "This offer is no longer open. Reply to the email and we can help.", "NOT_OPEN");
  const appId = o.application.id;

  if (decision === "decline") {
    const reason = (opts.declineReason ?? "").trim().slice(0, 1000);
    const r = await db.partnerOffer.updateMany({ where: { id: o.id, status: "sent" }, data: { status: "declined", decision: "declined", declineReason: reason, respondedAt: now } });
    if (!r.count) throw new HttpError(409, "This offer was already answered.", "ANSWERED");
    await event(appId, "creator", "offer.decline", { offerId: o.id, ...(reason ? { reason } : {}) });
    await changeStatus(appId, "approved", CREATOR, { actor: "creator", offerId: o.id, notify: false });
    await adminEvent("partner", `${o.application.fullName} declined the offer`, reason || "No reason given", `/admin/partners/${appId}`);
    await partnerNotice(o.application, "offer_declined", { stamp: o.id });
    return { state: "declined" as const };
  }

  const terms: OfferTerms = { ...offerTermsOf({ ...o, platforms: JSON.parse(o.platforms || "[]") }, await planName(o.planSlug)), termsVersion: PARTNER_TERMS_VERSION, acceptedAt: now.toISOString() };
  const r = await db.partnerOffer.updateMany({ where: { id: o.id, status: "sent" }, data: { status: "accepted", decision: "accepted", respondedAt: now, accepted: JSON.stringify(terms) } });
  if (!r.count) throw new HttpError(409, "This offer was already answered.", "ANSWERED");
  await event(appId, "creator", "offer.accept", { offerId: o.id, termsVersion: PARTNER_TERMS_VERSION });
  await changeStatus(appId, "offer_accepted", CREATOR, { actor: "creator", offerId: o.id, link: portalUrl(o.token) });
  await ensurePartnerCode(appId).catch((e) => console.error("[partners] code", e));

  let benefit: Awaited<ReturnType<typeof grantBenefit>> | { error: string };
  try {
    benefit = await grantBenefit(o.id, SYSTEM, { now });
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : "The benefit couldn't be granted.";
    await event(appId, "system", "benefit.error", { offerId: o.id, error: msg.slice(0, 300) });
    await adminEvent("partner", `${o.application.fullName} accepted, benefit needs a hand`, msg, `/admin/partners/${appId}`);
    benefit = { error: msg };
  }
  // A grant that failed leaves the partnership at Offer Accepted, so an admin sees it and grants it by hand.
  if (!("error" in benefit)) await changeStatus(appId, "active", SYSTEM, { actor: "system", offerId: o.id, notify: false });
  await adminEvent("partner", `${o.application.fullName} accepted the offer`, terms.amount ? `${terms.typeLabel}, ${terms.amount}` : terms.typeLabel, `/admin/partners/${appId}`);
  return { state: "accepted" as const, portal: portalUrl(o.token) };
}

/** Portal access: the offer link works as the portal link once the offer is accepted, and only then. */
export async function acceptedOfferByToken(token: string) {
  if (!isOfferToken(token)) return null;
  const o = await findByToken(token);
  return o && o.status === "accepted" ? o : null;
}

import "server-only";
import { z } from "zod";
import type { PartnerApplication } from "@prisma/client";
import { db } from "../db";
import { HttpError } from "../http";
import { adminEvent } from "../admin/route";
import { realUserId, type SessionUser } from "../auth";
import { isProven } from "../founding";
import { changeStatus, parseJson, type PartnerActor } from "./admin";
import { listOffers, respondToOffer } from "./offers";
import { listDeliverables, submitDeliverable } from "./deliverables";
import { resolveFiles, withdrawApplication } from "./core-server";
import { FILE_TOKEN_RE, HANDLE_RULES, emailKeyOf, normaliseHandle, normaliseProfileUrl, stripHtml, summarise } from "./core";
import { durationLabel, offerTermsOf, type OfferTerms } from "./offer-core";
import { partnerNotice } from "./notices";
import { sendPartnerStatusEmail } from "./email";
import {
  PARTNER_FILE_MAX_COUNT,
  PARTNER_PLATFORMS,
  PARTNER_PLATFORM_LABEL,
  PARTNER_STATUS_LABEL,
  type PartnerProposal,
  type PartnerSocial,
  type PartnerStats,
  type PartnerStatus,
} from "./types";
import type { MineApplication, MineBenefit, MineDeliverable, MineEvent, MineInfoRequest, MineOffer, MineSocial, MineSummary } from "./mine-types";

/**
 * R1289 "My Partnerships": the signed-in creator's own applications. Every function checks ownership here, on the
 * server: an application is mine when it carries my account id, or when it carries no account yet and its email folds
 * to my PROVEN email (then it is linked to me once). Admin notes, admin logins, roles, attribution and event details
 * other than the creator-facing message never leave this file.
 */

const DAY = 86_400_000;
const CREATOR: PartnerActor = { login: "creator", role: null };
export type MineUser = Pick<SessionUser, "id" | "actor">;

/** Event actions the creator may see in their own history. */
export const MINE_EVENT_ACTIONS = ["status", "info.requested", "info.provided", "offer.send", "offer.accept", "offer.decline", "benefit.grant", "benefit.end", "deliverable.submit", "deliverable.review"] as const;
const isStatusAction = (a: string) => a === "status" || a === "status.change";

type Me = { id: string; email: string; verified: boolean };

async function whoAmI(user: MineUser): Promise<Me> {
  const id = realUserId(user);
  const u = await db.user.findUnique({ where: { id }, select: { email: true, emailVerifiedAt: true, emailVerifiedFor: true } });
  return { id, email: u?.email ?? "", verified: !!u && isProven(u) };
}

const ownedWhere = (me: Me) => ({ OR: [{ userId: me.id }, ...(me.verified && me.email ? [{ userId: null, emailKey: emailKeyOf(me.email) }] : [])] });

/** Links email-matched applications to the account once, so later checks are a plain id match. */
async function claim<T extends { id: string; userId: string | null }>(me: Me, apps: T[]) {
  const loose = apps.filter((a) => !a.userId).map((a) => a.id);
  if (loose.length) await db.partnerApplication.updateMany({ where: { id: { in: loose }, userId: null }, data: { userId: me.id } });
  return apps.map((a) => (a.userId ? a : { ...a, userId: me.id }));
}

const cleanRef = (ref: string) => String(ref ?? "").trim().toUpperCase().slice(0, 20);

async function owned(user: MineUser, ref: string) {
  const me = await whoAmI(user);
  const found = await db.partnerApplication.findFirst({ where: { ref: cleanRef(ref), ...ownedWhere(me) } });
  if (!found) return null;
  return (await claim(me, [found]))[0];
}

async function ownedOr404(user: MineUser, ref: string) {
  const app = await owned(user, ref);
  if (!app) throw new HttpError(404, "We couldn't find that application on your account.", "NOT_FOUND");
  return app;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const msg = (meta: Record<string, unknown>) => (typeof meta.message === "string" ? meta.message.slice(0, 2000) : "");

type EventRow = { action: string; from: string | null; to: string | null; meta: string; createdAt: Date };

export function mineEvents(rows: EventRow[]): MineEvent[] {
  return rows
    .filter((e) => isStatusAction(e.action) || (MINE_EVENT_ACTIONS as readonly string[]).includes(e.action))
    .map((e) => {
      const status = isStatusAction(e.action);
      return { at: e.createdAt.toISOString(), action: status ? "status" : e.action, from: status ? e.from : null, to: status ? e.to : null, message: msg(parseJson<Record<string, unknown>>(e.meta, {})) };
    });
}

/** The latest "more information" ask and whether the creator has answered it since. */
export function infoRequestOf(events: MineEvent[]): MineInfoRequest {
  const ask = [...events].reverse().find((e) => (e.action === "status" && e.to === "more_info") || e.action === "info.requested");
  if (!ask) return null;
  const reply = events.find((e) => e.action === "info.provided" && e.at >= ask.at && e !== ask);
  return { requestedAt: ask.at, message: ask.message, respondedAt: reply?.at ?? null };
}

export function nextActionOf(status: string, offer: MineOffer | null, deliverables: MineDeliverable[]): MineApplication["nextAction"] {
  if (status === "more_info") return { kind: "respond_info", label: "Update your application" };
  if (status === "offer_sent" && offer?.status === "sent") return { kind: "review_offer", label: "Review your offer" };
  if (status === "active" && deliverables.some((d) => d.status === "planned")) return { kind: "submit_deliverables", label: "Submit a published link" };
  if (status === "submitted" || status === "under_review") return { kind: "withdraw", label: "Withdraw application" };
  return { kind: "none", label: "" };
}

type OfferRow = Awaited<ReturnType<typeof listOffers>>[number];

function mineOffer(o: OfferRow, version: number, planName: string): MineOffer {
  const t: OfferTerms = o.accepted ?? offerTermsOf(o, planName);
  return {
    id: o.id,
    status: o.status as MineOffer["status"],
    version,
    type: t.type as MineOffer["type"],
    typeLabel: t.typeLabel,
    amountMinor: t.amountMinor,
    currency: t.currency,
    amountLabel: t.amount,
    paymentTerms: t.paymentTerms,
    planSlug: t.planSlug,
    planName: t.planName,
    subscriptionDays: t.subscriptionDays,
    durationLabel: t.subscriptionDays > 0 ? durationLabel(t.subscriptionDays) : "",
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    deliverables: t.deliverables,
    platforms: t.platforms,
    format: t.format,
    deadlines: t.deadlines,
    disclosure: t.disclosure,
    usageRights: t.usageRights,
    conditions: t.conditions,
    expiresAt: iso(o.expiresAt),
    sentAt: iso(o.sentAt),
    respondedAt: iso(o.respondedAt),
    decision: o.decision ?? "",
    declineReason: o.declineReason ?? "",
  };
}

function mineSocials(raw: string): MineSocial[] {
  const rows = parseJson<Partial<PartnerSocial>[]>(raw, []);
  return (Array.isArray(rows) ? rows : []).map((s) => ({
    platform: String(s.platform ?? ""),
    handle: String(s.handle ?? ""),
    url: String(s.url ?? ""),
    followers: Math.max(0, Math.floor(Number(s.followers) || 0)),
    primary: !!s.primary,
  }));
}

async function build(app: PartnerApplication, now: Date): Promise<MineApplication> {
  const [rows, offerRows, dels] = await Promise.all([
    db.partnerEvent.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "asc" }, select: { action: true, from: true, to: true, meta: true, createdAt: true } }),
    listOffers(app.id, now),
    listDeliverables(app.id),
  ]);
  // listOffers may have just expired a stale offer and moved the application back to Approved.
  const fresh = offerRows.some((o) => o.status === "expired") ? await db.partnerApplication.findUnique({ where: { id: app.id } }) : null;
  const a = fresh ?? app;
  const events = mineEvents(rows);
  const statusEvents = events.filter((e) => e.action === "status");
  const status = a.status as PartnerStatus;

  // Drafts and drafts taken back were never shown to the creator: they do not exist on this side.
  const visible = offerRows.filter((o) => o.status !== "draft" && o.sentAt).reverse();
  const slugs = [...new Set(visible.filter((o) => !o.accepted && o.planSlug).map((o) => o.planSlug))];
  const plans = slugs.length ? await db.plan.findMany({ where: { slug: { in: slugs } }, select: { slug: true, name: true } }) : [];
  const planName = (slug: string) => plans.find((p) => p.slug === slug)?.name ?? "";
  const offers = visible.map((o, i) => mineOffer(o, i + 1, planName(o.planSlug)));
  const offer = [...offers].reverse().find((o) => o.status === "sent") ?? [...offers].reverse().find((o) => o.status === "accepted") ?? null;

  const deliverables: MineDeliverable[] = dels.map((d) => ({
    id: d.id, title: d.title, platform: d.platform, format: d.format, dueAt: iso(d.dueAt), publishedAt: iso(d.publishedAt), url: d.url,
    status: d.status as MineDeliverable["status"], approval: d.approval, creatorNote: d.creatorNote,
  }));

  const accepted = [...visible].reverse().find((o) => o.status === "accepted" && o.grant);
  const benefit: MineBenefit = accepted?.grant
    ? {
        planName: accepted.grant.planName,
        status: accepted.grant.status,
        startsAt: accepted.grant.startsAt.toISOString(),
        endsAt: accepted.grant.endsAt.toISOString(),
        daysLeft: accepted.grant.status === "active" ? Math.max(0, Math.ceil((accepted.grant.endsAt.getTime() - now.getTime()) / DAY)) : 0,
      }
    : null;

  const closing = status === "rejected" || status === "withdrawn" ? [...statusEvents].reverse().find((e) => e.to === status) : undefined;
  const proposal = parseJson<Record<string, unknown>>(a.proposal, {});
  return {
    id: a.id,
    ref: a.ref,
    status,
    statusLabel: PARTNER_STATUS_LABEL[status] ?? a.status,
    form: proposal.form === "short" ? "short" : "long",
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    lastStatusAt: statusEvents.at(-1)?.at ?? a.createdAt.toISOString(),
    reviewedAt: iso(a.reviewedAt),
    decidedAt: iso(a.decidedAt),
    fullName: a.fullName,
    email: a.email,
    country: a.country,
    primaryPlatform: a.primaryPlatform,
    primaryHandle: a.primaryHandle,
    followers: a.followers,
    avgViews: a.avgViews,
    engagementRate: a.engagementRate,
    niche: a.niche,
    preference: a.preference,
    socials: mineSocials(a.socials),
    stats: parseJson<Record<string, unknown>>(a.stats, {}),
    proposal,
    decisionMessage: closing?.message ?? "",
    infoRequest: infoRequestOf(events),
    offer,
    offers,
    deliverables,
    benefit,
    partnerCode: status === "offer_accepted" || status === "active" || status === "completed" ? a.partnerCode : null,
    events,
    nextAction: nextActionOf(status, offer, deliverables),
  };
}

export function summaryOf(apps: Pick<MineApplication, "status" | "offers">[]): MineSummary {
  return {
    submitted: apps.length,
    underReview: apps.filter((a) => a.status === "submitted" || a.status === "under_review" || a.status === "more_info").length,
    offers: apps.reduce((n, a) => n + a.offers.length, 0),
    active: apps.filter((a) => a.status === "active").length,
  };
}

export async function listMine(user: MineUser, now = new Date()): Promise<{ apps: MineApplication[]; summary: MineSummary }> {
  const me = await whoAmI(user);
  const rows = await claim(me, await db.partnerApplication.findMany({ where: ownedWhere(me), orderBy: { createdAt: "desc" }, take: 50 }));
  const apps: MineApplication[] = [];
  for (const r of rows) apps.push(await build(r, now));
  return { apps, summary: summaryOf(apps) };
}

export async function getMine(user: MineUser, ref: string, now = new Date()): Promise<MineApplication | null> {
  const app = await owned(user, ref);
  return app ? build(app, now) : null;
}

// ------------------------------------------------------------------ more information

const count = z.number().int().min(0).max(10_000_000_000);

const InfoSocial = z
  .object({
    platform: z.enum(PARTNER_PLATFORMS, { error: "Choose a platform" }),
    handle: z.string().max(200).default(""),
    url: z.string().max(300).default(""),
    followers: count,
    primary: z.boolean().optional(),
  })
  .transform((s, ctx) => {
    const handle = normaliseHandle(s.platform, s.handle.trim() || (s.platform === "other" ? "" : s.url.trim()));
    if (!handle || !HANDLE_RULES[s.platform].re.test(handle)) ctx.addIssue({ code: "custom", path: ["handle"], message: handle ? HANDLE_RULES[s.platform].hint : "Enter your username" });
    const url = normaliseProfileUrl(s.platform, s.url.trim() || handle);
    if (!url) ctx.addIssue({ code: "custom", path: ["url"], message: s.platform === "other" ? "Enter a full https link to your profile" : `Enter a link to your ${PARTNER_PLATFORM_LABEL[s.platform]} profile` });
    return { ...s, handle, url: url ?? "" };
  });

export const InfoInput = z.object({
  message: z
    .string()
    .max(8000)
    .transform((s) => stripHtml(s).trim())
    .pipe(z.string().min(3, "Tell the team what you've updated, at least 3 characters").max(2000, "Keep it under 2000 characters")),
  socials: z.array(InfoSocial).min(1, "Add at least one account").max(6, "Add up to 6 accounts").optional(),
  stats: z
    .object({
      avgViews: count,
      avgLikes: count,
      avgComments: count,
      avgShares: count,
      reach: count,
      engagementRate: z.number().min(0).max(100, "Engagement rate is a percentage, 0 to 100").nullable(),
    })
    .partial()
    .optional(),
  files: z.array(z.object({ token: z.string().regex(FILE_TOKEN_RE, "That upload has expired. Add the file again."), name: z.string().max(200).default("") })).max(PARTNER_FILE_MAX_COUNT).default([]),
});
export type InfoInputT = z.input<typeof InfoInput>;

/** Provided accounts replace the list; niche and format carry over from the same platform, so nothing typed before is lost. */
export function mergeSocials(old: Partial<PartnerSocial>[], next: z.output<typeof InfoSocial>[]): PartnerSocial[] {
  const seen = new Set<string>();
  const rows = next.filter((s) => {
    const k = `${s.platform}:${s.handle.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const primary = Math.max(0, rows.findIndex((r) => r.primary));
  return rows.map((s, i) => {
    const before = old.find((o) => o.platform === s.platform);
    return { platform: s.platform, handle: s.handle, url: s.url, followers: s.followers, niche: (before?.niche ?? "other") as PartnerSocial["niche"], format: (before?.format ?? "other") as PartnerSocial["format"], primary: i === primary };
  });
}

async function answeredSinceAsk(appId: string) {
  const rows = await db.partnerEvent.findMany({ where: { applicationId: appId }, orderBy: { createdAt: "asc" }, select: { action: true, from: true, to: true, meta: true, createdAt: true } });
  const r = infoRequestOf(mineEvents(rows));
  return !!r?.respondedAt;
}

/** The creator answers a "more information" request: data merged, reply recorded, back to Under Review, team told. */
export async function respondInfo(user: MineUser, ref: string, input: unknown, now = new Date()) {
  const app = await ownedOr404(user, ref);
  const d = InfoInput.parse(input);
  if (app.status !== "more_info") {
    if (await answeredSinceAsk(app.id)) return { app: (await build(app, now))!, already: true };
    throw new HttpError(409, "There's no open request for more information on this application.", "NOT_REQUESTED");
  }

  const oldSocials = parseJson<Partial<PartnerSocial>[]>(app.socials, []);
  const oldStats = parseJson<Partial<PartnerStats>>(app.stats, {});
  const proposal = parseJson<Partial<PartnerProposal>>(app.proposal, {});
  const socials = d.socials ? mergeSocials(Array.isArray(oldSocials) ? oldSocials : [], d.socials) : null;
  const providedStats = d.stats ? Object.fromEntries(Object.entries(d.stats).filter(([, v]) => v !== undefined)) : {};
  const stats = Object.keys(providedStats).length ? { ...oldStats, ...providedStats } : null;

  const files = d.files.length ? await resolveFiles(d.files.map((f) => ({ token: f.token, name: f.name }))) : [];
  const taken = files.length ? await db.partnerFile.findMany({ where: { key: { in: files.map((f) => f.key) } }, select: { key: true } }) : [];
  const freshFiles = files.filter((f) => !taken.some((t) => t.key === f.key));
  if (freshFiles.length && (await db.partnerFile.count({ where: { applicationId: app.id } })) + freshFiles.length > PARTNER_FILE_MAX_COUNT)
    throw new HttpError(400, `An application can hold up to ${PARTNER_FILE_MAX_COUNT} files.`, "VALIDATION");

  const fields = [...(socials ? ["socials"] : []), ...(stats ? ["stats"] : []), ...(freshFiles.length ? ["files"] : [])];
  const sum =
    socials || stats
      ? summarise({
          socials: socials ?? (oldSocials as PartnerSocial[]),
          stats: (stats ?? oldStats) as PartnerStats,
          proposal: { preference: (proposal.preference ?? app.preference) as PartnerProposal["preference"] },
        })
      : null;

  let infoEventId = "";
  try {
    await changeStatus(app.id, "under_review", CREATOR, { actor: "creator", notify: false }, {
      inTx: async (tx) => {
        await tx.partnerApplication.update({
          where: { id: app.id },
          data: {
            ...(socials ? { socials: JSON.stringify(socials) } : {}),
            ...(stats ? { stats: JSON.stringify(stats) } : {}),
            ...(sum ? { primaryPlatform: sum.primaryPlatform, primaryHandle: sum.primaryHandle, followers: sum.followers, avgViews: sum.avgViews, engagementRate: sum.engagementRate, niche: sum.niche, tier: sum.tier } : {}),
            ...(freshFiles.length ? { files: { create: freshFiles } } : {}),
          },
        });
        const ev = await tx.partnerEvent.create({ data: { applicationId: app.id, actor: "creator", action: "info.provided", meta: JSON.stringify({ message: d.message, fields }).slice(0, 4000) } });
        infoEventId = ev.id;
      },
    });
  } catch (e) {
    // A double click: the first request already moved it. Answer with the state, not an error.
    if (e instanceof HttpError && e.code === "CONFLICT" && (await answeredSinceAsk(app.id))) return { app: (await getMine(user, app.ref, now))!, already: true };
    throw e;
  }
  await partnerNotice(app, "info_received", { stamp: infoEventId });
  await adminEvent("partner", `${app.fullName} sent more information`, d.message.slice(0, 200), `/admin/partners/${app.id}`).catch(() => {});
  return { app: (await getMine(user, app.ref, now))!, already: false };
}

// ------------------------------------------------------------------ offers, deliverables, withdrawal

/** Same code path as the emailed offer link (terms snapshot, benefit grant, status moves), behind the ownership check. */
export async function respondOffer(user: MineUser, ref: string, offerId: string, decision: "accept" | "decline", declineReason?: string, now = new Date()) {
  if (decision !== "accept" && decision !== "decline") throw new HttpError(400, "Choose accept or decline.", "VALIDATION");
  const app = await ownedOr404(user, ref);
  const offer = await db.partnerOffer.findUnique({ where: { id: String(offerId ?? "").slice(0, 40) } });
  if (!offer || offer.applicationId !== app.id || offer.status === "draft" || !offer.sentAt) throw new HttpError(404, "That offer isn't on this application.", "NOT_FOUND");
  const want = decision === "accept" ? "accepted" : "declined";
  if (offer.status === "sent") {
    try {
      await respondToOffer(offer.token, decision, { declineReason: (declineReason ?? "").slice(0, 1000) }, now);
    } catch (e) {
      if (!(e instanceof HttpError && e.code === "ANSWERED")) throw e;
    }
  }
  const after = await db.partnerOffer.findUniqueOrThrow({ where: { id: offer.id }, select: { status: true } });
  if (after.status !== want) {
    if (after.status === "expired") throw new HttpError(410, "This offer has expired. Our team can send a new one.", "EXPIRED");
    if (after.status === "withdrawn") throw new HttpError(409, "This offer was withdrawn by the team.", "NOT_OPEN");
    throw new HttpError(409, "This offer was already answered.", "ANSWERED");
  }
  return { state: want as "accepted" | "declined", app: (await getMine(user, app.ref, now))! };
}

export async function submitMyDeliverable(user: MineUser, ref: string, deliverableId: string, input: { url?: unknown; note?: unknown; publishedAt?: unknown } | null) {
  const app = await ownedOr404(user, ref);
  const d = await db.partnerDeliverable.findUnique({ where: { id: String(deliverableId ?? "").slice(0, 40) } });
  if (!d || d.applicationId !== app.id) throw new HttpError(404, "That deliverable isn't on this partnership.", "NOT_FOUND");
  const own = d.offerId ? await db.partnerOffer.findFirst({ where: { id: d.offerId, applicationId: app.id, status: "accepted" } }) : null;
  const offer = own ?? (await db.partnerOffer.findFirst({ where: { applicationId: app.id, status: "accepted" }, orderBy: { respondedAt: "desc" } }));
  if (!offer) throw new HttpError(409, "Your partnership isn't active yet, so there's nothing to submit.", "NOT_ACTIVE");
  const body = input ?? {};
  const row = await submitDeliverable(offer.token, { id: d.id, url: body.url, ...(body.note !== undefined ? { note: body.note } : {}), ...(body.publishedAt !== undefined ? { publishedAt: body.publishedAt } : {}) });
  const out: MineDeliverable = {
    id: row.id, title: row.title, platform: row.platform, format: row.format, dueAt: row.dueAt, publishedAt: row.publishedAt, url: row.url,
    status: row.status as MineDeliverable["status"], approval: row.approval, creatorNote: row.creatorNote,
  };
  return out;
}

export async function withdrawMine(user: MineUser, ref: string, now = new Date()) {
  const app = await ownedOr404(user, ref);
  if (app.status === "withdrawn") return { app: (await getMine(user, app.ref, now))!, already: true };
  const r = await withdrawApplication(app.ref, app.email);
  if (!r.ok) throw new HttpError(409, "This application is already closed, so there is nothing to withdraw.", "CLOSED");
  await sendPartnerStatusEmail(r.app, "withdrawn").catch(() => {});
  await adminEvent("partner", `${app.fullName} withdrew their application`, app.ref, `/admin/partners/${app.id}`).catch(() => {});
  return { app: (await getMine(user, app.ref, now))!, already: false };
}

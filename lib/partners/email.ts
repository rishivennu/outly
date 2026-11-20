import "server-only";
import { db } from "../db";
import { env } from "../env";
import { sendEmail, templates } from "../email";
import { adminEvent } from "../admin/route";
import { watchdogConfig } from "../health/config";
import { PARTNER_PLATFORM_LABEL, PARTNER_STATUSES, PARTNER_TIER_LABEL, type PartnerPlatform, type PartnerStatus, type PartnerTier } from "./types";

export const PARTNER_EMAIL_KINDS = [
  "received",
  "under_review",
  "more_info",
  "approved",
  "rejected",
  "offer_sent",
  "offer_accepted",
  "active",
  "benefit_activated",
  "deliverable_reminder",
  "completed",
  "withdrawn",
] as const;
export type PartnerEmailKind = (typeof PARTNER_EMAIL_KINDS)[number];

/** What an email may show about an application. Notes are never part of it, by design. */
export interface PartnerEmailApp {
  id: string;
  ref: string;
  fullName: string;
  email: string;
  lastNotified?: string | null;
}

export interface PartnerEmailExtra {
  /** The admin's message to the creator (more information, a rejection reason, a reminder). */
  message?: string;
  /** Offer or portal link. Relative paths are made absolute. */
  link?: string;
  plan?: string;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  title?: string;
  dueAt?: Date | string | null;
}

const base = () => env.APP_URL.replace(/\/$/, "");
const abs = (href: string) => (href.startsWith("/") ? base() + href : href);
const first = (name: string) => name.trim().split(/\s+/)[0] || "there";
const day = (d: Date | string | null | undefined) => {
  if (!d) return "";
  const x = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(x.getTime()) ? "" : x.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
};
const clip = (s: string | undefined, n = 2000) => (s ?? "").trim().slice(0, n);

type Draft = { subject: string; paras: string[]; cta: string; url: string };

function draft(kind: PartnerEmailKind, app: PartnerEmailApp, x: PartnerEmailExtra): Draft {
  const hi = `Hi ${first(app.fullName)},`;
  const id = `Application ID: ${app.ref}`;
  const home = abs("/partners");
  const msg = clip(x.message);
  switch (kind) {
    case "received":
      return {
        subject: `We received your partnership application (${app.ref})`,
        paras: [
          hi,
          "Thank you for applying to the Outlly Creator Partnership Program. Your application has been submitted successfully.",
          "Our team will review your creator profile and reach out if there's a potential partnership opportunity. You don't need to do anything else for now.",
          id,
        ],
        cta: "About the program",
        url: home,
      };
    case "under_review":
      return {
        subject: `Your application ${app.ref} is under review`,
        paras: [hi, "Our team has started reviewing your creator profile and the details you shared. We will email you when there is an update.", id],
        cta: "About the program",
        url: home,
      };
    case "more_info":
      return {
        subject: `We need a little more information (${app.ref})`,
        paras: [hi, "We are reviewing your application and need a few more details before we can continue.", ...(msg ? [msg] : []), "Reply to this email with the details and we will pick it up from there.", id],
        cta: "About the program",
        url: home,
      };
    case "approved":
      return {
        subject: `Your partnership application ${app.ref} is approved`,
        paras: [hi, "Good news: we would like to work with you. We will follow up by email with the details of a proposal for you to review.", ...(msg ? [msg] : []), id],
        cta: "About the program",
        url: home,
      };
    case "rejected":
      return {
        subject: `An update on your partnership application (${app.ref})`,
        paras: [
          hi,
          "Thank you for your interest in partnering with Outlly. After reviewing your application, we are not able to offer a partnership right now.",
          ...(msg ? [msg] : []),
          "You are welcome to apply again in the future as your channel grows.",
          id,
        ],
        cta: "Visit Outlly",
        url: base(),
      };
    case "offer_sent":
      return {
        subject: `You have a partnership offer from Outlly (${app.ref})`,
        paras: [hi, "We have prepared a partnership offer for you. Open it to see the deliverables, timelines and terms, then accept or decline.", ...(msg ? [msg] : []), id],
        cta: "Review the offer",
        url: x.link ? abs(x.link) : home,
      };
    case "offer_accepted":
      return {
        subject: `You accepted the Outlly partnership offer (${app.ref})`,
        paras: [hi, "Thank you for accepting the offer. We have saved a copy of the terms you agreed to and will be in touch about next steps.", id],
        cta: x.link ? "View your partnership" : "About the program",
        url: x.link ? abs(x.link) : home,
      };
    case "active":
      return {
        subject: `Your Outlly partnership is active (${app.ref})`,
        paras: [hi, "Your partnership with Outlly is now active. Thank you for growing with us.", ...(msg ? [msg] : []), id],
        cta: x.link ? "View your partnership" : "Open Outlly",
        url: x.link ? abs(x.link) : base(),
      };
    case "benefit_activated": {
      const from = day(x.startsAt);
      const until = day(x.endsAt);
      const span = from && until ? ` from ${from} to ${until}` : until ? ` until ${until}` : from ? ` from ${from}` : "";
      return {
        subject: `Your ${x.plan || "Outlly"} access is active`,
        paras: [hi, `Your ${x.plan || "Outlly"} access is now active${span}. Sign in with ${app.email} to use it.`, id],
        cta: "Open Outlly",
        url: abs("/login"),
      };
    }
    case "deliverable_reminder": {
      const due = day(x.dueAt);
      return {
        subject: `Reminder: ${x.title || "your next partnership post"}${due ? ` is due ${due}` : ""}`,
        paras: [hi, `A friendly reminder about ${x.title ? `"${x.title}"` : "your next partnership post"}${due ? `, due ${due}` : ""}.`, ...(msg ? [msg] : []), id],
        cta: x.link ? "Open your partnership" : "Open Outlly",
        url: x.link ? abs(x.link) : base(),
      };
    }
    case "completed":
      return {
        subject: `Your Outlly partnership is complete (${app.ref})`,
        paras: [hi, "All the agreed work for this partnership is done. Thank you for creating with Outlly. We hope to work together again.", id],
        cta: "Open Outlly",
        url: base(),
      };
    case "withdrawn":
      return {
        subject: `Your partnership application ${app.ref} was withdrawn`,
        paras: [hi, "Your application has been withdrawn, so our team will not review it further. If this was a mistake, reply to this email.", id],
        cta: "About the program",
        url: home,
      };
  }
}

/** Subject, house-layout HTML and the plain-text part for one partner email. */
export function partnerEmail(kind: PartnerEmailKind, app: PartnerEmailApp, extra: PartnerEmailExtra = {}) {
  const d = draft(kind, app, extra);
  const html = templates.growth({ subject: d.subject, body: d.paras.join("\n\n"), url: d.url, cta: d.cta });
  const text = `${d.paras.join("\n\n")}\n\n${d.cta}: ${d.url}\n\nTeam Outlly`;
  return { subject: d.subject, html, text };
}

const STATUS_KIND: Partial<Record<PartnerStatus, PartnerEmailKind>> = {
  submitted: "received",
  under_review: "under_review",
  more_info: "more_info",
  approved: "approved",
  rejected: "rejected",
  offer_sent: "offer_sent",
  offer_accepted: "offer_accepted",
  active: "active",
  completed: "completed",
  withdrawn: "withdrawn",
};
/** Kinds that legitimately repeat (a second reminder), so they never dedupe on lastNotified. */
const REPEATABLE: PartnerEmailKind[] = ["deliverable_reminder"];

const isStatus = (s: string): s is PartnerStatus => (PARTNER_STATUSES as readonly string[]).includes(s);
export const emailKindFor = (s: PartnerStatus | PartnerEmailKind): PartnerEmailKind => (isStatus(s) ? (STATUS_KIND[s] ?? "under_review") : s);

/**
 * Sends the email for a status (or an email kind) once: skipped when `app.lastNotified` already equals it,
 * and `lastNotified` is only moved after the provider accepted the message, so a failed send can be retried.
 */
export async function sendPartnerStatusEmail(app: PartnerEmailApp, status: PartnerStatus | PartnerEmailKind, extra: PartnerEmailExtra = {}) {
  const kind = emailKindFor(status);
  const repeat = REPEATABLE.includes(kind);
  if (!repeat && app.lastNotified === status) return { sent: false, skipped: true as const };
  const m = partnerEmail(kind, app, extra);
  const r = await sendEmail({ to: app.email, subject: m.subject, html: m.html, text: m.text, kind: "partner" }).catch((e: unknown) => ({ ok: false, status: "failed", error: String(e) }));
  if (!r.ok) return { sent: false, skipped: false as const, error: r.error ?? r.status };
  await db.partnerApplication
    .update({
      where: { id: app.id },
      data: { ...(repeat ? {} : { lastNotified: status }), events: { create: { actor: "system", action: "email.sent", meta: JSON.stringify({ kind, status: r.status }) } } },
    })
    .catch(() => {});
  if (!repeat) app.lastNotified = status;
  return { sent: true, skipped: false as const };
}

export async function notifyAdminsNewApplication(app: PartnerEmailApp & { primaryPlatform: string; primaryHandle: string; followers: number; tier: string; country: string }) {
  const platform = PARTNER_PLATFORM_LABEL[app.primaryPlatform as PartnerPlatform] ?? app.primaryPlatform;
  const tier = PARTNER_TIER_LABEL[app.tier as PartnerTier] ?? app.tier;
  const title = `New creator application ${app.ref}`;
  const body = `${app.fullName} (${platform} @${app.primaryHandle}, ${app.followers.toLocaleString("en-US")} followers, ${tier}, ${app.country})`;
  const href = `/admin/partners/${app.id}`;
  await adminEvent("partner_application", title, body, href);
  const to = (await watchdogConfig().catch(() => null))?.alertEmail;
  if (!to) return;
  await sendEmail({
    to,
    kind: "partner",
    subject: title,
    html: templates.growth({ subject: title, body: `${body}\n\nOpen the application in the admin console to review it.`, url: abs(href), cta: "Review application" }),
    text: `${body}\n\nReview: ${abs(href)}`,
  }).catch(() => {});
}

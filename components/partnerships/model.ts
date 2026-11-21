import type { MineApplication, MineDeliverable, MineEvent, MineOffer } from "@/lib/partners/mine-types";
import { PARTNER_NICHE_LABEL, PARTNER_PLATFORM_LABEL, PARTNER_PREFERENCE_LABEL, PARTNER_STATUS_LABEL, PARTNER_STATUS_TONE, type PartnerStatus } from "@/lib/partners/types";
import { fmtDay } from "@/lib/partners/offer-core";

export const LIST_PATH = "/dashboard/partnerships";
export const APPLY_HREF = "/partners#partners-apply";
export const detailPath = (ref: string) => `${LIST_PATH}/${encodeURIComponent(ref)}`;

const base = (ref: string) => `/api/me/partnerships/${encodeURIComponent(ref)}`;
export const API = {
  list: "/api/me/partnerships",
  one: base,
  info: (ref: string) => `${base(ref)}/info`,
  offer: (ref: string, offerId: string) => `${base(ref)}/offers/${encodeURIComponent(offerId)}`,
  deliverable: (ref: string, id: string) => `${base(ref)}/deliverables/${encodeURIComponent(id)}`,
  withdraw: (ref: string) => `${base(ref)}/withdraw`,
};

export const STAGE_ORDER = ["submitted", "under_review", "more_info", "approved", "offer_sent", "offer_accepted", "active", "completed"] as const;
export type StageKey = (typeof STAGE_ORDER)[number] | "rejected" | "withdrawn";

/** The creator-facing line under each stage (founder spec, Part 1). */
export const STAGE_COPY: Record<StageKey, string> = {
  submitted: "Your application has been received.",
  under_review: "Our team is reviewing your creator profile and engagement.",
  more_info: "Our team needs additional information.",
  approved: "Your application has been approved.",
  offer_sent: "A partnership offer is waiting for your response.",
  offer_accepted: "You have accepted the collaboration terms.",
  active: "Your collaboration is active.",
  completed: "Your partnership has been completed.",
  rejected: "We are not able to offer a partnership this time.",
  withdrawn: "This application was withdrawn.",
};

export type StageState = "done" | "current" | "future" | "ended";
export type Stage = { key: StageKey; label: string; copy: string; state: StageState; at: string | null; note: string };

const TERMINAL = new Set<string>(["rejected", "withdrawn"]);
const rank = (s: string) => (STAGE_ORDER as readonly string[]).indexOf(s);

/** The latest time the application reached `to`, from the creator-safe event list. */
function reachedAt(events: MineEvent[], to: string): string | null {
  let at: string | null = null;
  for (const e of events) if (e.to === to && (!at || e.at > at)) at = e.at;
  return at;
}

/**
 * The timeline, in order: done (green check), the current stage, then the ones still to come. More information
 * only shows when it was asked for. A rejected or withdrawn application ends at the furthest stage it reached and
 * shows the terminal stage with the team's explanation; nothing after it is drawn, it will not happen.
 */
export function timelineStages(app: Pick<MineApplication, "status" | "createdAt" | "events" | "decisionMessage" | "infoRequest">): Stage[] {
  const events = app.events ?? [];
  const status = app.status as string;
  const askedInfo = status === "more_info" || !!app.infoRequest || events.some((e) => e.to === "more_info");
  const keys: StageKey[] = STAGE_ORDER.filter((k) => k !== "more_info" || askedInfo);
  // Answered and back in review: the information step is behind them, so it reads before Under Review.
  const backInReview = status === "under_review" && askedInfo;
  if (backInReview) {
    keys.splice(keys.indexOf("more_info"), 1);
    keys.splice(keys.indexOf("under_review"), 0, "more_info");
  }
  const ended = TERMINAL.has(status);
  let reached = rank(status);
  if (ended) {
    const last = [...events].filter((e) => e.to === status).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    const before = last?.from && !TERMINAL.has(last.from) ? rank(last.from) : -1;
    const seen = events.reduce((m, e) => (e.to && !TERMINAL.has(e.to) ? Math.max(m, rank(e.to)) : m), 0);
    reached = Math.max(0, before >= 0 ? before : seen);
  }
  const stages: Stage[] = [];
  for (const k of keys) {
    const r = backInReview && k === "more_info" ? -1 : rank(k);
    if (ended && r > reached) break;
    const state: StageState = ended ? "done" : r < reached ? "done" : r === reached ? "current" : "future";
    const at = k === "submitted" ? app.createdAt : state === "future" ? null : reachedAt(events, k);
    const note = k === "more_info" && state === "current" ? app.infoRequest?.message ?? "" : "";
    stages.push({ key: k, label: PARTNER_STATUS_LABEL[k], copy: STAGE_COPY[k], state, at, note });
  }
  if (ended) {
    const key = status as "rejected" | "withdrawn";
    stages.push({ key, label: PARTNER_STATUS_LABEL[key], copy: STAGE_COPY[key], state: "ended", at: reachedAt(events, key), note: app.decisionMessage ?? "" });
  }
  return stages;
}

export const STATUS_TONE_CLASS: Record<"neutral" | "info" | "success" | "warning" | "danger", { dot: string; text: string }> = {
  neutral: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
  info: { dot: "bg-cyan", text: "text-foreground" },
  success: { dot: "bg-success", text: "text-success-ink" },
  warning: { dot: "bg-warning", text: "text-warning-ink" },
  danger: { dot: "bg-destructive", text: "text-destructive" },
};
export const statusTone = (s: string) => STATUS_TONE_CLASS[PARTNER_STATUS_TONE[s as PartnerStatus] ?? "neutral"];
export const statusLabel = (s: string) => PARTNER_STATUS_LABEL[s as PartnerStatus] ?? s;

export const platformLabel = (p: string) => (PARTNER_PLATFORM_LABEL as Record<string, string>)[p] ?? (p ? p.charAt(0).toUpperCase() + p.slice(1) : "");
export const nicheLabel = (n: string) => (PARTNER_NICHE_LABEL as Record<string, string>)[n] ?? (n ? n.charAt(0).toUpperCase() + n.slice(1) : "");
export const preferenceLabel = (p: string) => (PARTNER_PREFERENCE_LABEL as Record<string, string>)[p] ?? p;

export const NOT_PROVIDED = "Not provided";
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const countLabel = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? compact.format(n) : NOT_PROVIDED);
export const dayLabel = (d: string | null | undefined) => (d ? fmtDay(d) : NOT_PROVIDED);
export const handleLabel = (h: string) => (!h ? "" : h.startsWith("@") ? h : `@${h}`);

/** Where a card's main button goes: the detail page, at the part that needs the creator. */
export function nextActionHref(app: Pick<MineApplication, "ref" | "nextAction">) {
  const anchor: Record<MineApplication["nextAction"]["kind"], string> = { none: "", respond_info: "#more-info", review_offer: "#offer", submit_deliverables: "#deliverables", withdraw: "" };
  return `${detailPath(app.ref)}${anchor[app.nextAction.kind] ?? ""}`;
}
export function nextActionLabel(app: Pick<MineApplication, "nextAction">) {
  const fallback: Record<MineApplication["nextAction"]["kind"], string> = { none: "View details", respond_info: "Update application", review_offer: "Review offer", submit_deliverables: "Submit published links", withdraw: "View details" };
  return app.nextAction.kind === "withdraw" ? "View details" : app.nextAction.label || fallback[app.nextAction.kind] || "View details";
}

/** "Expires in 3 days", "Expires in 5 hours", "Expires today", "Expired". */
export function expiryLabel(expiresAt: string | null, now = Date.now()): string {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "Expires in under an hour";
  if (h < 24) return `Expires in ${h} ${h === 1 ? "hour" : "hours"}`;
  const d = Math.floor(h / 24);
  return `Expires in ${d} ${d === 1 ? "day" : "days"}`;
}

export type TermRow = { term: string; value: string };
/** Every term of an offer the creator agrees to, in reading order. Empty terms are left out. */
export function offerTerms(o: MineOffer): TermRow[] {
  const rows: (TermRow | false)[] = [
    { term: "Partnership type", value: o.typeLabel },
    o.amountMinor > 0 && !!o.amountLabel && { term: "Paid compensation", value: o.amountLabel },
    !!o.paymentTerms && { term: "Payment terms", value: o.paymentTerms },
    o.subscriptionDays > 0 && { term: "Complimentary Creator subscription", value: [o.planName, o.durationLabel].filter(Boolean).join(", ") },
    o.platforms.length > 0 && { term: "Required platforms", value: o.platforms.map(platformLabel).join(", ") },
    o.deliverables > 0 && { term: "Deliverables", value: o.deliverables === 1 ? "1 piece of content" : `${o.deliverables} pieces of content` },
    !!o.format && { term: "Format", value: o.format },
    (!!o.startsAt || !!o.endsAt) && { term: "Timeline", value: [o.startsAt && `Starts ${fmtDay(o.startsAt)}`, o.endsAt && `ends ${fmtDay(o.endsAt)}`].filter(Boolean).join(", ") },
    !!o.deadlines && { term: "Deadlines", value: o.deadlines },
    { term: "Disclosure", value: o.disclosure ? "Label every post as a paid partnership or sponsored, using the platform's own tool where it has one." : "No disclosure label is required by this offer. Follow your platform's rules." },
    !!o.usageRights && { term: "Usage rights", value: o.usageRights },
    !!o.conditions && { term: "Other conditions", value: o.conditions },
    !!o.expiresAt && { term: "Offer expires", value: fmtDay(o.expiresAt) },
  ];
  return rows.filter((r): r is TermRow => !!r);
}

const DONE = new Set<MineDeliverable["status"]>(["published", "verified"]);
export function deliverableProgress(list: MineDeliverable[]) {
  const done = list.filter((d) => DONE.has(d.status)).length;
  return { done, remaining: list.length - done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}
/** A link can be sent until the team has verified it. */
export const canSubmitLink = (d: MineDeliverable) => d.status === "planned" || d.status === "missed" || d.status === "submitted" || d.status === "published";

const ACTIVITY: Record<string, string> = {
  "info.requested": "The team asked for more information",
  "info.provided": "You sent more information",
  "offer.send": "Offer sent to you",
  "offer.accept": "You accepted the offer",
  "offer.decline": "You declined the offer",
  "benefit.grant": "Creator subscription activated",
  "benefit.end": "Creator subscription ended",
  "deliverable.submit": "You submitted a published link",
  "deliverable.review": "The team reviewed a deliverable",
};
export function activityTitle(e: MineEvent) {
  if (e.action === "status" || (e.to && !ACTIVITY[e.action])) return e.to ? `Status: ${statusLabel(e.to)}` : "Status updated";
  return ACTIVITY[e.action] ?? e.action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

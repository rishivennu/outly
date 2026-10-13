import "server-only";
import { db } from "./db";
import { env } from "./env";
import { getConfig, saveConfig, type SiteConfig } from "./settings";
import { sendEmail, templates } from "./email";
import { adminEvent } from "./admin/route";
import { HttpError } from "./http";

/** Public view of the site switch. Read by middleware (through /api/maintenance) and the maintenance page. */
export async function siteStatus(): Promise<Pick<SiteConfig, "maintenance" | "message" | "eta" | "since" | "endsAt" | "waitlist">> {
  const c = await getConfig("site");
  return { maintenance: !!c.maintenance, message: c.message, eta: c.eta, since: c.since, endsAt: c.maintenance ? c.endsAt ?? "" : "", waitlist: !!c.waitlist };
}

export { joinedBeforeMaintenance } from "./maintenance";

export async function subscribe(email: string) {
  const e = email.trim().toLowerCase();
  await db.maintenanceSubscriber.upsert({ where: { email: e }, create: { email: e }, update: { notifiedAt: null } });
}

/**
 * Flips the switch. Turning it OFF emails everyone who asked to be told, once each.
 * Returns how many were notified so the admin sees the effect.
 */
export async function setMaintenance(on: boolean, by: string, patch: { message?: string; eta?: string; minutes?: number | null } = {}) {
  const cur = await getConfig("site");
  // Duration picker: a number restarts the clock from now, 0/null clears it, undefined keeps what is there.
  const endsAt = !on
    ? ""
    : patch.minutes === undefined
      ? cur.maintenance
        ? cur.endsAt ?? ""
        : ""
      : patch.minutes
        ? new Date(Date.now() + patch.minutes * 60_000).toISOString()
        : "";
  const next = await saveConfig("site", {
    maintenance: on,
    message: patch.message ?? cur.message,
    eta: patch.eta ?? cur.eta,
    since: on ? (cur.maintenance ? cur.since : new Date().toISOString()) : "",
    endsAt,
  });
  let notified = 0;
  if (cur.maintenance && !on) notified = await notifySubscribers();
  if (cur.maintenance !== on) await adminEvent("maintenance", on ? `${by} turned maintenance ON` : `${by} turned maintenance OFF`, on ? next.message || "Site shows the maintenance page" : `${notified} subscriber${notified === 1 ? "" : "s"} emailed`, "/admin/maintenance");
  return { site: next, notified };
}

/**
 * Bulk email inside one serverless request: a few sends in parallel, and stop before the platform's
 * time limit instead of being killed half way. Each row is marked as it succeeds, so running the
 * same action again simply carries on with whoever is left.
 */
async function sendInBatches<T>(items: T[], send: (item: T) => Promise<boolean>, { concurrency = 8, budgetMs = 40_000 } = {}) {
  const t0 = Date.now();
  let n = 0;
  for (let i = 0; i < items.length; i += concurrency) {
    if (Date.now() - t0 > budgetMs) break;
    const done = await Promise.all(items.slice(i, i + concurrency).map((it) => send(it).catch(() => false)));
    n += done.filter(Boolean).length;
  }
  return n;
}

export async function notifySubscribers() {
  const list = await db.maintenanceSubscriber.findMany({ where: { notifiedAt: null }, take: 2000 });
  const url = env.APP_URL.replace(/\/$/, "");
  return sendInBatches(list, async (s) => {
    const r = await sendEmail({ to: s.email, kind: "maintenance", subject: "Outlly is back online", html: templates.backOnline({ url }) });
    if (r.ok) await db.maintenanceSubscriber.update({ where: { id: s.id }, data: { notifiedAt: new Date() } });
    return r.ok;
  });
}

export async function subscriberCounts() {
  const [waiting, total] = await Promise.all([db.maintenanceSubscriber.count({ where: { notifiedAt: null } }), db.maintenanceSubscriber.count()]);
  return { waiting, total };
}

/* ------------------------------------------------------------------ waitlist */

export const MAINTENANCE_CLOSED = "Outlly is in a short maintenance window, so new accounts are paused. Members can keep signing in; try again once we're back.";
export const WAITLIST_CLOSED = "Outlly is invite-only right now. Join the waitlist and we'll email you an invite.";

const norm = (e: string) => e.trim().toLowerCase();

/**
 * Who may create an account while the waitlist is on: anyone already invited from the
 * waitlist, and anyone with a pending team invite (their teammate asked for them).
 */
export async function mayCreateAccount(email: string) {
  const c = await getConfig("site");
  // Maintenance: existing members keep working, but nobody new gets in until it is over.
  if (c.maintenance) return false;
  if (!c.waitlist) return true;
  const e = norm(email);
  const [w, t] = await Promise.all([
    db.waitlistEntry.findUnique({ where: { email: e }, select: { invitedAt: true } }),
    // Same 14-day life as the invite link itself (lib/team/service.ts).
    db.teamMember.findFirst({ where: { email: e, status: "invited", createdAt: { gt: new Date(Date.now() - 14 * 864e5) } }, select: { id: true } }),
  ]);
  return !!w?.invitedAt || !!t;
}

/** Throws the friendly 403 the signup form and Google sign-in show when the doors are closed. */
export async function assertMayCreateAccount(email: string) {
  if ((await getConfig("site")).maintenance) throw new HttpError(503, MAINTENANCE_CLOSED, "maintenance");
  if (!(await mayCreateAccount(email))) throw new HttpError(403, WAITLIST_CLOSED, "waitlist");
}

/** Place in line among people still waiting (1 = next). Already invited returns 0. */
async function positionOf(entry: { createdAt: Date; invitedAt: Date | null }) {
  if (entry.invitedAt) return 0;
  return (await db.waitlistEntry.count({ where: { invitedAt: null, createdAt: { lt: entry.createdAt } } })) + 1;
}

/** Joining twice keeps the original spot; the name is filled in if it was missing. */
export async function joinWaitlist(email: string, name?: string, source?: string) {
  const e = norm(email);
  const n = name?.trim() || undefined;
  const existed = await db.waitlistEntry.findUnique({ where: { email: e } });
  const entry = existed
    ? n && !existed.name
      ? await db.waitlistEntry.update({ where: { id: existed.id }, data: { name: n } })
      : existed
    : await db.waitlistEntry.create({ data: { email: e, name: n ?? null, source: source ?? null } });
  const [position, waiting] = await Promise.all([positionOf(entry), db.waitlistEntry.count({ where: { invitedAt: null } })]);
  if (!existed) {
    const total = await db.waitlistEntry.count();
    if (total === 1 || total % 25 === 0) await adminEvent("waitlist", `Waitlist reached ${total}`, `${waiting} waiting for an invite`, "/admin/waitlist").catch(() => {});
  }
  return { position, waiting, invited: !!entry.invitedAt, already: !!existed };
}

/** Emails an invite to each id given (or, with none, everyone still waiting) and marks them invited. */
export async function inviteWaitlist(ids?: string[], limit = 2000) {
  const list = await db.waitlistEntry.findMany({
    where: { invitedAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const base = env.APP_URL.replace(/\/$/, "");
  return sendInBatches(list, async (w) => {
    const url = `${base}/signup?invite=1&email=${encodeURIComponent(w.email)}`;
    const r = await sendEmail({ to: w.email, kind: "waitlist", subject: "Your Outlly invite is here", html: templates.waitlistInvite({ url, name: w.name }) });
    if (r.ok) await db.waitlistEntry.update({ where: { id: w.id }, data: { invitedAt: new Date() } });
    return r.ok;
  });
}

/** Flip waitlist mode. Turning it OFF can invite everyone waiting in the same step. */
export async function setWaitlist(on: boolean, by: string, opts: { inviteAll?: boolean } = {}) {
  const cur = await getConfig("site");
  const next = await saveConfig("site", { waitlist: on, waitlistSince: on ? (cur.waitlist ? cur.waitlistSince : new Date().toISOString()) : "" });
  let invited = 0;
  if (cur.waitlist && !on && opts.inviteAll) invited = await inviteWaitlist();
  if (!!cur.waitlist !== on)
    await adminEvent(
      "waitlist",
      on ? `${by} turned the waitlist ON` : `${by} turned the waitlist OFF`,
      on ? "New signups go to the waitlist" : invited ? `${invited} invite${invited === 1 ? "" : "s"} emailed` : "Signups are open again",
      "/admin/waitlist",
    );
  return { site: next, invited };
}

export async function waitlistCounts() {
  const since = new Date(Date.now() - 86_400_000);
  const [waiting, invited, today] = await Promise.all([
    db.waitlistEntry.count({ where: { invitedAt: null } }),
    db.waitlistEntry.count({ where: { invitedAt: { not: null } } }),
    db.waitlistEntry.count({ where: { createdAt: { gte: since } } }),
  ]);
  return { waiting, invited, total: waiting + invited, today };
}

/** Most recent people first, for the admin table. */
export async function waitlistRecent(take = 50) {
  const rows = await db.waitlistEntry.findMany({ orderBy: { createdAt: "desc" }, take });
  return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, source: r.source, createdAt: r.createdAt.toISOString(), invitedAt: r.invitedAt?.toISOString() ?? null }));
}

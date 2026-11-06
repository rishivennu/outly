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

/** Start of today, this week (Monday) and this month on the India clock, as instants. The admin reads the waitlist in IST. */
export function istBounds(now = new Date()) {
  const IST = 330 * 60_000;
  const local = new Date(now.getTime() + IST); // wall clock in IST, read with the UTC getters
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - IST;
  const week = day - ((local.getUTCDay() + 6) % 7) * 86_400_000;
  const month = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - IST;
  return { day: new Date(day), week: new Date(week), month: new Date(month) };
}

/**
 * Waitlist numbers (1142: + week, month, latest). Straight counts of WaitlistEntry, whatever the switch says:
 * turning waitlist mode on or off never touches these rows, so the total is the same either way.
 * `today`, `week` and `month` are calendar periods on the India clock; `last24h` is the rolling day.
 */
export async function waitlistCounts(now = new Date()) {
  const b = istBounds(now);
  const since = (d: Date) => db.waitlistEntry.count({ where: { createdAt: { gte: d } } });
  const [total, waiting, today, week, month, last24h, latest] = await Promise.all([
    db.waitlistEntry.count(),
    db.waitlistEntry.count({ where: { invitedAt: null } }),
    since(b.day),
    since(b.week),
    since(b.month),
    since(new Date(now.getTime() - 86_400_000)),
    db.waitlistEntry.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return { total, waiting, invited: total - waiting, today, week, month, last24h, latestAt: latest?.createdAt.toISOString() ?? null };
}

export type WaitlistRow = { id: string; email: string; name: string | null; source: string | null; createdAt: string; invitedAt: string | null };
const toRow = (r: { id: string; email: string; name: string | null; source: string | null; createdAt: Date; invitedAt: Date | null }): WaitlistRow => ({
  id: r.id,
  email: r.email,
  name: r.name,
  source: r.source,
  createdAt: r.createdAt.toISOString(),
  invitedAt: r.invitedAt?.toISOString() ?? null,
});

/** Most recent people first, for the admin table. */
export async function waitlistRecent(take = 50) {
  const rows = await db.waitlistEntry.findMany({ orderBy: { createdAt: "desc" }, take });
  return rows.map(toRow);
}

export type WaitlistQuery = { q?: string; from?: string; to?: string; sort?: "new" | "old"; status?: "all" | "waiting" | "invited"; page?: number; per?: number };

// Case-insensitive search: Postgres needs `mode`, SQLite's LIKE already ignores ASCII case (and rejects `mode`).
const ci = (process.env.DATABASE_URL ?? "").startsWith("postgres") ? { mode: "insensitive" as const } : {};

/** `from` / `to` are IST calendar days (YYYY-MM-DD), both inclusive. Anything unparsable is ignored, not an error. */
function waitlistWhere(f: WaitlistQuery) {
  const day = (s: string | undefined, end: boolean) => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const t = Date.parse(`${s}T00:00:00+05:30`);
    return Number.isNaN(t) ? null : new Date(t + (end ? 86_400_000 : 0));
  };
  const from = day(f.from, false);
  const to = day(f.to, true);
  const q = f.q?.trim().toLowerCase().slice(0, 120);
  return {
    ...(q ? { OR: [{ email: { contains: q, ...ci } }, { name: { contains: q, ...ci } }] } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    ...(f.status === "waiting" ? { invitedAt: null } : f.status === "invited" ? { invitedAt: { not: null } } : {}),
  };
}

/** Searchable, filterable, paged member list for the admin Waitlist page. The DB is the source: nothing is cached. */
export async function waitlistList(f: WaitlistQuery = {}) {
  const per = Math.min(100, Math.max(5, Math.floor(f.per ?? 25)));
  const where = waitlistWhere(f);
  const total = await db.waitlistEntry.count({ where });
  const pages = Math.max(1, Math.ceil(total / per));
  const page = Math.min(pages, Math.max(1, Math.floor(f.page ?? 1)));
  const rows = await db.waitlistEntry.findMany({ where, orderBy: [{ createdAt: f.sort === "old" ? "asc" : "desc" }, { id: "asc" }], skip: (page - 1) * per, take: per });
  return { rows: rows.map(toRow), total, page, pages, per };
}

/** A spreadsheet cell: quoted, and a leading = + - @ (or tab / CR) defused so Excel never runs it as a formula. */
export const csvCell = (v: string | null | undefined) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/** Every matching member as CSV (same filters as the table, no paging). Times in UTC ISO plus an IST column. */
export async function waitlistCsv(f: WaitlistQuery = {}) {
  const rows = await db.waitlistEntry.findMany({ where: waitlistWhere(f), orderBy: [{ createdAt: f.sort === "old" ? "asc" : "desc" }, { id: "asc" }] });
  const ist = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  const head = ["email", "name", "source", "joined_utc", "joined_ist", "status", "invited_utc"];
  const lines = rows.map((r) => [r.email, r.name, r.source, r.createdAt.toISOString(), ist(r.createdAt), r.invitedAt ? "invited" : "waiting", r.invitedAt?.toISOString() ?? ""].map(csvCell).join(","));
  return { csv: "\uFEFF" + [head.join(","), ...lines].join("\r\n") + "\r\n", count: rows.length };
}

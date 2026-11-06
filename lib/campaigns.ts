import "server-only";
import { db } from "./db";
import { env } from "./env";
import { getConfig } from "./settings";
import { sendEmail, templates } from "./email";
import { adminEvent } from "./admin/route";
import { HttpError } from "./http";
import { SENT, STALE_SENDING_MS, SEND_GAP_MS, WAITLIST_UPDATE, applyEvent, eligible, outcome } from "./campaigns-core";

/**
 * 1142: the one-time "You're on the Outlly waitlist" email to everyone who joined before this release.
 *
 * Never twice, by construction:
 *  - the campaign row's id is the campaign key, and its `cutoff` is fixed the first time the row is created (the
 *    first cron sweep or admin visit after deploy). People who join after that are never eligible.
 *  - launching is a compare-and-set on `launchedAt`, so two admins or a double click start it once.
 *  - each address gets one recipient row (unique per campaign), and only a "pending" row is ever claimed for a send.
 *    Refreshes, redeploys and overlapping sweeps find nothing pending and send nothing.
 *  - every send carries an Idempotency-Key, so even a retry after a timeout can't reach the inbox twice.
 * Sending happens in the background: the minute cron sweep, plus the admin page while it is open.
 */
export { WAITLIST_UPDATE };
const ID = WAITLIST_UPDATE.id;

/** The campaign row, created on first touch. `update: {}` means a later call never moves the cutoff. */
export async function ensureCampaign(now = new Date()) {
  try {
    return await db.emailCampaign.upsert({ where: { id: ID }, create: { id: ID, subject: WAITLIST_UPDATE.subject, cutoff: now }, update: {} });
  } catch {
    // Two first touches at once: one insert wins, the other reads it.
    return db.emailCampaign.findUniqueOrThrow({ where: { id: ID } });
  }
}

async function eligibleNow(cutoff: Date) {
  const rows = await db.waitlistEntry.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true, email: true, createdAt: true } });
  return eligible(rows, cutoff);
}

/** Recipient rows for every eligible address that doesn't have one yet. Safe to run again: it only adds the missing. */
async function fillSnapshot(cutoff: Date) {
  const e = await eligibleNow(cutoff);
  const have = new Set((await db.emailCampaignRecipient.findMany({ where: { campaignId: ID }, select: { email: true } })).map((r) => r.email));
  const missing = e.list.filter((x) => !have.has(x.email));
  for (let i = 0; i < missing.length; i += 200) {
    const chunk = missing.slice(i, i + 200);
    try {
      await db.emailCampaignRecipient.createMany({ data: chunk.map((x) => ({ campaignId: ID, email: x.email, waitlistId: x.waitlistId })) });
    } catch {
      // A parallel fill got some of these first: add the rest one by one, skipping what now exists.
      for (const x of chunk) await db.emailCampaignRecipient.create({ data: { campaignId: ID, email: x.email, waitlistId: x.waitlistId } }).catch(() => {});
    }
  }
  await db.emailCampaign.update({ where: { id: ID }, data: { snapshotAt: new Date() } });
  return e;
}

/** May this server send real campaign email? Mock in production would mark everyone "sent" while nobody got anything. */
async function sendable() {
  const cfg = await getConfig("email");
  if (cfg.provider === "resend" && cfg.resend.apiKey) return { ok: true as const, cfg };
  if (cfg.provider === "mock" && env.NODE_ENV !== "production") return { ok: true as const, cfg };
  return { ok: false as const, cfg, why: cfg.provider === "resend" ? "Resend is selected but no API key is saved (Admin > Integrations)." : "Email is on Mock. Connect Resend in Admin > Integrations before sending a campaign." };
}

export type CampaignStatus = Awaited<ReturnType<typeof campaignStatus>>;

/** Everything the admin card shows. Before launch the numbers are a live preview of who would get it. */
export async function campaignStatus() {
  const c = await ensureCampaign();
  const [groups, late, s, recentFails, last] = await Promise.all([
    db.emailCampaignRecipient.groupBy({ by: ["status"], where: { campaignId: ID }, _count: { _all: true } }),
    db.waitlistEntry.count({ where: { createdAt: { gte: c.cutoff } } }),
    sendable(),
    db.emailCampaignRecipient.findMany({ where: { campaignId: ID, status: { in: ["failed", "bounced", "complained"] } }, orderBy: { updatedAt: "desc" }, take: 20, select: { email: true, status: true, error: true, updatedAt: true, attempts: true } }),
    db.emailCampaignRecipient.findFirst({ where: { campaignId: ID, sentAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
  ]);
  const by: Record<string, number> = {};
  for (const g of groups) by[g.status] = g._count._all;
  const n = (...k: string[]) => k.reduce((t, x) => t + (by[x] ?? 0), 0);
  const recipients = Object.values(by).reduce((a, b) => a + b, 0);
  const pre = c.launchedAt ? null : await eligibleNow(c.cutoff);
  return {
    id: ID,
    subject: c.subject,
    cutoff: c.cutoff.toISOString(),
    launchedAt: c.launchedAt?.toISOString() ?? null,
    launchedBy: c.launchedBy,
    doneAt: c.doneAt?.toISOString() ?? null,
    lastSentAt: last?.sentAt?.toISOString() ?? null,
    eligible: pre ? pre.list.length : recipients,
    excluded: { joinedAfter: late, invalid: pre?.invalid ?? 0, duplicates: pre?.dupes ?? 0 },
    counts: {
      sent: n(...SENT),
      accepted: n("accepted"),
      delivered: n("delivered"),
      pending: n("pending", "sending"),
      failed: n("failed", "bounced"),
      bounced: n("bounced"),
      complained: n("complained"),
      skipped: n("skipped"),
      mocked: n("mocked"),
    },
    failures: recentFails.map((f) => ({ email: f.email, status: f.status, error: f.error, attempts: f.attempts, at: f.updatedAt.toISOString() })),
    provider: s.cfg.provider,
    canSend: s.ok,
    blockedWhy: s.ok ? null : s.why,
    deliveryTracking: !!(s.cfg.resend.webhookSecret || process.env.RESEND_WEBHOOK_SECRET),
  };
}

/** The exact email, for the admin preview. */
export const campaignPreview = () => ({ subject: WAITLIST_UPDATE.subject, html: templates.waitlistUpdate() });

/**
 * Start it. `expect` is the eligible count the admin saw in the confirm dialog: if the list changed under them the
 * launch is refused, so nobody confirms one number and sends to another.
 */
export async function launchCampaign(by: string, expect: number) {
  const c = await ensureCampaign();
  if (c.launchedAt) throw new HttpError(409, "This campaign was already launched. It can't be sent twice.", "campaign_launched");
  const s = await sendable();
  if (!s.ok) throw new HttpError(409, s.why, "campaign_provider");
  const pre = await eligibleNow(c.cutoff);
  if (pre.list.length !== expect) throw new HttpError(409, `The list changed: ${pre.list.length} people are eligible now, not ${expect}. Check the preview again.`, "campaign_changed");
  if (!pre.list.length) throw new HttpError(409, "Nobody is eligible for this campaign.", "campaign_empty");
  const claim = await db.emailCampaign.updateMany({ where: { id: ID, launchedAt: null }, data: { launchedAt: new Date(), launchedBy: by } });
  if (claim.count === 0) throw new HttpError(409, "This campaign was already launched. It can't be sent twice.", "campaign_launched");
  await fillSnapshot(c.cutoff);
  await adminEvent("campaign", `${by} launched the waitlist update email`, `${pre.list.length} recipients. Sending in the background.`, "/admin/waitlist").catch(() => {});
  return pre.list.length;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send what is due, one email at a time, spaced for Resend's rate limit, until the budget runs out. Each row is
 * claimed (pending -> sending) with a compare-and-set first, so two sweeps running at once never send one twice.
 */
export async function processCampaign({ budgetMs = 20_000, max = 200 } = {}) {
  const start = Date.now();
  const c = await db.emailCampaign.findUnique({ where: { id: ID } });
  if (!c?.launchedAt || c.doneAt) return { sent: 0, left: 0 };
  if (!c.snapshotAt) await fillSnapshot(c.cutoff);
  // A function that died mid-send leaves "sending" behind; the Idempotency-Key makes picking it up again safe.
  await db.emailCampaignRecipient.updateMany({ where: { campaignId: ID, status: "sending", updatedAt: { lt: new Date(Date.now() - STALE_SENDING_MS) } }, data: { status: "pending", nextAt: new Date() } });
  const s = await sendable();
  let sent = 0;
  if (s.ok) {
    const html = templates.waitlistUpdate();
    while (sent < max && Date.now() - start < budgetMs) {
      const next = await db.emailCampaignRecipient.findFirst({ where: { campaignId: ID, status: "pending", nextAt: { lte: new Date() } }, orderBy: [{ nextAt: "asc" }, { id: "asc" }] });
      if (!next) break;
      const claim = await db.emailCampaignRecipient.updateMany({ where: { id: next.id, status: "pending" }, data: { status: "sending", attempts: { increment: 1 } } });
      if (claim.count === 0) continue;
      const r = await sendEmail({ to: next.email, kind: "announcement", subject: WAITLIST_UPDATE.subject, html, idempotencyKey: `${ID}:${next.email}` }, s.cfg).catch((e) => ({ ok: false, status: "failed", error: (e as Error).message, id: "", providerId: undefined, code: undefined }));
      const o = outcome(r, next.attempts + 1);
      await db.emailCampaignRecipient.update({ where: { id: next.id }, data: { ...o, emailLogId: r.id || null } });
      sent++;
      if (r.status === "failed" && r.code === 429) break; // over the rate limit: leave the rest for the next run
      await pause(SEND_GAP_MS);
    }
  }
  const left = await db.emailCampaignRecipient.count({ where: { campaignId: ID, status: { in: ["pending", "sending"] } } });
  if (!left) {
    const done = await db.emailCampaign.updateMany({ where: { id: ID, doneAt: null }, data: { doneAt: new Date() } });
    if (done.count) {
      const st = await campaignStatus();
      await adminEvent("campaign", "Waitlist update email finished", `${st.counts.sent} sent, ${st.counts.failed} failed, ${st.counts.skipped} unsubscribed`, "/admin/waitlist").catch(() => {});
    }
  }
  return { sent, left };
}

/** The cron sweep's hook: fixes the cutoff on the first run after deploy, then sends a short batch if launched. */
export async function sweepCampaigns() {
  await ensureCampaign();
  return processCampaign({ budgetMs: 8_000, max: 12 });
}

/** A Resend webhook event (already verified). Returns whether it matched a campaign email. */
export async function recordProviderEvent(type: string, providerId: string, detail?: string) {
  const row = await db.emailCampaignRecipient.findFirst({ where: { providerId } });
  if (!row) return false;
  const next = applyEvent(row.status, type);
  if (!next) return true;
  await db.emailCampaignRecipient.update({
    where: { id: row.id },
    data: { status: next, ...(next === "delivered" ? { deliveredAt: new Date() } : {}), ...(next === "bounced" || next === "failed" || next === "complained" ? { error: detail?.slice(0, 300) || type.replace("email.", "") } : {}) },
  });
  // A spam complaint means: never send this person marketing again.
  if (next === "complained") await db.emailOptOut.upsert({ where: { email_list: { email: row.email, list: "news" } }, create: { email: row.email, list: "news" }, update: {} }).catch(() => {});
  return true;
}

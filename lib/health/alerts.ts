import "server-only";
import { db } from "../db";
import { adminEvent } from "../admin/route";
import { sendEmail } from "../email";
import { alertText, COOLDOWN_MS, redact, type AlertKind } from "./core";
import { watchdogConfig } from "./config";
import { serviceById } from "./registry";
import { webPushToAdmins } from "./admin-push";

/*
 * R1195 Watchdog alerts, through the channels the admin console already has:
 *  - bell: an AdminEvent (kind watchdog_<kind>) that the header bell lists and the console shows live;
 *  - push: Web Push to every active super admin's alert devices, from the server, so it arrives with the console
 *    closed, the admin signed out, or the site's pages down;
 *  - email: for criticals (new, escalated, reminder, watchdog) only when no push was accepted by a push service,
 *    to the configured alert address.
 * Every attempt is a HealthAlertDelivery row with the channel's real answer. "sent" means the push service or the
 * email provider accepted it; nothing here ever claims it reached a screen.
 *
 * Rules: one alert per new incident (repeats are grouped upstream); a service cannot raise a second new-incident
 * alert within COOLDOWN_MS of the last one; recovery goes out exactly once (guarded by recoveryNotifiedAt);
 * nothing is sent for a passing check.
 */

type Inc = { id: string; service: string; severity: string; title: string; description: string; firstDetectedAt: Date; occurrences: number; resolvedAt?: Date | null; notifiedAt?: Date | null; recoveryNotifiedAt?: Date | null; lastReminderAt?: Date | null; likelyCause?: string };

export type AlertOutcome = { kind: AlertKind; skipped?: string; bell: "sent" | "failed" | "skipped"; push: { devices: number; sent: number; failed: number }; email: "sent" | "failed" | "skipped"; emailDetail?: string };

const log = (incidentId: string | null, kind: AlertKind, channel: "bell" | "push" | "email", status: "sent" | "failed" | "skipped", detail = "", adminId?: string) =>
  db.healthAlertDelivery.create({ data: { incidentId, kind, channel, status, detail: redact(detail, 300), adminId: adminId ?? null } }).catch(() => null);

export async function notifyIncident(kind: AlertKind, inc: Inc, now = new Date()): Promise<AlertOutcome> {
  const out: AlertOutcome = { kind, bell: "skipped", push: { devices: 0, sent: 0, failed: 0 }, email: "skipped" };
  const cfg = await watchdogConfig();
  if (cfg.muted.includes(inc.service)) {
    out.skipped = "muted";
    await log(inc.id, kind, "bell", "skipped", "service muted by an admin");
    return out;
  }
  if (kind === "critical" || kind === "warning") {
    // Cooldown: the same service already raised a new-incident alert a moment ago (flapping).
    const recent = await db.healthAlertDelivery.findFirst({ where: { channel: "bell", status: "sent", kind: { in: ["critical", "warning"] }, createdAt: { gte: new Date(now.getTime() - COOLDOWN_MS) }, incident: { service: inc.service, id: { not: inc.id } } }, select: { id: true } });
    if (recent) {
      out.skipped = "cooldown";
      await log(inc.id, kind, "bell", "skipped", `cooldown: ${inc.service} alerted within the last ${COOLDOWN_MS / 60_000} min`);
      await db.healthIncident.update({ where: { id: inc.id }, data: { notifiedAt: now } }).catch(() => null);
      return out;
    }
  }
  if (kind === "recovery") {
    // Exactly one: whoever flips recoveryNotifiedAt from null owns the send.
    const own = await db.healthIncident.updateMany({ where: { id: inc.id, recoveryNotifiedAt: null }, data: { recoveryNotifiedAt: now } });
    if (!own.count) {
      out.skipped = "already-notified";
      return out;
    }
  }

  const svc = serviceById(inc.service);
  const text = alertText(kind, inc, svc?.name ?? inc.service);
  const critical = kind === "critical" || kind === "escalation" || kind === "reminder" || kind === "watchdog";

  // 1. Bell (admin notification centre).
  try {
    await adminEvent(`watchdog_${kind}`, text.title, text.short, text.href);
    out.bell = "sent";
    await log(inc.id, kind, "bell", "sent");
  } catch (e) {
    out.bell = "failed";
    await log(inc.id, kind, "bell", "failed", String(e));
  }

  // 2. Push to super admins' alert devices (backend-generated: works with the console closed).
  const push = await webPushToAdmins({ title: text.title, body: text.body, href: text.href, tag: text.tag, kind: `watchdog_${kind}`, keepOpen: critical }, { roles: ["super"], urgency: critical ? "high" : "normal" });
  out.push = { devices: push.devices, sent: push.sent, failed: push.failed + push.dropped };
  if (!push.devices) await log(inc.id, kind, "push", "skipped", "no admin has alert pushes turned on");
  for (const [adminId, r] of Object.entries(push.perAdmin)) {
    if (r.sent) await log(inc.id, kind, "push", "sent", `${r.sent} of ${r.devices} device(s) accepted by the push service`, adminId);
    if (r.failed) await log(inc.id, kind, "push", "failed", `${r.failed} of ${r.devices} device(s) refused or unreachable`, adminId);
  }

  // 3. Email backup for criticals when no push got through.
  if (critical && push.sent === 0) {
    if (!cfg.alertEmail) {
      await log(inc.id, kind, "email", "skipped", "no alert email configured (System Health > Alert settings)");
    } else {
      const r: { ok: boolean; status: string; error?: string } = await sendEmail({ to: cfg.alertEmail, kind: "watchdog", subject: `${text.title}: ${inc.title}`, html: emailHtml(text.title, text.body, text.href), text: text.body }).catch((e: unknown) => ({ ok: false, status: "failed", error: String(e) }));
      const sent = r.ok && r.status !== "mocked";
      out.email = sent ? "sent" : "failed";
      out.emailDetail = sent ? `accepted by the provider (${r.status})` : r.status === "mocked" ? "email provider is the mock: nothing left this deployment" : (r.error ?? r.status);
      await log(inc.id, kind, "email", out.email, out.emailDetail);
    }
  }

  const stamp: Record<string, Date> = kind === "reminder" ? { lastReminderAt: now } : kind === "recovery" ? {} : { notifiedAt: now };
  if (Object.keys(stamp).length) await db.healthIncident.update({ where: { id: inc.id }, data: stamp }).catch(() => null);
  return out;
}

function emailHtml(title: string, body: string, href: string) {
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  return `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111"><h2 style="margin:0 0 12px">${esc(title)}</h2><pre style="font:inherit;white-space:pre-wrap;margin:0 0 16px">${esc(body)}</pre><p><a href="${esc(base + href)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Open System Health</a></p><p style="color:#666;font-size:13px">Sent by the Outlly Watchdog because no alert device accepted a push. Turn on alert pushes in System Health to get these on your phone.</p></div>`;
}

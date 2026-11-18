import "server-only";
import { db } from "../db";
import { payloadOf, pushToSub, type Sub, type WebPushMessage } from "../push/webpush";
import { MAX_REJECTS } from "../push/webpush-core";
import type { AdminRole } from "../admin/perms";

/*
 * R1195: Web Push to admins' devices (AdminPushSub). Same payload, encryption, VAPID header and push-service
 * handling as member pushes (lib/push/webpush.ts); only the device table differs, so member cleanup never drops an
 * admin's alert device and an admin who is also a creator gets both. No retry outbox: an alert that the push
 * service turned away is reported as failed to the alert engine, which falls back to email for criticals and
 * tries again on the next escalation / reminder.
 */

export type AdminPushResult = { devices: number; sent: number; failed: number; dropped: number; perAdmin: Record<string, { sent: number; failed: number; devices: number }> };

const SELECT = { id: true, adminId: true, endpoint: true, p256dh: true, auth: true, vapidKey: true, failures: true } as const;

export async function webPushToAdmins(m: WebPushMessage, opts: { adminIds?: string[]; roles?: AdminRole[]; only?: string; ttl?: number; urgency?: "normal" | "high"; retries?: number } = {}): Promise<AdminPushResult> {
  const res: AdminPushResult = { devices: 0, sent: 0, failed: 0, dropped: 0, perAdmin: {} };
  try {
    const subs = await db.adminPushSub.findMany({
      where: { ...(opts.only ? { id: opts.only } : {}), ...(opts.adminIds ? { adminId: { in: opts.adminIds } } : {}), admin: { active: true, ...(opts.roles ? { role: { in: opts.roles } } : {}) } },
      select: SELECT,
      take: 50,
      orderBy: { lastSeenAt: "desc" },
    });
    res.devices = subs.length;
    if (!subs.length) return res;
    const payload = payloadOf(m);
    const ttl = opts.ttl ?? 6 * 3600;
    const urgency = opts.urgency ?? "high";
    const now = new Date();
    await Promise.all(
      subs.map(async (s) => {
        const per = (res.perAdmin[s.adminId] ??= { sent: 0, failed: 0, devices: 0 });
        per.devices++;
        const sub: Sub = { id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, vapidKey: s.vapidKey, failures: s.failures };
        let { outcome } = await pushToSub(sub, payload, ttl, urgency, m.tag);
        // R1207: a temporary failure (network, 429, 5xx) is tried again after a short pause, `retries` times.
        for (let i = 0; outcome === "retry" && i < (opts.retries ?? 0); i++) {
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
          ({ outcome } = await pushToSub(sub, payload, ttl, urgency, m.tag));
        }
        if (outcome === "sent") {
          await db.adminPushSub.update({ where: { id: s.id }, data: { failures: 0, lastPushAt: now } }).catch(() => null);
          res.sent++;
          per.sent++;
        } else if (outcome === "gone" || (outcome === "rejected" && s.failures + 1 >= MAX_REJECTS)) {
          await db.adminPushSub.deleteMany({ where: { id: s.id } });
          res.dropped++;
          per.failed++;
        } else {
          if (outcome === "rejected") await db.adminPushSub.update({ where: { id: s.id }, data: { failures: { increment: 1 } } }).catch(() => null);
          res.failed++;
          per.failed++;
        }
      }),
    );
  } catch (e) {
    console.error("[watchdog] admin push", e);
  }
  return res;
}

/** Devices for the System Health page (no endpoints, ever). */
export async function adminDevices(adminId: string) {
  const rows = await db.adminPushSub.findMany({ where: { adminId }, orderBy: { lastSeenAt: "desc" }, select: { id: true, platform: true, device: true, client: true, failures: true, createdAt: true, lastSeenAt: true, lastPushAt: true } });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), lastPushAt: r.lastPushAt?.toISOString() ?? null }));
}

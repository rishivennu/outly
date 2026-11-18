import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { healthOverview } from "@/lib/health/overview";
import { originOf, runHealthCycle } from "@/lib/health/engine";
import { saveWatchdogConfig, watchdogConfig, WatchdogConfig } from "@/lib/health/config";
import { adminDevices, webPushToAdmins } from "@/lib/health/admin-push";
import { MONITORED } from "@/lib/health/registry";
import { vapidKeys } from "@/lib/push/vapid";

export const dynamic = "force-dynamic";

/**
 * R1195 System Health: the whole page in one answer (overview, this admin's alert devices, the settings a super
 * admin may change). Everything comes from recorded checks and incidents; nothing here runs a probe unless the
 * admin asks for one with POST {action:"run"}.
 */
export const GET = adminRoute("health", async (req, { admin }) => {
  const range = req.nextUrl.searchParams.get("range") ?? "24h";
  const [overview, devices, cfg, vapid] = await Promise.all([healthOverview(new Date(), range), adminDevices(admin.id), watchdogConfig(), vapidKeys().catch(() => null)]);
  return json({
    ...overview,
    role: admin.role,
    devices,
    vapidPublicKey: vapid?.publicKey ?? null,
    // The editable settings, super admins only (the overview already carries the masked email for everyone).
    config: admin.role === "super" ? cfg : null,
    intervalsDefault: Object.fromEntries(MONITORED.map((s) => [s.id, s.intervalSec])),
  });
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), only: z.array(z.string().max(40)).max(40).optional() }),
  z.object({ action: z.literal("config"), config: WatchdogConfig }),
  z.object({ action: z.literal("test-alert") }),
]);

export const POST = adminRoute(
  "health",
  async (req, { admin }) => {
    const b = Body.parse(await req.json());
    if (b.action === "run") {
      if (admin.role !== "super") throw new HttpError(403, "Only a super admin can run the checks by hand.", "FORBIDDEN");
      const only = b.only?.filter((id) => MONITORED.some((s) => s.id === id));
      const r = await runHealthCycle({ origin: originOf(req.nextUrl.origin), force: true, only: only?.length ? only : undefined, source: "manual", budgetMs: 25_000 });
      return json({ ok: true, cycle: r });
    }
    if (b.action === "config") {
      if (admin.role !== "super") throw new HttpError(403, "Only a super admin can change Watchdog settings.", "FORBIDDEN");
      const cfg = await saveWatchdogConfig(b.config);
      return json({ ok: true, config: cfg });
    }
    // test-alert: a real push to this admin's own alert devices, recorded like any other delivery. The answer says
    // only what the push service said; "sent" is acceptance, not a screen.
    const push = await webPushToAdmins(
      { title: "Outlly Watchdog, Test", body: `Test alert for ${admin.name}\nAction: Open System Health`, href: "/admin/health", tag: `watchdog:test:${admin.id}`, kind: "watchdog_test" },
      { adminIds: [admin.id], urgency: "high" },
    );
    const status = push.devices === 0 ? "skipped" : push.sent > 0 ? "sent" : "failed";
    const detail = push.devices === 0 ? "no alert device on this admin" : `${push.sent} of ${push.devices} device(s) accepted by the push service`;
    await db.healthAlertDelivery.create({ data: { kind: "test", channel: "push", status, detail, adminId: admin.id } }).catch(() => null);
    return json({ ok: status === "sent", status, devices: push.devices, sent: push.sent, failed: push.failed + push.dropped, detail });
  },
  [30, 60_000],
);

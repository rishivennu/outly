import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { GREET_SLOTS } from "@/lib/notify-core";
import { IDLE_TIERS, notifyConfig, saveNotifyConfig } from "@/lib/notify-config";
import { notify } from "@/lib/retention/notices";

/**
 * 1141 admin > Notifications. Two things only: save the config, and send one test notification to the
 * admin's own creator account.
 *
 * The test send is deliberately narrow. An admin screen that can push a message to a creator is a screen
 * that can push a message to every creator by accident, so this route refuses any address but the one the
 * admin is signed in with, and the notification says plainly that it is a test.
 */
const Cooldown = z.record(z.enum(["publishing", "schedule", "account", "engagement", "billing", "assist"]), z.number().min(0).max(1440)).optional();
const Idle = z.record(z.enum(IDLE_TIERS as unknown as [string, ...string[]]), z.object({ on: z.boolean().optional(), minutes: z.number().min(5).max(86_400).optional(), title: z.string().trim().max(80).optional(), body: z.string().trim().max(200).optional() })).optional();
const Greet = z.record(z.enum(GREET_SLOTS as unknown as [string, ...string[]]), z.object({ on: z.boolean().optional(), lines: z.array(z.string().trim().min(1).max(140)).max(12).optional() })).optional();
const Patch = z.object({
  paused: z.boolean().optional(),
  cooldown: Cooldown,
  idle: Idle,
  greet: Greet,
  digest: z.object({ on: z.boolean().optional(), windowMin: z.number().min(5).max(1440).optional(), min: z.number().min(2).max(50).optional() }).optional(),
});

/** A save is a merge: the screen sends the section it changed, never the whole config. */
export const PATCH = adminRoute("site", async (req, { admin }) => {
  const patch = Patch.parse(await req.json());
  const cur = await notifyConfig();
  const next = await saveNotifyConfig({
    ...cur,
    ...patch,
    cooldown: { ...cur.cooldown, ...patch.cooldown },
    digest: { ...cur.digest, ...patch.digest },
    idle: Object.fromEntries(IDLE_TIERS.map((t) => [t, { ...cur.idle[t], ...patch.idle?.[t] }])),
    greet: Object.fromEntries(GREET_SLOTS.map((s) => [s, { ...cur.greet[s], ...patch.greet?.[s] }])),
  });
  if (typeof patch.paused === "boolean" && patch.paused !== cur.paused)
    await adminEvent("notify_pause", patch.paused ? "Notifications paused" : "Notifications resumed", `${admin.name} ${patch.paused ? "paused" : "resumed"} every push and email that is not essential.`, "/admin/notifications");
  return json({ config: next });
});

const Test = z.object({ email: z.string().trim().email().max(200) });

export const POST = adminRoute(
  "site",
  async (req, { admin }) => {
    const { email } = Test.parse(await req.json());
    if (email.toLowerCase() !== admin.login.toLowerCase()) throw new HttpError(403, "A test can only be sent to your own account, so nobody else is messaged by accident.", "SELF_ONLY");
    const u = await db.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, name: true } });
    if (!u) throw new HttpError(404, "There is no creator account on that address. Sign up with it first, then test.", "NO_USER");
    const r = await notify(
      u.id,
      {
        kind: "account_connected",
        tone: "info",
        title: "Test notification",
        body: "This is a test from the admin console. Nothing happened to your account.",
        href: "/settings/notifications",
        action: "Open notification settings",
        key: `admintest:${u.id}:${Date.now()}`,
      },
      { push: { keepOpen: false } },
    );
    return json({ sent: r.created, id: r.id, to: u.name });
  },
  [10, 60_000],
);

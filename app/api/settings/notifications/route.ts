import { z } from "zod";
import { json, route } from "@/lib/http";
import { CATEGORIES, EVENTS, LEADS, applyPatch, validTime, type NotifyPatch } from "@/lib/notify-core";
import { loadNotifyPrefs, saveNotifyPrefs } from "@/lib/notify";
import { vapidKeys } from "@/lib/push/vapid";
import { devicesOf } from "@/lib/push/web-devices";

export const dynamic = "force-dynamic";

/**
 * Settings > Notifications (1118). Owner only, like the rest of /api/settings (lib/team/roles.ts): the
 * notices are about the owner's accounts, posts and billing.
 */
export const GET = route(async (_req, { user }) => {
  const [{ tz, ...prefs }, v, devices] = await Promise.all([loadNotifyPrefs(user.id), vapidKeys(), devicesOf(user.id)]);
  return json({ prefs, tz, publicKey: v.publicKey, devices });
});

const bool = z.boolean().optional();
const Patch = z.object({
  all: bool,
  category: z.object({ id: z.enum(CATEGORIES.map((c) => c.id) as [string, ...string[]]), on: z.boolean() }).optional(),
  ev: z.record(z.enum(EVENTS as unknown as [string, ...string[]]), z.boolean()).optional(),
  lead: z.number().refine((n) => (LEADS as readonly number[]).includes(n), "Pick one of the options").optional(),
  ch: z.object({ push: bool, inApp: bool, email: bool }).optional(),
  quiet: z.object({ on: bool, urgent: bool, start: z.string().refine(validTime, "Use HH:MM").optional(), end: z.string().refine(validTime, "Use HH:MM").optional() }).optional(),
});

export const PATCH = route(
  async (req, { user }) => {
    const patch = Patch.parse(await req.json()) as NotifyPatch;
    const { tz: _tz, ...cur } = await loadNotifyPrefs(user.id);
    const prefs = await saveNotifyPrefs(user.id, applyPatch(cur, patch));
    return json({ prefs });
  },
  { limit: [60, 60_000] },
);

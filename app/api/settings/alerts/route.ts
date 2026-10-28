import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { parseAlertPrefs, serializeAlertPrefs, SPIKE_STEPS } from "@/lib/alerts-core";

const schema = z.object({
  spike: z.boolean().optional(),
  spikeX: z.number().refine((x) => (SPIKE_STEPS as readonly number[]).includes(x), "Pick one of the options").optional(),
  failed: z.boolean().optional(),
  email: z.boolean().optional(),
});

/**
 * Custom alerts (1037). They belong to the workspace owner: /api/settings is owner-only (lib/team/roles.ts),
 * so members get 403 on both methods. The actor check below is a second guard in case that list changes.
 */
export const GET = route(async (_req, { user }) => {
  const u = await db.user.findUnique({ where: { id: user.id }, select: { alertPrefs: true } });
  return json({ prefs: parseAlertPrefs(u?.alertPrefs) });
});

export const PATCH = route(async (req, { user }) => {
  if (user.actor) throw new HttpError(403, "Only the workspace owner can change alerts.", "owner_only");
  const body = schema.parse(await req.json());
  const u = await db.user.findUnique({ where: { id: user.id }, select: { alertPrefs: true } });
  const prefs = { ...parseAlertPrefs(u?.alertPrefs), ...body };
  await db.user.update({ where: { id: user.id }, data: { alertPrefs: serializeAlertPrefs(prefs) } });
  return json({ prefs: parseAlertPrefs(serializeAlertPrefs(prefs)) });
});

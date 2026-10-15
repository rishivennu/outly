import { z } from "zod";
import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { isOrbValue } from "@/lib/avatar";

const schema = z.object({
  name: z.string().trim().min(1, "What should we call you?").max(80).optional(),
  timezone: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "That time zone doesn't look right")
    .optional(),
  weeklyReport: z.boolean().optional(),
  // Only orb values can be set here; photo URLs come from sign-in providers, never from the client.
  avatar: z.string().refine(isOrbValue, "Pick one of the orbs").nullable().optional(),
  postingGoal: z.number().int().min(0).max(21).optional(),
});

export const PATCH = route(async (req, { user }) => {
  const body = schema.parse(await req.json());
  const u = await db.user.update({ where: { id: user.id }, data: body, select: { name: true, timezone: true, weeklyReport: true, avatar: true, postingGoal: true } });
  return json({ user: u });
});

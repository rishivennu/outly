import { z } from "zod";
import { json } from "@/lib/http";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { getConfig, saveConfig } from "@/lib/settings";
import { WELCOME_LIMITS, normalizeWelcome } from "@/lib/pwa-welcome";

/** Admin > Dashboard style > Home Screen welcome (1100). */
export const GET = adminRoute("site", async () => json({ welcome: normalizeWelcome(await getConfig("welcome")) }));

const Body = z
  .object({
    enabled: z.boolean().optional(),
    title: z.string().trim().min(1).max(WELCOME_LIMITS.title).optional(),
    body: z.string().trim().min(1).max(WELCOME_LIMITS.body).optional(),
    // Blank lines are dropped before the count, so four empty boxes mean "no lines", not "too many".
    points: z.preprocess(
      (v) => (Array.isArray(v) ? v.filter((x) => typeof x !== "string" || x.trim() !== "") : v),
      z.array(z.string().trim().max(WELCOME_LIMITS.point)).max(WELCOME_LIMITS.points),
    ).optional(),
    button: z.string().trim().min(1).max(WELCOME_LIMITS.button).optional(),
  })
  .strict();

export const PUT = adminRoute("site", async (req, { admin }) => {
  const b = Body.parse(await req.json());
  const welcome = normalizeWelcome(await saveConfig("welcome", b));
  // Switching the first-run screen off (or rewording it) changes it for everyone: leave an audit line.
  await adminEvent("site", `${admin.name} updated the Home Screen welcome`, b.enabled !== undefined ? `welcome ${b.enabled ? "on" : "off"}` : undefined, "/admin/dashboard");
  return json({ welcome });
}, [60, 60_000]);

export const dynamic = "force-dynamic";

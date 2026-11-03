import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { getConfig, saveConfig } from "@/lib/settings";
import { INSTALL_LIMITS, normalizeInstall } from "@/lib/pwa-core";

/** Admin > Dashboard style > Home Screen suggestion (1099). */
export const GET = adminRoute("site", async () => json({ install: normalizeInstall(await getConfig("install")) }));

const int = ([lo, hi]: readonly [number, number]) => z.number().int().min(lo).max(hi).optional();
const Body = z
  .object({
    enabled: z.boolean().optional(),
    minVisits: int(INSTALL_LIMITS.minVisits),
    delaySec: int(INSTALL_LIMITS.delaySec),
    cooldownDays: int(INSTALL_LIMITS.cooldownDays),
    maxDismissals: int(INSTALL_LIMITS.maxDismissals),
  })
  .strict();

export const PUT = adminRoute("site", async (req) => {
  const b = Body.parse(await req.json());
  return json({ install: normalizeInstall(await saveConfig("install", b)) });
}, [60, 60_000]);

export const dynamic = "force-dynamic";

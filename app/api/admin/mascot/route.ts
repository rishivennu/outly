import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { getConfig, saveConfig } from "@/lib/settings";
import { normalizeMascot, PIP_PALETTE_IDS, PIP_SITUATION_IDS } from "@/lib/mascot/palettes";

export const GET = adminRoute("site", async () => json({ mascot: normalizeMascot(await getConfig("mascot")) }));

// Only known situations and palette ids get through.
const Body = z
  .object({ situations: z.object(Object.fromEntries(PIP_SITUATION_IDS.map((s) => [s, z.enum(PIP_PALETTE_IDS).optional()]))).strict() })
  .strict();

export const PUT = adminRoute("site", async (req) => {
  const b = Body.parse(await req.json());
  const mascot = normalizeMascot(await saveConfig("mascot", b));
  return json({ mascot });
}, [60, 60_000]);

export const dynamic = "force-dynamic";

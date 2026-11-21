import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { getConfig, saveConfig } from "@/lib/settings";
import { NAV_STYLES, normalizeNav } from "@/lib/nav-config";

export const GET = adminRoute("site", async () => json({ nav: normalizeNav(await getConfig("nav")) }));

const Body = z.object({ style: z.enum(NAV_STYLES).optional(), userSwitch: z.boolean().optional() }).strict();

export const PUT = adminRoute("site", async (req) => {
  const b = Body.parse(await req.json());
  return json({ nav: normalizeNav(await saveConfig("nav", b)) });
}, [60, 60_000]);

export const dynamic = "force-dynamic";

import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { getConfig, saveConfig } from "@/lib/settings";
import { FONT_SET_IDS, normalizeFonts } from "@/lib/fonts";

export const GET = adminRoute("site", async () => json({ fonts: normalizeFonts(await getConfig("fonts")) }));

const Body = z.object({ set: z.enum(FONT_SET_IDS) }).strict();

export const PUT = adminRoute("site", async (req) => {
  const b = Body.parse(await req.json());
  const fonts = normalizeFonts(await saveConfig("fonts", b));
  return json({ fonts });
}, [60, 60_000]);

export const dynamic = "force-dynamic";

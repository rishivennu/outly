import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { getConfig, saveConfig } from "@/lib/settings";
import { LANDING_COMPETITORS, LANDING_GROUPS, LANDING_SECTIONS } from "@/lib/landing";

export const GET = adminRoute("site", async () => json({ landing: await getConfig("landing") }));

// Only known keys get through, so the stored JSON can never grow junk.
const flags = <T extends readonly string[]>(keys: T) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean().optional()])) as Record<T[number], z.ZodOptional<z.ZodBoolean>>).strict().optional();
const Body = z
  .object({
    sections: flags(LANDING_SECTIONS.map((s) => s.id)),
    competitors: flags(LANDING_COMPETITORS.map((c) => c.id)),
    groups: flags(LANDING_GROUPS),
  })
  .strict();

export const PUT = adminRoute("site", async (req) => {
  const b = Body.parse(await req.json());
  const landing = await saveConfig("landing", b);
  return json({ landing });
}, [60, 60_000]);

export const dynamic = "force-dynamic";

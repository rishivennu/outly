import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { getConfig, saveConfig } from "@/lib/settings";
import { CARD_STYLES, CARD_STYLE_META, normalizeDisplay } from "@/lib/billing/display";
import { revalidatePricing } from "@/lib/billing/plans";

export const GET = adminRoute("pricing", async () => json({ display: normalizeDisplay(await getConfig("pricing")) }));

const Body = z
  .object({
    cardStyle: z.enum(CARD_STYLES).optional(),
    yearly: z.boolean().optional(),
    freeMonths: z.number().int().min(0).max(6).optional(),
  })
  .strict();

/** Card style and the yearly switch for every pricing surface. Live on the next request, like a plan edit. */
export const PUT = adminRoute("pricing", async (req, { admin }) => {
  const b = Body.parse(await req.json());
  const before = normalizeDisplay(await getConfig("pricing"));
  const display = normalizeDisplay(await saveConfig("pricing", b));
  revalidatePricing();
  const what = [
    display.cardStyle !== before.cardStyle && `card style ${CARD_STYLE_META[display.cardStyle].label}`,
    display.yearly !== before.yearly && `yearly billing ${display.yearly ? "on" : "off"}`,
    display.freeMonths !== before.freeMonths && `${display.freeMonths} months free on yearly`,
  ].filter(Boolean);
  if (what.length) await adminEvent("plan_changed", `${admin.name} changed pricing: ${what.join(", ")}`, undefined, "/admin/pricing");
  return json({ display });
}, [60, 60_000]);

export const dynamic = "force-dynamic";

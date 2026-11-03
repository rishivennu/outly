import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { applyPricingPreset, applyPricingRevision, fixPresetCopy, presetBackup, revisionBackup, staleCopy, undoPricingPreset, undoPricingRevision, PRESET_NAME, PRICING_2026_11, REVISION_NAME } from "@/lib/billing/pricing-preset";

export const dynamic = "force-dynamic";

const state = async () => {
  const [b, r] = await Promise.all([presetBackup(), revisionBackup()]);
  return {
    preset: PRESET_NAME, plans: PRICING_2026_11.map((p) => p.slug), applied: !!b, appliedAt: b?.at ?? null, appliedBy: b?.by ?? null, stale: await staleCopy(),
    revision: { name: REVISION_NAME, applied: !!r, appliedAt: r?.at ?? null, appliedBy: r?.by ?? null },
  };
};

export const GET = adminRoute("pricing", async () => json(await state()));

const Body = z.object({ fixCopy: z.boolean().optional(), undo: z.boolean().optional(), endBeta: z.boolean().optional(), enableFounding: z.boolean().optional(), revision: z.enum(["apply", "undo"]).optional() });

/** Nothing changes on its own: the November 2026 plans land only when an admin presses Apply here, and Undo puts the old rows back. */
export const POST = adminRoute("pricing", async (req, { admin }) => {
  const b = Body.parse(await req.json());
  const actor = { login: admin.login, role: admin.role };
  const result = b.revision === "apply" ? await applyPricingRevision(actor) : b.revision === "undo" ? await undoPricingRevision(actor) : b.fixCopy ? await fixPresetCopy(actor) : b.undo ? await undoPricingPreset(actor) : await applyPricingPreset(actor, { endBeta: b.endBeta, enableFounding: b.enableFounding });
  return json({ ...(await state()), result });
}, [10, 60_000]);

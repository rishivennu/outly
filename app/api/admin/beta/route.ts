import { z } from "zod";
import { revalidatePath } from "next/cache";
import { json } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { saveConfig } from "@/lib/settings";
import { backfillBetaCodes, betaState, makeManualCode, revokeBetaCode } from "@/lib/beta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = adminRoute("site", async () => json(await betaState()));

const Put = z.object({
  enabled: z.boolean().optional(),
  limit: z.number().int().min(0).max(100_000).optional(),
  months: z.number().int().min(1).max(24).optional(),
  planSlug: z.string().trim().regex(/^[a-z0-9-]{2,30}$/).optional(),
});

/** The beta switch and the first-members offer. Saved straight away; the site copy follows on the next request. */
export const PUT = adminRoute("site", async (req, { admin }) => {
  const b = Put.parse(await req.json());
  await saveConfig("beta", b);
  for (const p of ["/", "/contact", "/waitlist", "/billing"]) revalidatePath(p);
  const parts = [b.enabled !== undefined ? `beta ${b.enabled ? "on" : "off"}` : "", b.limit !== undefined ? `first ${b.limit} members` : ""].filter(Boolean).join(", ");
  await adminEvent("beta", `${admin.name} updated the beta program`, parts || undefined, "/admin/beta");
  return json(await betaState());
}, [30, 60_000]);

const Post = z.discriminatedUnion("action", [
  z.object({ action: z.literal("backfill") }),
  z.object({ action: z.literal("manual"), note: z.string().trim().max(120).default("") }),
  z.object({ action: z.literal("revoke"), id: z.string().min(1).max(40) }),
]);

export const POST = adminRoute("site", async (req, { admin }) => {
  const b = Post.parse(await req.json());
  let made: string | null = null;
  let given = 0;
  if (b.action === "backfill") {
    given = await backfillBetaCodes();
    if (given) await adminEvent("beta", `${admin.name} gave ${given} early member${given === 1 ? "" : "s"} a beta code`, undefined, "/admin/beta");
  } else if (b.action === "manual") made = (await makeManualCode(b.note || `made by ${admin.name}`))?.code ?? null;
  else await revokeBetaCode(b.id);
  return json({ ...(await betaState()), made, given });
}, [30, 60_000]);

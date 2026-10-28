import { z } from "zod";
import { revalidatePath } from "next/cache";
import { json } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { saveConfig } from "@/lib/settings";
import { backfillFounding, clearFoundingCache, foundingState, revokeFounding } from "@/lib/founding";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = adminRoute("site", async () => json(await foundingState()));

const Put = z.object({
  enabled: z.boolean().optional(),
  limit: z.number().int().min(0).max(100_000).optional(),
  discountPct: z.number().int().min(1).max(90).optional(),
  gmailOnly: z.boolean().optional(),
});

/** The founding switch, the seat count and the lifetime discount. Existing members keep the discount they claimed. */
export const PUT = adminRoute("site", async (req, { admin }) => {
  const b = Put.parse(await req.json());
  await saveConfig("founding", b);
  clearFoundingCache();
  for (const p of ["/", "/signup", "/billing", "/home"]) revalidatePath(p);
  const parts = [
    b.enabled !== undefined ? `founding ${b.enabled ? "on" : "off"}` : "",
    b.limit !== undefined ? `${b.limit} seats` : "",
    b.discountPct !== undefined ? `${b.discountPct}% off` : "",
    b.gmailOnly !== undefined ? (b.gmailOnly ? "Gmail only" : "any address") : "",
  ].filter(Boolean).join(", ");
  await adminEvent("founding", `${admin.name} updated the founding program`, parts || undefined, "/admin/founding");
  return json(await foundingState());
}, [30, 60_000]);

const Post = z.discriminatedUnion("action", [
  z.object({ action: z.literal("backfill") }),
  z.object({ action: z.literal("revoke"), id: z.string().min(1).max(40) }),
]);

export const POST = adminRoute("site", async (req, { admin }) => {
  const b = Post.parse(await req.json());
  let result = { claimed: 0, invited: 0 };
  if (b.action === "backfill") {
    result = await backfillFounding();
    if (result.claimed || result.invited) await adminEvent("founding", `${admin.name} offered founding seats`, `${result.claimed} seated, ${result.invited} sent the claim link`, "/admin/founding");
  } else {
    await revokeFounding(b.id);
    await adminEvent("founding", `${admin.name} revoked a founding seat`, undefined, "/admin/founding");
  }
  clearFoundingCache();
  return json({ ...(await foundingState()), ...result });
}, [30, 60_000]);

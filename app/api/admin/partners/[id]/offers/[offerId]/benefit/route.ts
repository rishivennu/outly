import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { changeBenefit, endBenefit, extendBenefit, grantBenefit } from "@/lib/partners/benefits";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("grant") }),
  z.object({ action: z.literal("extend"), days: z.number().int().min(1).max(366) }),
  z.object({ action: z.literal("change"), planSlug: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, "Pick a plan from the list.") }),
  z.object({ action: z.literal("end"), reason: z.string().trim().min(3, "Say why, for the creator and the audit trail.").max(300) }),
]);

/** Admin control of an accepted offer's complimentary plan. "grant" is the manual Grant now (e.g. after a paid-plan skip). */
export const POST = adminRoute<{ params: { id: string; offerId: string } }>("partners", async (req, { params, admin }) => {
  const offer = await db.partnerOffer.findUnique({ where: { id: params.offerId.slice(0, 40) }, select: { applicationId: true } });
  if (!offer || offer.applicationId !== params.id) throw new HttpError(404, "That offer no longer exists.", "NOT_FOUND");
  const b = Body.parse(await req.json());
  if (b.action === "grant") return json({ result: await grantBenefit(params.offerId, admin, { force: true }) });
  if (b.action === "extend") return json({ grant: await extendBenefit(params.offerId, b.days, admin) });
  if (b.action === "change") return json({ grant: await changeBenefit(params.offerId, b.planSlug, admin) });
  return json({ grant: await endBenefit(params.offerId, b.reason, admin) });
}, [20, 60_000]);

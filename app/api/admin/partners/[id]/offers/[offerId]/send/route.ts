import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { sendOffer } from "@/lib/partners/offers";

export const dynamic = "force-dynamic";

export const POST = adminRoute<{ params: { id: string; offerId: string } }>("partners", async (_req, { params, admin }) => json({ offer: await sendOffer(params.id, params.offerId, admin) }), [20, 60_000]);

import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { updateOffer, withdrawOffer } from "@/lib/partners/offers";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; offerId: string } };

export const PATCH = adminRoute<Ctx>("partners", async (req, { params, admin }) => json({ offer: await updateOffer(params.id, params.offerId, await req.json(), admin) }), [30, 60_000]);

export const DELETE = adminRoute<Ctx>("partners", async (_req, { params, admin }) => json({ offer: await withdrawOffer(params.id, params.offerId, admin) }), [30, 60_000]);

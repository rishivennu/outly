import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { createOffer, listOffers } from "@/lib/partners/offers";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export const GET = adminRoute<Ctx>("partners", async (_req, { params }) => json({ offers: await listOffers(params.id) }));

export const POST = adminRoute<Ctx>("partners", async (req, { params, admin }) => {
  const offer = await createOffer(params.id, await req.json(), admin);
  return json({ offer }, { status: 201 });
}, [30, 60_000]);

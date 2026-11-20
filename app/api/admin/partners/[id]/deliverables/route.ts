import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { createDeliverable, listDeliverables } from "@/lib/partners/deliverables";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export const GET = adminRoute<Ctx>("partners", async (_req, { params }) => json({ deliverables: await listDeliverables(params.id) }));

export const POST = adminRoute<Ctx>("partners", async (req, { params, admin }) => json({ deliverable: await createDeliverable(params.id, await req.json(), admin) }, { status: 201 }), [30, 60_000]);

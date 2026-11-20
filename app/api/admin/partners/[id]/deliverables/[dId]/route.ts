import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { deleteDeliverable, updateDeliverable } from "@/lib/partners/deliverables";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; dId: string } };

export const PATCH = adminRoute<Ctx>("partners", async (req, { params, admin }) => json({ deliverable: await updateDeliverable(params.id, params.dId, await req.json(), admin) }), [30, 60_000]);

export const DELETE = adminRoute<Ctx>("partners", async (_req, { params, admin }) => json(await deleteDeliverable(params.id, params.dId, admin)), [30, 60_000]);

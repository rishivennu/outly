import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { WorkshopPatch } from "@/lib/workshops/core";
import { adminWorkshop, deleteWorkshop, setWorkshopStatus, syncWorkshopCalendar, toView, updateWorkshop } from "@/lib/workshops/server";

type Ctx = { params: { id: string } };

/** One workshop with its registrations. */
export const GET = adminRoute<Ctx>("workshops", async (_req, { params }) => json(await adminWorkshop(params.id)));

const Patch = z.object({
  workshop: WorkshopPatch.optional(),
  /** publish | cancelled | completed | draft, applied after the field changes. */
  status: z.enum(["published", "cancelled", "completed", "draft"]).optional(),
  /** Retry the Google Calendar sync by hand. */
  resync: z.boolean().optional(),
});

export const PATCH = adminRoute<Ctx>("workshops", async (req, { params, admin }) => {
  const body = Patch.parse(await req.json());
  let w = body.workshop && Object.keys(body.workshop).length ? await updateWorkshop(params.id, body.workshop, admin) : null;
  if (body.status) w = await setWorkshopStatus(params.id, body.status, admin);
  if (body.resync) await syncWorkshopCalendar(params.id);
  const out = await adminWorkshop(params.id);
  return json({ ...out, workshop: w ? toView(w, { admin: true }) : out.workshop });
});

export const DELETE = adminRoute<Ctx>("workshops", async (_req, { params, admin }) => {
  await deleteWorkshop(params.id, admin);
  return json({ ok: true });
});

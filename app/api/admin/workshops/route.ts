import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { WorkshopInput } from "@/lib/workshops/core";
import { createWorkshop, listAdminWorkshops, toView } from "@/lib/workshops/server";
import { calendarStatus } from "@/lib/google/calendar";

/** R1309 admin workshops: the table plus the calendar connection, and create (draft or publish at once). */
export const GET = adminRoute("workshops", async () => {
  const [workshops, calendar] = await Promise.all([listAdminWorkshops(), calendarStatus()]);
  return json({ workshops, calendar });
});

const Create = z.object({ workshop: WorkshopInput, publish: z.boolean().optional() });

export const POST = adminRoute("workshops", async (req, { admin }) => {
  const body = Create.parse(await req.json());
  const w = await createWorkshop(body.workshop, admin, { publish: !!body.publish });
  return json({ workshop: toView(w, { admin: true }) }, { status: 201 });
});

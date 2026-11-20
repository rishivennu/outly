import { z } from "zod";
import { HttpError, json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { MESSAGE_REQUIRED, changeStatus } from "@/lib/partners/admin";
import { PARTNER_STATUSES, canTransition, type PartnerStatus } from "@/lib/partners/types";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const Body = z.object({
  to: z.enum(PARTNER_STATUSES),
  // Sent to the creator in the status email. Internal notes go through /notes and never reach this field.
  message: z.string().trim().max(2000).optional(),
});

export const POST = adminRoute<{ params: { id: string } }>("partners", async (req, { params, admin }) => {
  const b = Body.parse(await req.json());
  const app = await db.partnerApplication.findUnique({ where: { id: params.id.slice(0, 40) }, select: { id: true, status: true } });
  if (!app) throw new HttpError(404, "That application no longer exists.", "NOT_FOUND");
  if (!canTransition(app.status, b.to)) throw new HttpError(409, "That step isn't available from the current status. Refresh and try again.", "BAD_TRANSITION");
  if (MESSAGE_REQUIRED.includes(b.to as PartnerStatus) && (b.message ?? "").length < 3) {
    throw new HttpError(400, "Write the message the creator will read.", "MESSAGE_REQUIRED");
  }
  const updated = await changeStatus(app.id, b.to, { login: admin.login, role: admin.role }, { message: b.message });
  return json({ status: updated.status, updatedAt: updated.updatedAt });
}, [30, 60_000]);

import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { refundPayment } from "@/lib/billing/service";

const Body = z.object({ reason: z.string().trim().max(200).optional() });

/** Full refund. Calls the real gateway when one took the money; mock and sample payments are refunded locally. */
export const POST = adminRoute<{ params: { id: string } }>("payments", async (req, { params, admin }) => {
  const { reason } = Body.parse(await req.json().catch(() => ({})));
  await refundPayment(params.id, admin.name, reason ?? "");
  return json({ ok: true });
}, [10, 60_000]);

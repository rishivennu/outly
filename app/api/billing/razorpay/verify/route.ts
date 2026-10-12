import { z } from "zod";
import { db } from "@/lib/db";
import { json, route, HttpError } from "@/lib/http";
import { getConfig } from "@/lib/settings";
import { razorpay } from "@/lib/billing/providers";
import { completePayment, failPayment } from "@/lib/billing/service";

const Body = z.object({ paymentId: z.string(), razorpay_order_id: z.string(), razorpay_payment_id: z.string().optional(), razorpay_signature: z.string().optional(), failed: z.string().optional() });

export const POST = route(async (req, { user }) => {
  const b = Body.parse(await req.json());
  const p = await db.payment.findUnique({ where: { id: b.paymentId } });
  if (!p || p.userId !== user.id || p.providerRef !== b.razorpay_order_id) throw new HttpError(404, "Payment not found", "NOT_FOUND");
  if (b.failed) {
    await failPayment(p.id, b.failed);
    return json({ ok: false, error: b.failed });
  }
  const cfg = await getConfig("payments");
  if (!b.razorpay_payment_id || !b.razorpay_signature || !razorpay.verifyPayment(cfg, b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature))
    throw new HttpError(400, "We couldn't verify that payment. If money left your account, contact support and we'll sort it out.", "BAD_SIGNATURE");
  const { invoice } = await completePayment(p.id);
  return json({ ok: true, invoice: invoice?.number });
});

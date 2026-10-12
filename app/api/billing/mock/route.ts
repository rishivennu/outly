import { z } from "zod";
import { db } from "@/lib/db";
import { json, route, HttpError } from "@/lib/http";
import { completePayment, failPayment } from "@/lib/billing/service";

const Body = z.object({
  paymentId: z.string().min(1),
  method: z.enum(["card", "upi"]),
  card: z.string().optional(),
  upi: z.string().optional(),
});

/**
 * The mock gateway. Mirrors real gateway outcomes so every UI state can be tested:
 *   4242 4242 4242 4242 -> success     4000 0000 0000 0002 -> declined
 *   4000 0000 0000 9995 -> insufficient funds     UPI "fail@upi" -> declined, any other UPI id -> success
 */
export const POST = route(async (req, { user }) => {
  const b = Body.parse(await req.json());
  const p = await db.payment.findUnique({ where: { id: b.paymentId } });
  if (!p || p.userId !== user.id) throw new HttpError(404, "This checkout has expired. Start again from Billing.", "NOT_FOUND");
  if (p.provider !== "mock") throw new HttpError(400, "This checkout belongs to a real gateway.", "WRONG_GATEWAY");
  if (p.status === "succeeded") return json({ ok: true, already: true });
  await new Promise((r) => setTimeout(r, 900)); // feels like a gateway round trip
  const card = (b.card ?? "").replace(/\D/g, "");
  let fail: string | null = null;
  if (b.method === "card") {
    if (card.length < 15) fail = "Card number is incomplete.";
    else if (card === "4000000000000002") fail = "Your card was declined.";
    else if (card === "4000000000009995") fail = "Insufficient funds on this card.";
    else if (card !== "4242424242424242") fail = "Unknown test card. Use 4242 4242 4242 4242.";
  } else if (!/^[\w.-]{2,}@[a-z]{2,}$/i.test(b.upi ?? "")) fail = "That UPI id doesn't look right (name@bank).";
  else if (b.upi === "fail@upi") fail = "The UPI request was declined.";

  if (fail) {
    await failPayment(p.id, fail);
    return json({ ok: false, error: fail, retryable: true }, { status: 402 });
  }
  const { invoice } = await completePayment(p.id, `mock_${p.id.slice(-10)}_${Date.now().toString(36)}`);
  return json({ ok: true, invoice: invoice?.number });
}, { limit: [15, 60_000] });

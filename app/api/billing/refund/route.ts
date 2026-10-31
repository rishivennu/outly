import { z } from "zod";
import { revalidatePath } from "next/cache";
import { json, route } from "@/lib/http";
import { refundStatus, selfRefund } from "@/lib/billing/guarantee";

/** 30-day money-back guarantee (1076): where you stand, and the self-serve refund itself. */
export const GET = route(async (_req, { user }) => json(await refundStatus(user.id)));

const Body = z.object({ reason: z.string().max(300).optional().default(""), confirm: z.literal(true) });
export const POST = route(async (req, { user }) => {
  const { reason } = Body.parse(await req.json());
  const r = await selfRefund({ id: user.id, email: user.email, name: user.name ?? null }, reason);
  revalidatePath("/billing");
  return json({ ok: true, ...r });
}, { limit: [3, 60_000] });

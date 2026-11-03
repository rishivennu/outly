import { z } from "zod";
import { revalidatePath } from "next/cache";
import { json, route } from "@/lib/http";
import { setAutoRenew } from "@/lib/billing/autorenew";

const Body = z.object({ on: z.boolean() });

/** 1096: turn auto-renew on (Razorpay sends back a mandate link to approve) or off. */
export const POST = route(async (req, { user }) => {
  const { on } = Body.parse(await req.json());
  const r = await setAutoRenew(user.id, on);
  revalidatePath("/billing");
  return json(r);
}, { limit: [10, 60_000] });

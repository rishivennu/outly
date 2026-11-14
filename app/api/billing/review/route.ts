import { z } from "zod";
import { json, route } from "@/lib/http";
import { appeal } from "@/lib/subscriptions/risk";

const Body = z.object({ flagId: z.string().min(1).max(64).optional(), message: z.string().trim().min(1, "Tell us a little about your account.").max(1500) }).strict();

/** 1147: "Ask for a review" after a trial or first-time price was refused. Opens a support ticket linked to the flag. */
export const POST = route(
  async (req, { user }) => {
    const body = Body.parse(await req.json());
    const r = await appeal({ userId: user.id, flagId: body.flagId, message: body.message });
    return json({ ok: true, ticketId: r.ticketId });
  },
  { limit: [5, 60_000] },
);

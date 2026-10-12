import { z } from "zod";
import { json, route } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth";
import { raiseTicket } from "@/lib/support/tickets";

const Body = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email so we can reply"),
  name: z.string().trim().max(80).optional(),
  reason: z.enum(["bot_failed", "asked_human", "form"]),
  transcript: z.array(z.object({ role: z.enum(["user", "bot"]), text: z.string().max(2000) })).min(1).max(40),
});

export const POST = route(async (req) => {
  const b = Body.parse(await req.json());
  const user = await getCurrentUser();
  const r = await raiseTicket({ ...b, name: b.name || user?.name, userId: user?.id });
  return json({ ref: r.ticket.ref, duplicate: r.duplicate, emailed: r.emailed });
}, { auth: false, limit: [5, 10 * 60_000] });

import { z } from "zod";
import { json, route, HttpError } from "@/lib/http";
import { limitShared } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { raiseTicket } from "@/lib/support/tickets";

const Body = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email so we can reply"),
  name: z.string().trim().max(80).optional(),
  reason: z.enum(["bot_failed", "asked_human", "form"]),
  transcript: z.array(z.object({ role: z.enum(["user", "bot"]), text: z.string().max(2000) })).min(1).max(40),
  website: z.string().max(200).optional(), // honeypot: people never see it, bots fill it in
});

export const POST = route(async (req) => {
  const { website, ...b } = Body.parse(await req.json());
  // A bot gets a believable answer and nothing is stored or emailed.
  if (website) return json({ ref: `T-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, duplicate: false, emailed: true });
  // Each ticket emails the address given, so cap it per address too, not only per IP.
  if (!(await limitShared(`ticket:email:${b.email}`, 3, 60 * 60_000)).ok)
    throw new HttpError(429, "We've already got a few messages from this address. We'll reply soon, no need to send more.", "RATE_LIMITED");
  const user = await getCurrentUser();
  const r = await raiseTicket({ ...b, name: b.name || user?.name, userId: user?.id });
  return json({ ref: r.ticket.ref, duplicate: r.duplicate, emailed: r.emailed });
}, { auth: false, limit: [5, 10 * 60_000] });

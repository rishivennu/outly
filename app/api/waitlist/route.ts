import { z } from "zod";
import { json, route } from "@/lib/http";
import { joinWaitlist } from "@/lib/site";

const Body = z.object({
  email: z.string().trim().toLowerCase().email("That email doesn't look right.").max(200),
  name: z.string().trim().max(80).optional(),
  source: z.string().trim().max(40).optional(),
});

/** Public. Join (or look up your place on) the waitlist. Joining twice keeps the first spot. */
export const POST = route(async (req) => {
  const b = Body.parse(await req.json());
  const r = await joinWaitlist(b.email, b.name, b.source);
  // Anyone can post any address here, so an address that was already on the list gets the
  // same answer whether or not it has been invited. Only a fresh join learns its place in line.
  return json(r.already ? { already: true } : { already: false, position: r.position, waiting: r.waiting });
}, { auth: false, limit: [6, 60_000] });

export const dynamic = "force-dynamic";

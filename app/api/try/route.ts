import { z } from "zod";
import { HttpError, clientIp, json, route } from "@/lib/http";
import { shown } from "@/lib/landing";
import { limitShared } from "@/lib/rate-limit";
import { getConfig } from "@/lib/settings";
import { cleanTopic, writeTry } from "@/lib/try";

const Body = z.object({
  topic: z.string().max(200).transform(cleanTopic).pipe(z.string().min(2, "Give it a few words.").max(80)),
});

/** Public. The landing page's "Try it" box: one line in, an Instagram caption, a Shorts title and a post out. */
const MAX_BODY = 2_048;

export const POST = route(async (req) => {
  // The admin hid the section (Admin > Landing page), so the public model endpoint closes with it.
  if (!shown(await getConfig("landing"), "try")) throw new HttpError(404, "Try it is switched off right now.", "TRY_OFF");
  // Public and unauthenticated: refuse a big body before reading it, and again after (no length header).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw new HttpError(413, "That's longer than one line.", "TOO_LARGE");
  const raw = await req.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, "That's longer than one line.", "TOO_LARGE");
  const { topic } = Body.parse(JSON.parse(raw));
  // A burst limit comes from route(); this one caps a whole day, since each call spends model quota.
  const day = await limitShared(`try-day:${clientIp(req)}`, 30, 86_400_000);
  if (!day.ok) throw new HttpError(429, "You've used today's free tries, so here is a quick version.", "TRY_DAILY");
  const out = await writeTry(topic);
  if (!out) throw new HttpError(504, "Our writer took too long. Here is a quick version instead.", "TRY_TIMEOUT");
  return json(out, { headers: { "Cache-Control": "no-store" } });
}, { auth: false, limit: [8, 60_000] });

export const dynamic = "force-dynamic";

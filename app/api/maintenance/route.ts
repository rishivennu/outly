import { z } from "zod";
import { json, route } from "@/lib/http";
import { siteStatus, subscribe } from "@/lib/site";
import { getConfig } from "@/lib/settings";
import { hiddenAnchors } from "@/lib/landing";

/** Public. Middleware polls this (cached a few seconds per instance) to decide whether to show /maintenance. */
export async function GET() {
  const [s, landing] = await Promise.all([siteStatus(), getConfig("landing")]);
  // `hide`: landing anchors the admin switched off, so the nav and footer can drop those links.
  return json({ ...s, hide: hiddenAnchors(landing) }, { headers: { "cache-control": "no-store" } });
}

const Body = z.object({ email: z.string().trim().toLowerCase().email("That email doesn't look right.").max(200) });

export const POST = route(async (req) => {
  const { email } = Body.parse(await req.json());
  await subscribe(email);
  return json({ ok: true });
}, { auth: false, limit: [8, 60_000] });

export const dynamic = "force-dynamic";

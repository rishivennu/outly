import { db } from "@/lib/db";
import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { placeLabel } from "@/lib/geo";

export const dynamic = "force-dynamic";

/**
 * The approximate place Outlly keeps for the person signed in (1053): read from the network address only,
 * city level at best. The browser is never asked for a location. Belongs to the person, not the workspace.
 */
export const GET = route(async (_req, { user }) => {
  const u = await db.user.findUnique({
    where: { id: realUserId(user) },
    select: { locCountry: true, locRegion: true, locCity: true, locVia: true, locAt: true },
  });
  const approx = u ? placeLabel({ country: u.locCountry, region: u.locRegion, city: u.locCity, via: u.locVia }) : null;
  return json({ approx: approx ? { label: approx, at: u?.locAt ?? null } : null });
});

import { HttpError, json, route } from "@/lib/http";
import { profileCard } from "@/lib/profile-card";

export const dynamic = "force-dynamic";

/** 1120: the creator profile card. Your own studio only: inside someone else's it's theirs to show. */
export const GET = route(async (_req, { user }) => {
  if (user.actor) throw new HttpError(403, "This card belongs to the studio owner.", "NOT_OWNER");
  return json({ card: await profileCard(user.id) }, { headers: { "Cache-Control": "private, no-store" } });
}, { limit: [30, 60_000] });

import { HttpError, json, route } from "@/lib/http";
import { getMine } from "@/lib/partners/mine";

export const dynamic = "force-dynamic";

/** One of my applications. Someone else's reads exactly like a missing one. */
export const GET = route<{ params: { ref: string } }>(
  async (_req, { params, user }) => {
    const app = await getMine(user, params.ref);
    if (!app) throw new HttpError(404, "We couldn't find that application on your account.", "NOT_FOUND");
    return json({ app }, { headers: { "cache-control": "no-store" } });
  },
  { limit: [60, 60_000] },
);

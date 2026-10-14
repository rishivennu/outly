import { HttpError, json, route } from "@/lib/http";
import { isPlatform } from "@/lib/domain";
import { platformIdeas } from "@/lib/live";

export const dynamic = "force-dynamic";
// The model can take a few seconds; the dashboard itself never waits for this.
export const maxDuration = 30;

/** Gemini coaching ideas for one platform, fetched by the dashboard after its numbers are on screen. */
export const GET = route(
  async (_req, { user, params }) => {
    const p = params.platform ?? "";
    if (!isPlatform(p)) throw new HttpError(404, "We don't support that platform yet.");
    return json({ suggestions: await platformIdeas(user.id, p) });
  },
  { limit: [20, 60_000] },
);
